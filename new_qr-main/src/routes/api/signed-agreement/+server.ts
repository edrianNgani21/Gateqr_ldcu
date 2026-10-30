import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { uploadToStorage } from '$lib/server/storage';
import { isAgreementReminderRole } from '$lib/server/agreementReminder';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

// Applicant uploads the Agreement Form to Park signed by their Department Head after the
// pending-approval reminder; confirming it marks the application as department approved.
export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('signed_agreement');

        if (!(file instanceof File) || file.size === 0) {
            return json({ error: 'Please select the signed Agreement Form to Park to upload.' }, { status: 400 });
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
            return json({ error: 'Only JPG, PNG, or PDF files are allowed.' }, { status: 400 });
        }
        if (file.size > MAX_SIZE) {
            return json({ error: 'File must be 10MB or smaller.' }, { status: 400 });
        }

        const { data: user } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (!user) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        const { data: reg } = await supabase
            .from('registration')
            .select('registration_id, status, role, agreement_reminder_sent_at')
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

        const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
        const path = `documents/signed-agreement-${reg.registration_id}-${Date.now()}.${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileUrl = await uploadToStorage(path, buffer, file.type);

        const { error: updateError } = await supabase
            .from('registration')
            .update({
                signed_agreement_form: fileUrl,
                status: 'dept_validated',
                dept_val_at: new Date().toISOString()
            })
            .eq('registration_id', reg.registration_id)
            .eq('status', 'pending');

        if (updateError) throw updateError;

        return json({ success: true, signed_agreement_form: fileUrl });
    } catch (error) {
        console.error('Failed to upload signed agreement form:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
