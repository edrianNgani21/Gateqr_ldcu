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
            const gate = name === 'RNP' ? 'rnp' : (name === 'PASEO' ? 'paseo' : 'main');

            const { data: paData, error: paError } = await supabase
                .from('parking_capacity')
                .select('*')
                .or(`campus.eq.${name},campus_gate.eq.${gate}`)
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (paError) console.error('parking_availability error:', paError);

            // Fetch active event
            const { data: activeEvent } = await supabase
                .from('campus_event')
                .select('*')
                .eq('campus_gate', gate)
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            // Fetch event history
            const { data: history } = await supabase
                .from('campus_event')
                .select('*')
                .eq('campus_gate', gate)
                .eq('is_active', false)
                .order('created_at', { ascending: false });

            const normName = name.toLowerCase();
            const { data: activeLogs } = await supabase
                .from('vehicle_log')
                .select(`
                    vehicle_log_id,
                    campus,
                    campus_gate,
                    logged_status,
                    vip_access,
                    guest_id,
                    registration_id,
                    vehicle_information:vehicle_information_id(type),
                    registration:registration_id(
                        role,
                        vehicle_information:vehicle_information_id(type)
                    )
                `)
                .is('check_out', null);

            const counted = new Set<string | number>();
            let liveOccupied = 0;
            let wheels2 = 0;
            let wheels4 = 0;

            (activeLogs || []).forEach((log: any) => {
                if (log.check_out) return;
                const st = (log.logged_status || '').toLowerCase();
                if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited' || st === 'exited_campus') return;

                const c = (log.campus || log.campus_gate || '').toLowerCase();
                let matches = false;
                if (normName.includes('rnp')) matches = c.includes('rnp');
                else if (normName.includes('paseo')) matches = c.includes('paseo');
                else matches = !c.includes('rnp') && !c.includes('paseo');

                if (!matches) return;

                const isGuestOrVip = !log.registration_id || log.registration_id === 1 || Boolean(log.guest_id) || Boolean(log.vip_access) || st === 'guest' || st === 'vip';
                const vehicleKey = isGuestOrVip ? `log_${log.vehicle_log_id}` : `reg_${log.registration_id}`;

                if (!counted.has(vehicleKey)) {
                    counted.add(vehicleKey);
                    liveOccupied++;
                    const vType = (
                        log.vehicle_information?.type || 
                        log.registration?.vehicle_information?.type || 
                        ''
                    ).toLowerCase();
                    const is2W = vType.includes('2') || vType.includes('motorcycle') || vType.includes('bike') || vType.includes('scooter');
                    if (is2W) wheels2++; else wheels4++;
                }
            });

            const capacity = paData?.parking_capacity ?? paData?.capacity ?? 200;
            const occupied = liveOccupied;
            const available = Math.max(0, capacity - occupied);

            campuses.push({
                name,
                capacity,
                occupied,
                available,
                unoccupied: available,
                wheels2,
                wheels4,
                event_name: activeEvent?.event_name ?? '',
                event_start: activeEvent?.start_date ?? '',
                event_end: activeEvent?.end_date ?? '',
                history: history || []
            });
        } catch (e) {
            // Fallback if error occurs
            campuses.push({
                name,
                capacity: 200,
                occupied: 0,
                available: 200,
                wheels2: 0,
                wheels4: 0,
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
