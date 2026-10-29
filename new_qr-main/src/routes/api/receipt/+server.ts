import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { uploadToStorage } from '$lib/server/storage';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('receipt');

        if (!(file instanceof File) || file.size === 0) {
            return json({ error: 'Please select a receipt image to upload.' }, { status: 400 });
        }
        if (!file.type.startsWith('image/')) {
            return json({ error: 'Only image files are allowed.' }, { status: 400 });
        }
        if (file.size > MAX_SIZE) {
            return json({ error: 'Image must be 10MB or smaller.' }, { status: 400 });
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
            .select('registration_id, status')
            .eq('user_id', user.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!reg || (reg.status || '').toLowerCase() !== 'security_checked') {
            return json({ error: 'Your application is not yet ready for payment receipt upload.' }, { status: 400 });
        }

        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `receipts/receipt-${reg.registration_id}-${Date.now()}.${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const receiptUrl = await uploadToStorage(path, buffer, file.type);

        const { error: updateError } = await supabase
            .from('registration')
            .update({ receipt: receiptUrl, status: 'receipt_submitted' })
            .eq('registration_id', reg.registration_id);

        if (updateError) throw updateError;

        return json({ success: true, receipt: receiptUrl });
    } catch (error) {
        console.error('Failed to upload receipt:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
