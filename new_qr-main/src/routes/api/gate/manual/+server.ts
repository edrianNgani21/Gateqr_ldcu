import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';
import { uploadToStorage } from '$lib/server/storage';
import crypto from 'crypto';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

function generateTicketNo() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `GUEST-${result}`;
}

async function saveImage(pic_base64: string, type: string): Promise<string | null> {
    try {
        const base64Data = pic_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `gate/guest_${type}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
        return await uploadToStorage(filename, buffer, 'image/jpeg');
    } catch (err) {
        console.error('[Gate] Error saving guest image to Supabase Storage:', err);
        return null;
    }
}

export const POST: RequestHandler = async ({ request }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { type, ticket_no, name, mobile, make_model, plate, id_number, purpose, reason, pic_base64, logged_status, campus } = await request.json();
        const rawCampus = campus || 'Main Campus';
        let entryCampus = 'Main Campus';
        if (rawCampus.toLowerCase().includes('rnp')) entryCampus = 'RNP';
        else if (rawCampus.toLowerCase().includes('paseo')) entryCampus = 'PASEO';

        if (!type || (type !== 'in' && type !== 'out')) {
            return json({ error: 'Invalid type (must be in or out)' }, { status: 400 });
        }

        const picUrl = pic_base64 ? await saveImage(pic_base64, type) : null;

        if (type === 'in') {
            if (!make_model || !plate) {
                return json({ error: 'make_model and plate are required for in' }, { status: 400 });
            }

            // Generate unique ticket number
            let newTicketNo = ticket_no;
            if (!newTicketNo) {
                let isUnique = false;
                while (!isUnique) {
                    newTicketNo = generateTicketNo();
                    const { data: rows } = await supabase
                        .from('guestlog')
                        .select('guest_id')
                        .eq('ticket_no', newTicketNo)
                        .maybeSingle();
                    
                    if (!rows) isUnique = true;
                }
            }

            // Insert new IN row — out/pic_out are NULL until they leave
            const { error: insertError } = await supabase
                .from('guestlog')
                .insert({
                    ticket_no: newTicketNo,
                    name: name || null,
                    mobile: mobile || null,
                    make_model,
                    plate,
                    id_number: id_number || null,
                    purpose: purpose || reason || null,
                    reason: reason || null,
                    in: new Date().toISOString(),
                    pic_in: picUrl
                });

            if (insertError) throw insertError;

            // Create parking capacity record for guest entry
            // Get current parking capacity settings
            const { data: settingsData } = await supabase
                .from('parking_capacity')
                .select('parking_capacity')
                .eq('campus', entryCampus)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            const parking_capacity = settingsData?.parking_capacity ?? 500;

            // Get current slot counts from the most recent parking capacity record
            const { data: lastParkingData } = await supabase
                .from('parking_capacity')
                .select('slot_occupied, slot_unoccupied')
                .eq('campus', entryCampus)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            const current_occupied = lastParkingData?.slot_occupied || 0;
            const current_unoccupied = lastParkingData?.slot_unoccupied || parking_capacity;

            // Calculate new slot counts
            const new_occupied = current_occupied + 1;
            const new_unoccupied = Math.max(0, current_unoccupied - 1);

            // Get a valid vehicle_log_id for foreign key constraint
            const { data: vehicleLog } = await supabase
                .from('vehicle_log')
                .select('vehicle_log_id')
                .order('vehicle_log_id', { ascending: false })
                .limit(1)
                .maybeSingle();

            const vehicle_log_id = vehicleLog?.vehicle_log_id || null;

            // Create new parking capacity record (use existing vehicle_log_id for guests)
            const { error: parkingError } = await supabase
                .from('parking_capacity')
                .insert({
                    vehicle_log_id, // Use existing vehicle_log_id for foreign key constraint
                    campus: entryCampus,
                    parking_capacity,
                    slot_occupied: new_occupied,
                    slot_unoccupied: new_unoccupied,
                    date_time: new Date().toISOString()
                });

            if (parkingError) {
                console.error('[Gate] Parking record error:', parkingError);
                // Don't throw error - parking is secondary functionality
            }

            return json({ success: true, ticket_no: newTicketNo, message: 'Guest entry recorded' });

        } else {
            // type === 'out'
            if (!ticket_no) {
                return json({ error: 'ticket_no is required for out' }, { status: 400 });
            }

            // Find the most recent open IN record for this ticket (no out yet)
            const { data: rows } = await supabase
                .from('guestlog')
                .select('guest_id')
                .eq('ticket_no', ticket_no)
                .is('out', null)
                .order('in', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (rows) {
                // Update the existing IN row with OUT timestamp and photo
                const { error: updateError } = await supabase
                    .from('guestlog')
                    .update({
                        out: new Date().toISOString(),
                        pic_out: picUrl,
                        logged_status_out: logged_status || null
                    })
                    .eq('guest_id', rows.guest_id);

                if (updateError) throw updateError;

                // Update parking capacity record for guest exit
                // Get current parking capacity settings
                const { data: settingsData } = await supabase
                    .from('parking_capacity')
                    .select('parking_capacity')
                    .eq('campus', entryCampus)
                    .order('date_time', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const parking_capacity = settingsData?.parking_capacity ?? 500;

                // Get current slot counts from the most recent parking capacity record
                const { data: lastParkingData } = await supabase
                    .from('parking_capacity')
                    .select('slot_occupied, slot_unoccupied')
                    .eq('campus', entryCampus)
                    .order('date_time', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const current_occupied = lastParkingData?.slot_occupied || 0;
                const current_unoccupied = lastParkingData?.slot_unoccupied || parking_capacity;

                // Calculate new slot counts
                const new_occupied = Math.max(0, current_occupied - 1);
                const new_unoccupied = Math.min(parking_capacity, current_unoccupied + 1);

                // Get a valid vehicle_log_id for foreign key constraint
                const { data: vehicleLog } = await supabase
                    .from('vehicle_log')
                    .select('vehicle_log_id')
                    .order('vehicle_log_id', { ascending: false })
                    .limit(1)
                const vehicle_log_id = (vehicleLog as any)?.[0]?.vehicle_log_id || null;
                const { error: parkingError } = await supabase
                    .from('parking_capacity')
                    .insert({
                        vehicle_log_id, // Use existing vehicle_log_id for foreign key constraint
                        campus: entryCampus,
                        parking_capacity,
                        slot_occupied: new_occupied,
                        slot_unoccupied: new_unoccupied,
                        date_time: new Date().toISOString()
                    });

                if (parkingError) {
                    console.error('[Gate] Parking record error:', parkingError);
                    // Don't throw error - parking is secondary functionality
                }
            } else {
                // No open IN found — insert a standalone OUT row
                const { data: inRows } = await supabase
                    .from('guestlog')
                    .select('make_model, plate')
                    .eq('ticket_no', ticket_no)
                    .order('in', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const mm = inRows?.make_model || 'Unknown';
                const pl = inRows?.plate || 'Unknown';

                const { error: insertError } = await supabase
                    .from('guestlog')
                    .insert({
                        ticket_no,
                        name: name || null,
                        mobile: mobile || null,
                        make_model: mm,
                        plate: pl,
                        purpose: purpose || reason || null,
                        reason: reason || null,
                        in: new Date().toISOString(),
                        out: new Date().toISOString(),
                        pic_out: picUrl,
                        logged_status_out: logged_status || null
                    });

                if (insertError) throw insertError;

                // Update parking capacity record for guest exit
                // Get current parking capacity settings
                const { data: settingsData } = await supabase
                    .from('parking_capacity')
                    .select('parking_capacity')
                    .eq('campus', entryCampus)
                    .order('date_time', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const parking_capacity = settingsData?.parking_capacity ?? 500;

                // Get current slot counts from the most recent parking capacity record
                const { data: lastParkingData } = await supabase
                    .from('parking_capacity')
                    .select('slot_occupied, slot_unoccupied')
                    .eq('campus', entryCampus)
                    .order('date_time', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const current_occupied = lastParkingData?.slot_occupied || 0;
                const current_unoccupied = lastParkingData?.slot_unoccupied || parking_capacity;

                // Calculate new slot counts
                const new_occupied = Math.max(0, current_occupied - 1);
                const new_unoccupied = Math.min(parking_capacity, current_unoccupied + 1);

                // Get a valid vehicle_log_id for foreign key constraint
                const { data: vehicleLog } = await supabase
                    .from('vehicle_log')
                    .select('vehicle_log_id')
                    .order('vehicle_log_id', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const vehicle_log_id = vehicleLog?.vehicle_log_id || null;

                // Create new parking capacity record (use existing vehicle_log_id for guests)
                const { error: parkingError } = await supabase
                    .from('parking_capacity')
                    .insert({
                        vehicle_log_id, // Use existing vehicle_log_id for foreign key constraint
                        campus: entryCampus,
                        parking_capacity,
                        slot_occupied: new_occupied,
                        slot_unoccupied: new_unoccupied,
                        date_time: new Date().toISOString()
                    });

                if (parkingError) {
                    console.error('[Gate] Parking record error:', parkingError);
                    // Don't throw error - parking is secondary functionality
                }
            }

            return json({ success: true, message: 'Guest exit recorded' });
        }
    } catch (error) {
        console.error('[Gate] Manual entry error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
