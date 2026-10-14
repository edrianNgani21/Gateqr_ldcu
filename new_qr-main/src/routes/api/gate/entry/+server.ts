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
        const { registration_id, pic_base64, logged_status, reason, campus } = await request.json();

        if (!registration_id) {
            return json({ error: 'Missing registration_id' }, { status: 400 });
        }

        // Get vehicle_information_id from registration
        const { data: regData } = await supabase
            .from('registration')
            .select('vehicle_information_id')
            .eq('registration_id', registration_id)
            .single();

        if (!regData) {
            return json({ error: 'Registration not found' }, { status: 404 });
        }

        // Deactivate QR if there is an approved change request pending sticker release
        const { data: activeChange } = await supabase
            .from('modification_request')
            .select('status')
            .eq('registration_id', registration_id)
            .eq('status', 'approved')
            .maybeSingle();

        if (activeChange) {
            return json({ error: 'QR Code is deactivated pending new vehicle sticker release.' }, { status: 403 });
        }

        const vehicle_information_id = regData.vehicle_information_id;

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
        const entryCampus = gateVal === 'rnp' ? 'RNP' : (gateVal === 'paseo' ? 'PASEO' : 'Main Campus');

        const { error: insertError, data: logData } = await supabase
            .from('vehicle_log')
            .insert({
                registration_id,
                vehicle_information_id,
                check_in: new Date().toISOString(),
                logged_status: 'inside_campus',
                sticker_status: 'registered',
                campus_gate: gateVal,
                reason: reason || null
            })
            .select('vehicle_log_id')
            .single();

        if (insertError) throw insertError;

        // Create parking availability record
        const vehicle_log_id = logData.vehicle_log_id;

        // Get current parking capacity settings
        const { data: settingsData } = await supabase
            .from('parking_capacity')
            .select('parking_capacity')
            .eq('campus', entryCampus)
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const parking_capacity = settingsData?.parking_capacity ?? 500;

        // Get current slot counts from the most recent parking availability record
        const { data: lastParkingData } = await supabase
            .from('parking_capacity')
            .select('slot_occupied, slot_unoccupied')
            .eq('campus', entryCampus)
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        let current_occupied = lastParkingData?.slot_occupied;
        if (current_occupied === undefined || current_occupied === null) {
            const { data: insideLogs } = await supabase
                .from('vehicle_log')
                .select('campus, registration:registration_id(campus)')
                .is('check_out', null);

            current_occupied = (insideLogs || []).filter((l: any) => {
                const c = (l.campus || l.registration?.campus || '').toLowerCase();
                if (entryCampus === 'RNP') return c.includes('rnp');
                if (entryCampus === 'PASEO') return c.includes('paseo');
                return !c.includes('rnp') && !c.includes('paseo');
            }).length;
        }

        // Calculate new slot counts
        const new_occupied = current_occupied + 1;
        const new_unoccupied = Math.max(0, parking_capacity - new_occupied);

        // Create new parking availability record
        const { error: parkingError } = await supabase
            .from('parking_capacity')
            .insert({
                vehicle_log_id,
                campus: entryCampus,
                parking_capacity,
                slot_occupied: new_occupied,
                slot_unoccupied: new_unoccupied,
                date_time: new Date().toISOString()
            });

        if (parkingError) {
            console.error('[Gate] Parking capacity insert error:', parkingError);
        }

        return json({ success: true, message: 'Entry recorded' });
    } catch (error) {
        console.error('[Gate] Entry error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
