import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { hashToken, handleDeniedLogin, formatManila } from '$lib/server/loginConfirmation';

// Opened from the sign-in confirmation email. Shows what is being confirmed and asks for one
// final click, so an email scanner that opens links automatically can't approve a sign-in.

async function findRequest(token: string | null) {
    if (!token) return null;
    const { data } = await supabase
        .from('login_confirmation')
        .select('login_confirmation_id, user_id, status, ip_address, user_agent, created_at, expires_at, user:user_id(email)')
        .eq('email_token_hash', hashToken(token))
        .maybeSingle();
    return data;
}

function describe(row: any) {
    const ua: string = row.user_agent || '';
    const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a web browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iPhone / iPad' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown device';
    const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now();
    return {
        email: row.user?.email ?? '',
        when: formatManila(row.created_at),
        device: `${browser} on ${os}`,
        ip: row.ip_address as string | null,
        state: expired ? 'expired' : (row.status as string)
    };
}

export const load: PageServerLoad = async ({ url }) => {
    const token = url.searchParams.get('token');
    const choice = url.searchParams.get('choice') === 'no' ? 'no' : 'yes';
    const row = await findRequest(token);
    return {
        token,
        choice,
        request: row ? describe(row) : null
    };
};

async function decide(token: string | null, approve: boolean) {
    const row = await findRequest(token);
    if (!row) return fail(404, { message: 'This sign-in request was not found.' });
    if (row.status !== 'pending') return fail(409, { message: 'This sign-in request has already been answered.' });
    if (new Date(row.expires_at).getTime() <= Date.now()) return fail(410, { message: 'This sign-in request has expired. Please sign in again.' });

    const { data: updated } = await supabase
        .from('login_confirmation')
        .update({ status: approve ? 'approved' : 'denied', decided_at: new Date().toISOString() })
        .eq('login_confirmation_id', row.login_confirmation_id)
        .eq('status', 'pending')
        .select('login_confirmation_id')
        .maybeSingle();
    if (!updated) return fail(409, { message: 'This sign-in request has already been answered.' });

    if (approve) {
        return { done: 'approved' as const };
    }
    const lockedUntil = await handleDeniedLogin(row as any);
    return { done: 'denied' as const, lockedUntil: formatManila(lockedUntil) };
}

export const actions: Actions = {
    approve: async ({ request }) => {
        const form = await request.formData();
        return decide(String(form.get('token') || ''), true);
    },
    deny: async ({ request }) => {
        const form = await request.formData();
        return decide(String(form.get('token') || ''), false);
    }
};
