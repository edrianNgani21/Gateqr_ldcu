import { apiFailure } from '$lib/server/apiError';
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
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { registration_id, pic_base64, presence_status, reason, campus } = await request.json();

        if (!registration_id) {
            return json({ error: 'No application was selected. Please refresh the page and try again.' }, { status: 400 });
        }

        // Get vehicle_id from registration
        const { data: regData } = await supabase
            .from('sticker_application')
            .select('vehicle_id')
            .eq('registration_id', registration_id)
            .single();

        if (!regData) {
            return json({ error: 'This registration could not be found. It may have been deleted. Please refresh the page.' }, { status: 404 });
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
                // Decode base64
                const base64Data = pic_base64.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const filename = `gate/in_${registration_id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
                picUrl = await uploadToStorage(filename, buffer, 'image/jpeg');
            } catch (err) {
                console.error('[Gate] Error saving entry image to Supabase Storage:', err);
                // Continue without image if it fails
            }
        }

        const rawCampus = (campus || 'main').toString().toLowerCase();
        let gateVal: 'main' | 'rnp' | 'paseo' = 'main';
        if (rawCampus.includes('rnp')) gateVal = 'rnp';
        else if (rawCampus.includes('paseo')) gateVal = 'paseo';

        const { error: insertError, data: logData } = await supabase
            .from('gate_log')
            .insert({
                registration_id,
                vehicle_id,
                entered_at: new Date().toISOString(),
                presence_status: 'inside_campus',
                sticker_status: 'registered',
                campus_gate: gateVal,
                note: reason || null
            })
            .select('gate_log_id')
            .single();

        if (insertError) throw insertError;

        // The database trigger on gate_log writes the new parking snapshot

        return json({ success: true, message: 'Entry recorded' });
    } catch (error) {
        console.error('[Gate] Entry error:', error);
        return apiFailure('record the vehicle entry', error);
    }
};
