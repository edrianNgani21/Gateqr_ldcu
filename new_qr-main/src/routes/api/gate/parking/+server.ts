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
        // Limits from parking_capacity, occupancy counted live from gate_log
        const { data: occupancy } = await supabase
            .from('campus_occupancy')
            .select('capacity, occupied, available, updated_at')
            .eq('campus_gate', 'main')
            .maybeSingle();

        const parking_capacity = occupancy?.capacity ?? 0;
        const current_occupied = occupancy?.occupied || 0;
        const current_unoccupied = occupancy?.available ?? parking_capacity;
        const last_updated = occupancy?.updated_at || null;

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