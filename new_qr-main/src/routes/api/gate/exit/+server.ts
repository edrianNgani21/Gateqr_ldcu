import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';
import { uploadToStorage } from '$lib/server/storage';
import crypto from 'crypto';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

export const POST: RequestHandler = async ({ request }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { registration_id, pic_base64, presence_status, campus } = await request.json();

        if (!registration_id) {
            return json({ error: 'Missing registration_id' }, { status: 400 });
        }

        // Get vehicle_id from registration
        const { data: regData } = await supabase
            .from('sticker_application')
            .select('vehicle_id')
            .eq('registration_id', registration_id)
            .single();

        if (!regData) {
            return json({ error: 'Registration not found' }, { status: 404 });
        }

        // Deactivate QR if there is an approved change request pending sticker release
        const { data: activeChange } = await supabase
            .from('profile_update_request')
            .select('status')
            .eq('registration_id', registration_id)
            .eq('status', 'approved')
            .maybeSingle();

        if (activeChange) {
            return json({ error: 'QR Code is deactivated pending new vehicle sticker release.' }, { status: 403 });
        }

        const vehicle_id = regData.vehicle_id;

        let picUrl = null;
        if (pic_base64) {
            try {
                const base64Data = pic_base64.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const filename = `gate/out_${registration_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
                picUrl = await uploadToStorage(filename, buffer, 'image/jpeg');
            } catch (err) {
                console.error('[Gate] Error saving exit image to Supabase Storage:', err);
            }
        }

        // Find the most recent open entrylog for this registration
        const { data: rows, error: queryError } = await supabase
            .from('gate_log')
            .select('gate_log_id, campus_gate')
            .eq('registration_id', registration_id)
            .is('exited_at', null)
            .order('entered_at', { ascending: false })
            .limit(1)
            .single();

        if (rows && !queryError) {
            // Update existing open entry log with OUT time and status
            const { error: updateError } = await supabase
                .from('gate_log')
                .update({
                    exited_at: new Date().toISOString(),
                    presence_status: 'exited_campus'
                })
                .eq('gate_log_id', rows.gate_log_id);

            if (updateError) throw updateError;

            // The database trigger on gate_log writes the new parking snapshot
        } else {
            // No open entry log found — create a standalone OUT row
            const { error: insertError } = await supabase
                .from('gate_log')
                .insert({
                    registration_id,
                    vehicle_id,
                    exited_at: new Date().toISOString(),
                    pic_out: picUrl,
                    logged_status_out: presence_status || null,
                });

            if (insertError) throw insertError;
        }

        return json({ success: true, message: 'Exit recorded' });
    } catch (error) {
        console.error('[Gate] Exit error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
