import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

export const GET: RequestHandler = async ({ request, locals }) => {
    const isGate = checkAuth(request);
    const isOsa = locals.user && (locals.user.role === 'osa' || locals.user.role === 'security');

    if (!isGate && !isOsa) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // Get current parking capacity settings
        const { data: settingsData } = await supabase
            .from('parking_capacity')
            .select('parking_capacity')
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const parking_capacity = settingsData?.parking_capacity ?? 0;

        // Get current slot counts from the most recent parking availability record
        const { data: lastParkingData } = await supabase
            .from('parking_capacity')
            .select('slot_occupied, slot_unoccupied, date_time')
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const current_occupied = lastParkingData?.slot_occupied || 0;
        const current_unoccupied = lastParkingData?.slot_unoccupied || parking_capacity;
        const last_updated = lastParkingData?.date_time || null;

        // Calculate availability percentage
        const availability_percentage = parking_capacity > 0
            ? Math.round((current_unoccupied / parking_capacity) * 100)
            : 0;

        return json({
            parking_capacity,
            slot_occupied: current_occupied,
            slot_unoccupied: current_unoccupied,
            availability_percentage,
            last_updated,
            is_full: current_unoccupied === 0,
            is_available: current_unoccupied > 0
        });
    } catch (error) {
        console.error('[Gate] Parking availability error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};