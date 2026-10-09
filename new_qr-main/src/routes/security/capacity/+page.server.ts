import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    // We will attempt to fetch from the DB, but since the schema migration
    // might not be run yet, we handle errors gracefully.
    const campusesList = ['Main Campus', 'RNP', 'PASEO'];
    const campuses = [];

    for (const name of campusesList) {
        try {
            const { data: paData, error: paError } = await supabase
                .from('parking_availability')
                .select('*')
                .eq('campus', name)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (paError) throw paError;

            // Fetch active event
            const { data: activeEvent } = await supabase
                .from('campus_events')
                .select('*')
                .eq('campus', name)
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            // Fetch event history
            const { data: history } = await supabase
                .from('campus_events')
                .select('*')
                .eq('campus', name)
                .eq('is_active', false)
                .order('created_at', { ascending: false });

            const normName = name.toLowerCase();
            const { data: activeLogs } = await supabase
                .from('vehicle_log')
                .select('campus, logged_status, registration:registration_id(campus)')
                .is('check_out', null);
            
            const liveOccupied = (activeLogs || []).filter((l: any) => {
                const st = (l.logged_status || '').toLowerCase();
                if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited') return false;
                const c = (l.campus || l.registration?.campus || '').toLowerCase();
                if (normName.includes('rnp')) return c.includes('rnp');
                if (normName.includes('paseo')) return c.includes('paseo');
                return !c.includes('rnp') && !c.includes('paseo');
            }).length;

            const capacity = paData?.parking_capacity ?? 200;
            const occupied = liveOccupied;
            const available = Math.max(0, capacity - occupied);

            campuses.push({
                name,
                capacity,
                occupied,
                available,
                event_name: activeEvent?.event_name ?? '',
                event_start: activeEvent?.start_date ?? '',
                event_end: activeEvent?.end_date ?? '',
                history: history || []
            });
        } catch (e) {
            // Fallback if column does not exist yet
            campuses.push({
                name,
                capacity: 200,
                occupied: 0,
                available: 200,
                event_name: '',
                event_start: '',
                event_end: '',
                history: []
            });
        }
    }

    return {
        userEmail: locals.user.email,
        userRole: locals.user.role,
        campuses
    };
};
