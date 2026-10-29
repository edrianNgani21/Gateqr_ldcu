import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { invalidateCapacityServerCache } from '$lib/server/capacityCache';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { campus, capacity_2_wheels, capacity_4_wheels, event_name, start_date, end_date, remove_event, check_expired } = await request.json();

        if (check_expired) {
            invalidateCapacityServerCache();
            const nowIso = new Date().toISOString();
            await supabase
                .from('campus_event')
                .update({ is_active: false })
                .eq('is_active', true)
                .lt('end_date', nowIso);
            return json({ success: true });
        }

        if (!campus) {
            return json({ error: 'Invalid input data' }, { status: 400 });
        }

        const gate = campus === 'RNP' ? 'rnp' : (campus === 'PASEO' ? 'paseo' : 'main');

        // If removing an event, just deactivate it in campus_event
        if (remove_event) {
            await supabase
                .from('campus_event')
                .update({ is_active: false })
                .eq('campus_gate', gate)
                .eq('is_active', true);

            // Also clear it from parking_capacity just to be safe
            const { data: latestPa } = await supabase
                .from('parking_capacity')
                .select('parking_availability_id')
                .or(`campus.eq.${campus},campus_gate.eq.${gate}`)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();
                
            if (latestPa) {
                await supabase.from('parking_capacity').update({ event_name: null }).eq('parking_availability_id', latestPa.parking_availability_id);
            }
            invalidateCapacityServerCache();
            return json({ success: true });
        }

        // Handle regular capacity updates: separate 2-wheel and 4-wheel limits, total is their sum
        const isLimit = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000;
        if (!isLimit(capacity_2_wheels) || !isLimit(capacity_4_wheels)) {
            return json({ error: '2-wheel and 4-wheel limits must be whole numbers from 0 to 10000.' }, { status: 400 });
        }
        const parking_capacity = capacity_2_wheels + capacity_4_wheels;

        const isEventEnded = Boolean(event_name && end_date && new Date(end_date).getTime() <= Date.now());
        const effectiveEventName = (!isEventEnded && event_name) ? event_name : null;

        // Deactivate old active events for this campus if we're setting a new one
        if (event_name && start_date && end_date) {
            await supabase
                .from('campus_event')
                .update({ is_active: false })
                .eq('campus_gate', gate)
                .eq('is_active', true);
            
            // Insert the new event (if end_date has already passed, save directly to history as is_active: false)
            await supabase
                .from('campus_event')
                .insert([{
                    user_id: locals.user.user_id,
                    campus_gate: gate,
                    event_name,
                    start_date,
                    end_date,
                    is_active: !isEventEnded
                }]);
        }

        // We insert a new record for this campus to act as the latest state
        // Need to know current occupied to carry it over
        const { data: lastData } = await supabase
            .from('parking_capacity')
            .select('*')
            .or(`campus.eq.${campus},campus_gate.eq.${gate}`)
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const occupied = lastData?.slot_occupied ?? lastData?.occupied ?? 0;
        const available = Math.max(0, parking_capacity - occupied);
        const nowIso = new Date().toISOString();

        if (lastData) {
            // Update the existing latest record to avoid creating duplicate rows and foreign key constraint issues
            const { error } = await supabase
                .from('parking_capacity')
                .update({
                    parking_capacity,
                    capacity: parking_capacity,
                    capacity_2_wheels,
                    capacity_4_wheels,
                    slot_occupied: occupied,
                    occupied: occupied,
                    slot_unoccupied: available,
                    available: available,
                    campus: campus,
                    campus_gate: gate,
                    event_name: effectiveEventName,
                    date_time: nowIso,
                    recorded_at: nowIso
                })
                .eq('parking_availability_id', lastData.parking_availability_id);
                
            if (error) throw error;
        } else {
            // Get a valid vehicle_log_id for foreign key constraint if we must insert
            let vehicle_log_id = null;

            // First try to get it from vehicle_log
            const { data: vehicleLog } = await supabase
                .from('vehicle_log')
                .select('vehicle_log_id')
                .order('vehicle_log_id', { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (vehicleLog?.vehicle_log_id) {
                vehicle_log_id = vehicleLog.vehicle_log_id;
            } else {
                // Fallback: Try to get any valid vehicle_log_id from existing parking_capacity
                const { data: anyPa } = await supabase
                    .from('parking_capacity')
                    .select('vehicle_log_id')
                    .not('vehicle_log_id', 'is', null)
                    .limit(1)
                    .maybeSingle();
                
            if (anyPa?.vehicle_log_id) {
                vehicle_log_id = anyPa.vehicle_log_id;
            } else {
                vehicle_log_id = null;
            }
        }

            const { error } = await supabase
                .from('parking_capacity')
                .insert([{
                    vehicle_log_id,
                    campus,
                    campus_gate: gate,
                    parking_capacity,
                    capacity: parking_capacity,
                    capacity_2_wheels,
                    capacity_4_wheels,
                    slot_occupied: occupied,
                    occupied: occupied,
                    slot_unoccupied: available,
                    available: available,
                    event_name: effectiveEventName,
                    date_time: nowIso,
                    recorded_at: nowIso
                }]);
                
            if (error) {
                // If it still fails, try updating ANY existing record and changing its campus
                // (Only do this as an absolute last resort to avoid crashing)
                const { data: anyRecord } = await supabase
                    .from('parking_capacity')
                    .select('*')
                    .limit(1)
                    .maybeSingle();
                    
                if (anyRecord) {
                    const { error: updateError } = await supabase
                        .from('parking_capacity')
                        .insert([{
                            vehicle_log_id: anyRecord.vehicle_log_id,
                            campus,
                            parking_capacity,
                            capacity_2_wheels,
                            capacity_4_wheels,
                            slot_occupied: occupied,
                            slot_unoccupied: available,
                            event_name: effectiveEventName
                        }]);
                        
                    if (updateError) {
                        if (updateError.code === '23502' || updateError.code === '23503') {
                            return json({ error: 'DATABASE ERROR: You must run "ALTER TABLE parking_capacity ALTER COLUMN vehicle_log_id DROP NOT NULL;" in your Supabase SQL Editor to initialize capacity!' }, { status: 400 });
                        }
                        throw updateError;
                    }
                } else {
                    if (error.code === '23502' || error.code === '23503') {
                        return json({ error: 'DATABASE ERROR: You must run "ALTER TABLE parking_capacity ALTER COLUMN vehicle_log_id DROP NOT NULL;" in your Supabase SQL Editor to initialize capacity!' }, { status: 400 });
                    }
                    throw error;
                }
            }
        }

        invalidateCapacityServerCache();
        return json({ success: true });
    } catch (error: any) {
        console.error('Error updating capacity:', error);
        return json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
};
