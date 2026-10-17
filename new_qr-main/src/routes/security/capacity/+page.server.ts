import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { getCachedCapacity, setCachedCapacity } from '$lib/server/capacityCache';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    const cached = getCachedCapacity();
    if (cached) {
        return {
            userEmail: locals.user.email,
            userRole: locals.user.role,
            campuses: cached
        };
    }

    const campusesList = ['Main Campus', 'RNP', 'PASEO'];
    const nowIso = new Date().toISOString();

    try {
        // Run consolidated queries in parallel in a single round-trip
        const [activeLogsRes, parkingCapRes, campusEventRes] = await Promise.all([
            // 1. Fetch active logs once for all campuses
            supabase
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
                .is('check_out', null),

            // 2. Fetch all latest parking capacities in one consolidated query
            supabase
                .from('parking_capacity')
                .select('*')
                .order('date_time', { ascending: false })
                .limit(20),

            // 3. Fetch all events (active & past) in one consolidated query
            supabase
                .from('campus_event')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(60)
        ]);

        const activeLogs = activeLogsRes.data || [];
        const allParkingCap = parkingCapRes.data || [];
        const allEvents = campusEventRes.data || [];

        // Build campus presence and vehicle counts in memory (instant)
        const countedByCampus: Record<string, Set<string | number>> = {
            'main': new Set(),
            'rnp': new Set(),
            'paseo': new Set()
        };
        const countsByCampus: Record<string, { occupied: number; wheels2: number; wheels4: number }> = {
            'main': { occupied: 0, wheels2: 0, wheels4: 0 },
            'rnp': { occupied: 0, wheels2: 0, wheels4: 0 },
            'paseo': { occupied: 0, wheels2: 0, wheels4: 0 }
        };

        activeLogs.forEach((log: any) => {
            if (log.check_out) return;
            const st = (log.logged_status || '').toLowerCase();
            if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited' || st === 'exited_campus') return;

            const c = (log.campus || log.campus_gate || '').toLowerCase();
            let key = 'main';
            if (c.includes('rnp')) key = 'rnp';
            else if (c.includes('paseo')) key = 'paseo';

            const isGuestOrVip = !log.registration_id || log.registration_id === 1 || Boolean(log.guest_id) || Boolean(log.vip_access) || st === 'guest' || st === 'vip';
            const vehicleKey = isGuestOrVip ? `log_${log.vehicle_log_id}` : `reg_${log.registration_id}`;

            if (!countedByCampus[key].has(vehicleKey)) {
                countedByCampus[key].add(vehicleKey);
                countsByCampus[key].occupied++;
                const vType = (
                    log.vehicle_information?.type || 
                    log.registration?.vehicle_information?.type || 
                    ''
                ).toLowerCase();
                const is2W = vType.includes('2') || vType.includes('motorcycle') || vType.includes('bike') || vType.includes('scooter');
                if (is2W) countsByCampus[key].wheels2++;
                else countsByCampus[key].wheels4++;
            }
        });

        const nowMs = Date.now();
        const campuses = campusesList.map((name) => {
            const gate = name === 'RNP' ? 'rnp' : (name === 'PASEO' ? 'paseo' : 'main');
            const key = gate;
            const stats = countsByCampus[key];

            // Latest parking capacity row for this campus/gate
            const paData = allParkingCap.find(
                (p: any) => (p.campus && p.campus.toLowerCase() === name.toLowerCase()) || (p.campus_gate && p.campus_gate.toLowerCase() === gate)
            );

            // Campus events filtered in memory
            const campusEvents = allEvents.filter(
                (e: any) => (e.campus_gate && e.campus_gate.toLowerCase() === gate)
            );

            // Active event strictly must not have passed its end_date
            const activeEvent = campusEvents.find((e: any) => {
                if (!e.is_active) return false;
                if (!e.end_date) return true;
                const endMs = new Date(e.end_date).getTime();
                return !isNaN(endMs) && endMs > nowMs;
            });

            // History events: all inactive events or events whose end_date has passed
            const history = campusEvents.filter((e: any) => {
                if (!e.is_active) return true;
                if (!e.end_date) return false;
                const endMs = new Date(e.end_date).getTime();
                return !isNaN(endMs) && endMs <= nowMs;
            }).slice(0, 30);

            const capacity = paData?.parking_capacity ?? paData?.capacity ?? 200;
            const occupied = stats.occupied;
            const available = Math.max(0, capacity - occupied);

            return {
                name,
                capacity,
                occupied,
                available,
                unoccupied: available,
                wheels2: stats.wheels2,
                wheels4: stats.wheels4,
                event_name: activeEvent?.event_name ?? '',
                event_start: activeEvent?.start_date ?? '',
                event_end: activeEvent?.end_date ?? '',
                history: history as any[]
            };
        });

        setCachedCapacity(campuses);

        return {
            userEmail: locals.user.email,
            userRole: locals.user.role,
            campuses
        };
    } catch (e) {
        console.error('Error loading security capacity:', e);
        return {
            userEmail: locals.user.email,
            userRole: locals.user.role,
            campuses: campusesList.map(name => ({
                name,
                capacity: 200,
                occupied: 0,
                available: 200,
                unoccupied: 200,
                wheels2: 0,
                wheels4: 0,
                event_name: '',
                event_start: '',
                event_end: '',
                history: [] as any[]
            }))
        };
    }
};
