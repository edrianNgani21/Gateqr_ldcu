import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { acceptUploadedFile, UploadRejected } from '$lib/server/directUpload';
import { SIGNED_AGREEMENT_TYPES } from '$lib/limits';
import { isAgreementReminderRole } from '$lib/server/agreementReminder';

// Applicant uploads the Agreement Form to Park signed by their Department Head after the
// pending-approval reminder. The application stays pending: OSA or the Department Head reviews
// the form and decides. One upload per application; a bad file means the application is rejected.
export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const path = formData.get('signed_agreement');

        if (typeof path !== 'string' || !path) {
            return json({ error: 'Please select the signed Agreement Form to Park to upload.' }, { status: 400 });
        }

        const { data: user } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (!user) {
            return json({ error: 'Your account record could not be found. Please sign out, sign in again, and retry.' }, { status: 404 });
        }

        const { data: reg } = await supabase
            .from('sticker_application')
            .select('registration_id, status, role, agreement_reminder_sent_at, signed_agreement_form').neq('status', 'deleted')
            .eq('user_id', user.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (
            !reg ||
            (reg.status || '').toLowerCase() !== 'pending' ||
            !reg.agreement_reminder_sent_at ||
            !isAgreementReminderRole(reg.role)
        ) {
            return json({ error: 'Your application is not awaiting a signed Agreement Form to Park.' }, { status: 400 });
        }

        if (reg.signed_agreement_form) {
            return json({ error: 'You have already submitted your signed Agreement Form to Park. It cannot be replaced.' }, { status: 400 });
        }

        const fileUrl = await acceptUploadedFile(path, user.user_id, 'signed Agreement Form to Park', SIGNED_AGREEMENT_TYPES);

        const { data: saved, error: updateError } = await supabase
            .from('sticker_application')
            .update({ signed_agreement_form: fileUrl })
            .eq('registration_id', reg.registration_id)
            .eq('status', 'pending')
            .is('signed_agreement_form', null)
            .select('registration_id');

        if (updateError) throw updateError;
        if (!saved || saved.length === 0) {
            return json({ error: 'Your application is not awaiting a signed Agreement Form to Park.' }, { status: 400 });
        }

        return json({ success: true, signed_agreement_form: fileUrl });
    } catch (error) {
        console.error('Failed to upload signed agreement form:', error);
        if (error instanceof UploadRejected) return json({ error: error.message }, { status: 400 });
        return apiFailure('upload your signed Agreement Form to Park', error);
    }
};
