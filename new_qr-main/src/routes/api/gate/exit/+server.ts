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
        const { registration_id, pic_base64, logged_status, campus } = await request.json();

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
            .from('change_vehicle_request')
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
            .from('vehicle_log')
            .select('vehicle_log_id, campus_gate')
            .eq('registration_id', registration_id)
            .is('check_out', null)
            .order('check_in', { ascending: false })
            .limit(1)
            .single();

        const rawExitCampus = (rows?.campus_gate || campus || 'main').toString().toLowerCase();
        let gateVal: 'main' | 'rnp' | 'paseo' = 'main';
        if (rawExitCampus.includes('rnp')) gateVal = 'rnp';
        else if (rawExitCampus.includes('paseo')) gateVal = 'paseo';
        const exitCampus = gateVal === 'rnp' ? 'RNP' : (gateVal === 'paseo' ? 'PASEO' : 'Main Campus');

        if (rows && !queryError) {
            // Update existing open entry log with OUT time and status
            const { error: updateError } = await supabase
                .from('vehicle_log')
                .update({
                    check_out: new Date().toISOString(),
                    logged_status: 'exited_campus'
                })
                .eq('vehicle_log_id', rows.vehicle_log_id);

            if (updateError) throw updateError;

            // Update parking availability record - decrement occupied, increment unoccupied
            const vehicle_log_id = rows.vehicle_log_id;

            // Get current parking capacity settings
            const { data: settingsData } = await supabase
                .from('parking_availability')
                .select('parking_capacity')
                .eq('campus', exitCampus)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            const parking_capacity = settingsData?.parking_capacity ?? 500;

            // Get current slot counts from the most recent parking availability record
            const { data: lastParkingData } = await supabase
                .from('parking_availability')
                .select('slot_occupied, slot_unoccupied')
                .eq('campus', exitCampus)
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
                    if (exitCampus === 'RNP') return c.includes('rnp');
                    if (exitCampus === 'PASEO') return c.includes('paseo');
                    return !c.includes('rnp') && !c.includes('paseo');
                }).length;
            }

            // Calculate new slot counts
            const new_occupied = Math.max(0, current_occupied - 1);
            const new_unoccupied = Math.min(parking_capacity, Math.max(0, parking_capacity - new_occupied));

            // Create new parking availability record
            const { error: parkingError } = await supabase
                .from('parking_availability')
                .insert({
                    vehicle_log_id,
                    campus: exitCampus,
                    parking_capacity,
                    slot_occupied: new_occupied,
                    slot_unoccupied: new_unoccupied,
                    date_time: new Date().toISOString()
                });

            if (parkingError) {
                console.error('[Gate] Parking availability exit insert error:', parkingError);
            }
        } else {
            // No open entry log found — create a standalone OUT row
            const { error: insertError } = await supabase
                .from('vehicle_log')
                .insert({
                    registration_id,
                    vehicle_information_id,
                    check_out: new Date().toISOString(),
                    pic_out: picUrl,
                    logged_status_out: logged_status || null,
                });

            if (insertError) throw insertError;
        }

        return json({ success: true, message: 'Exit recorded' });
    } catch (error) {
        console.error('[Gate] Exit error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
