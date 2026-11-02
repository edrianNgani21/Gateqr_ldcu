import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { acceptUploadedFile, UploadRejected } from '$lib/server/directUpload';
import { IMAGE_TYPES } from '$lib/limits';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const path = formData.get('receipt');

        if (typeof path !== 'string' || !path) {
            return json({ error: 'Please select a receipt image to upload.' }, { status: 400 });
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
            .select('registration_id, status').neq('status', 'deleted')
            .eq('user_id', user.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!reg || (reg.status || '').toLowerCase() !== 'security_checked') {
            return json({ error: 'Your application is not yet ready for payment receipt upload.' }, { status: 400 });
        }

        const receiptUrl = await acceptUploadedFile(path, user.user_id, 'payment receipt', IMAGE_TYPES);

        const { error: updateError } = await supabase
            .from('sticker_application')
            .update({ payment_receipt_file: receiptUrl, status: 'receipt_submitted' })
            .eq('registration_id', reg.registration_id);

        if (updateError) throw updateError;

        return json({ success: true, receipt: receiptUrl });
    } catch (error) {
        console.error('Failed to upload receipt:', error);
        if (error instanceof UploadRejected) return json({ error: error.message }, { status: 400 });
        return apiFailure('upload your payment receipt', error);
    }
};
