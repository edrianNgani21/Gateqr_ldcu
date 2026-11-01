import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { invalidateCapacityServerCache } from '$lib/server/capacityCache';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { campus, capacity_2_wheels, capacity_4_wheels, event_name, starts_at, ends_at, remove_event, check_expired } = await request.json();

        if (check_expired) {
            invalidateCapacityServerCache();
            const nowIso = new Date().toISOString();
            await supabase
                .from('campus_event')
                .update({ is_active: false })
                .eq('is_active', true)
                .lt('ends_at', nowIso);
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
                .select('parking_capacity_id')
                .eq('campus_gate', gate)
                .order('recorded_at', { ascending: false })
                .limit(1)
                .maybeSingle();
                
            if (latestPa) {
                await supabase.from('parking_capacity').update({ event_name: null }).eq('parking_capacity_id', latestPa.parking_capacity_id);
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

        const isEventEnded = Boolean(event_name && ends_at && new Date(ends_at).getTime() <= Date.now());
        const effectiveEventName = (!isEventEnded && event_name) ? event_name : null;

        // Deactivate old active events for this campus if we're setting a new one
        if (event_name && starts_at && ends_at) {
            await supabase
                .from('campus_event')
                .update({ is_active: false })
                .eq('campus_gate', gate)
                .eq('is_active', true);
            
            // Insert the new event (if ends_at has already passed, save directly to history as is_active: false)
            await supabase
                .from('campus_event')
                .insert([{
                    created_by_user_id: locals.user.user_id,
                    campus_gate: gate,
                    event_name,
                    starts_at,
                    ends_at,
                    is_active: !isEventEnded
                }]);
        }

        // We insert a new record for this campus to act as the latest state
        // Need to know current occupied to carry it over
        const { data: lastData } = await supabase
            .from('parking_capacity')
            .select('*')
            .eq('campus_gate', gate)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const occupied = lastData?.occupied ?? 0;
        const available = Math.max(0, parking_capacity - occupied);
        const nowIso = new Date().toISOString();

        const row = {
            capacity: parking_capacity,
            capacity_2_wheels,
            capacity_4_wheels,
            occupied,
            available,
            campus_gate: gate,
            event_name: effectiveEventName,
            recorded_at: nowIso
        };

        // Update the latest record for this campus, or start one if the campus has none yet
        const { error } = lastData
            ? await supabase.from('parking_capacity').update(row).eq('parking_capacity_id', lastData.parking_capacity_id)
            : await supabase.from('parking_capacity').insert([row]);
        if (error) throw error;

        invalidateCapacityServerCache();
        return json({ success: true });
    } catch (error: any) {
        console.error('Error updating capacity:', error);
        return json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
};
