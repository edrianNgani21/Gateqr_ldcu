import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { readEmailChangeToken, type EmailChangeRequest } from '$lib/server/emailChange';

/** Re-check the request against the database: the account must still have the old email. */
async function checkRequest(request: EmailChangeRequest): Promise<string | null> {
    const { data: user } = await supabase.from('users').select('user_id, email').eq('user_id', request.uid).maybeSingle();
    if (!user) return 'This account no longer exists.';
    if (user.email.toLowerCase() === request.new_email.toLowerCase()) return 'done';
    if (user.email.toLowerCase() !== request.old_email.toLowerCase()) {
        return 'The email of this account has changed since this link was sent. Request the change again from Settings.';
    }
    const { data: taken } = await supabase.from('users').select('user_id').ilike('email', request.new_email).limit(1);
    if (taken && taken.length > 0) return `${request.new_email} is now used by another account.`;
    return null;
}

// Opening the link only shows the request; the change happens when "Confirm" is pressed,
// so email link scanners cannot approve it.
export const load: PageServerLoad = async ({ url }) => {
    const { request, error } = readEmailChangeToken(url.searchParams.get('token'));
    if (!request) return { state: 'invalid' as const, message: error };
    const problem = await checkRequest(request);
    if (problem === 'done') return { state: 'done' as const, newEmail: request.new_email };
    if (problem) return { state: 'invalid' as const, message: problem };
    return { state: 'pending' as const, oldEmail: request.old_email, newEmail: request.new_email };
};

export const actions: Actions = {
    default: async ({ url, cookies, locals }) => {
        const { request, error } = readEmailChangeToken(url.searchParams.get('token'));
        if (!request) return fail(400, { error });
        const problem = await checkRequest(request);
        if (problem === 'done') return { done: true, newEmail: request.new_email };
        if (problem) return fail(400, { error: problem });

        // New email = new Google account; clearing the link lets only that account sign in next
        const { error: updateError } = await supabase
            .from('users')
            .update({ email: request.new_email, google_auth_id: null })
            .eq('user_id', request.uid)
            .ilike('email', request.old_email);
        if (updateError) {
            console.error('[Email change] Update failed:', updateError);
            return fail(500, { error: 'Could not change the email. Please try again.' });
        }

        // A session for this account still carries the old email: sign it out
        if (locals.user?.user_id === request.uid) {
            cookies.delete('gateqr_session', { path: '/' });
        }
        console.log(`[Email change] user ${request.uid}: ${request.old_email} -> ${request.new_email}`);
        return { done: true, newEmail: request.new_email };
    }
};
