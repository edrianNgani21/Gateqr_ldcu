import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    const userEmail = locals.user.email;
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    try {
        // 1. Fetch all currently active inside vehicles (where check_out is null)
        const { data: activeInsideLogs } = await supabase
            .from('vehicle_log')
            .select(`
                vehicle_log_id,
                check_in,
                check_out,
                logged_status,
                vip_access,
                guest_id,
                campus,
                campus_gate,
                registration_id,
                vehicle_information:vehicle_information_id(
                    type
                ),
                registration:registration_id(
                    role,
                    vehicle_information:vehicle_information_id(
                        type
                    )
                )
            `)
            .is('check_out', null);

        let mainCampusPresence = 0;
        let rnpCampusPresence = 0;
        let paseoCampusPresence = 0;
        let main2W = 0, main4W = 0;
        let rnp2W = 0, rnp4W = 0;
        let paseo2W = 0, paseo4W = 0;

        const countedMain = new Set<string | number>();
        const countedRnp = new Set<string | number>();
        const countedPaseo = new Set<string | number>();

        (activeInsideLogs || []).forEach((log: any) => {
            // If vehicle has exit (check_out is set or logged_status is exit/out/denied/exited/exited_campus), currently in is 0
            if (log.check_out) return;
            const st = (log.logged_status || '').toLowerCase();
            if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited' || st === 'exited_campus') return;

            const isGuestOrVip = !log.registration_id || log.registration_id === 1 || Boolean(log.guest_id) || Boolean(log.vip_access) || st === 'guest' || st === 'vip';
            const vehicleKey = isGuestOrVip ? `log_${log.vehicle_log_id}` : `reg_${log.registration_id}`;

            const vType = (
                log.vehicle_information?.type || 
                log.registration?.vehicle_information?.type || 
                ''
            ).toLowerCase();
            const is2W = vType.includes('2') || vType.includes('motorcycle') || vType.includes('bike') || vType.includes('scooter');

            const c = (log.campus || log.campus_gate || '').toLowerCase();
            if (c.includes('rnp')) {
                if (!countedRnp.has(vehicleKey)) {
                    countedRnp.add(vehicleKey);
                    rnpCampusPresence++;
                    if (is2W) rnp2W++; else rnp4W++;
                }
            } else if (c.includes('paseo')) {
                if (!countedPaseo.has(vehicleKey)) {
                    countedPaseo.add(vehicleKey);
                    paseoCampusPresence++;
                    if (is2W) paseo2W++; else paseo4W++;
                }
            } else {
                if (!countedMain.has(vehicleKey)) {
                    countedMain.add(vehicleKey);
                    mainCampusPresence++;
                    if (is2W) main2W++; else main4W++;
                }
            }
        });

        // 2. Fetch today's vehicle entries for hourly traffic chart and role breakdown
        let todayLogs: any[] = [];
        const { data: logsByCheckIn, error: errCheckIn } = await supabase
            .from('vehicle_log')
            .select(`
                vehicle_log_id,
                check_in,
                check_out,
                created_at,
                logged_status,
                reason,
                campus,
                vehicle_information:vehicle_information_id(
                    brand,
                    plate_number,
                    type,
                    color
                ),
                registration:registration_id(
                    first_name,
                    last_name,
                    role
                )
            `)
            .gte('check_in', today)
            .lt('check_in', tomorrow)
            .order('check_in', { ascending: false });

        if (!errCheckIn && logsByCheckIn && logsByCheckIn.length > 0) {
            todayLogs = logsByCheckIn;
        } else {
            const { data: logsByCreated } = await supabase
                .from('vehicle_log')
                .select(`
                    vehicle_log_id,
                    check_in,
                    check_out,
                    created_at,
                    logged_status,
                    reason,
                    campus,
                    vehicle_information:vehicle_information_id(
                        brand,
                        plate_number,
                        type,
                        color
                    ),
                    registration:registration_id(
                        first_name,
                        last_name,
                        role
                    )
                `)
                .gte('created_at', today)
                .lt('created_at', tomorrow)
                .order('created_at', { ascending: false });
            if (logsByCreated && logsByCreated.length > 0) {
                todayLogs = logsByCreated;
            } else {
                const { data: recentLogs } = await supabase
                    .from('vehicle_log')
                    .select(`
                        vehicle_log_id,
                        check_in,
                        check_out,
                        created_at,
                        logged_status,
                        reason,
                        campus,
                        vehicle_information:vehicle_information_id(
                            brand,
                            plate_number,
                            type,
                            color
                        ),
                        registration:registration_id(
                            first_name,
                            last_name,
                            role
                        )
                    `)
                    .order('created_at', { ascending: false })
                    .limit(50);
                if (recentLogs) todayLogs = recentLogs;
            }
        }

        const hourlyChart = Array(24).fill(0);
        const roleBreakdownByCampus: Record<string, Record<string, number>> = {
            'Main Campus': { student: 0, employee: 0, visitor: 0, concessionaire: 0, guest: 0, vip: 0 },
            'RNP': { student: 0, employee: 0, visitor: 0, concessionaire: 0, guest: 0, vip: 0 },
            'PASEO': { student: 0, employee: 0, visitor: 0, concessionaire: 0, guest: 0, vip: 0 }
        };

        todayLogs.forEach((log: any) => {
            // Hourly distribution
            const timeStr = log.check_in || log.created_at;
            if (timeStr) {
                const hour = new Date(timeStr).getHours();
                if (hour >= 0 && hour < 24) {
                    hourlyChart[hour]++;
                }
            }

            // Role breakdown
            const role = (log.registration?.role || 'visitor').toLowerCase();
            const logCampus = (log.campus || log.campus_gate || 'Main Campus');
            
            // Normalize campus name to match our keys
            let mappedCampus = 'Main Campus';
            if (logCampus.toLowerCase().includes('rnp')) mappedCampus = 'RNP';
            else if (logCampus.toLowerCase().includes('paseo')) mappedCampus = 'PASEO';
            
            if (roleBreakdownByCampus[mappedCampus]) {
                if (roleBreakdownByCampus[mappedCampus][role] !== undefined) {
                    roleBreakdownByCampus[mappedCampus][role]++;
                } else {
                    roleBreakdownByCampus[mappedCampus].visitor++;
                }
            }
        });

        // Flagged alerts / anomalies (e.g. QR code not recognized, duplicate entry, denied access)
        const { data: flaggedRows } = await supabase
            .from('vehicle_log')
            .select(`
                vehicle_log_id,
                check_in,
                created_at,
                logged_status,
                reason,
                campus,
                vehicle_information:vehicle_information_id(
                    brand,
                    plate_number,
                    type
                ),
                registration:registration_id(
                    first_name,
                    last_name,
                    role
                )
            `)
            .or('reason.not.is.null,logged_status.neq.Inside,logged_status.neq.OK')
            .order('check_in', { ascending: false })
            .limit(10);

        const flaggedAlerts = (flaggedRows || [])
            .filter((r: any) => {
                const st = (r.logged_status || '').toLowerCase();
                const reason = (r.reason || '').toLowerCase();
                return reason.length > 0 || (st !== 'inside' && st !== 'ok' && st !== '');
            })
            .map((r: any) => ({
                id: r.vehicle_log_id,
                time: r.check_in || r.created_at || new Date().toISOString(),
                reason: r.reason || (r.logged_status === 'Denied' ? 'QR Code Not Recognized / Denied' : r.logged_status) || 'Flagged Alert',
                plate: r.vehicle_information?.plate_number || 'No Plate',
                name: `${r.registration?.first_name || ''} ${r.registration?.last_name || ''}`.trim() || 'Guest / Unregistered',
                role: r.registration?.role ? (r.registration.role.charAt(0).toUpperCase() + r.registration.role.slice(1)) : 'Visitor',
                campus: r.campus || 'Main Campus',
                status: r.logged_status || 'Flagged'
            }));

        // Complaints count
        const [
            { count: totalComplaints },
            { count: unreadComplaints },
            { count: vehicleCount }
        ] = await Promise.all([
            supabase.from('incident_report').select('*', { count: 'exact', head: true }),
            supabase.from('incident_report').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('registration').select('*', { count: 'exact', head: true }).in('status', ['approved', 'distributed', 'completed', 'security_checked'])
        ]);

        // Get active events for campuses
        let mainEvent = null;
        let rnpEvent = null;
        let paseoEvent = null;
        
        let mainCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let rnpCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let paseoCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };

        try {
            const campusesList = ['Main Campus', 'RNP', 'PASEO'];
            const campusResults = await Promise.all(campusesList.map(async (name) => {
                const gate = name === 'RNP' ? 'rnp' : (name === 'PASEO' ? 'paseo' : 'main');
                const [paRes, evRes] = await Promise.all([
                    supabase
                        .from('parking_capacity')
                        .select('*')
                        .or(`campus.eq.${name},campus_gate.eq.${gate}`)
                        .order('date_time', { ascending: false })
                        .limit(1)
                        .maybeSingle(),
                    supabase
                        .from('campus_event')
                        .select('*')
                        .eq('campus_gate', gate)
                        .eq('is_active', true)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle()
                ]);
                return { name, paData: paRes.data, evData: evRes.data };
            }));

            for (const { name, paData, evData } of campusResults) {
                const presence = name === 'RNP' ? rnpCampusPresence : (name === 'PASEO' ? paseoCampusPresence : mainCampusPresence);
                const cap = paData?.parking_capacity ?? paData?.capacity ?? 200;
                const occ = presence;
                const avail = Math.max(0, cap - occ);

                if (name === 'Main Campus') mainCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };
                if (name === 'RNP') rnpCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };
                if (name === 'PASEO') paseoCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };

                if (evData?.event_name) {
                    const evt = { name: evData.event_name, start: evData.start_date, end: evData.end_date };
                    if (name === 'Main Campus') mainEvent = evt;
                    if (name === 'RNP') rnpEvent = evt;
                    if (name === 'PASEO') paseoEvent = evt;
                }
            }
        } catch (e) {
            console.error('Error fetching events/capacity:', e);
        }

        return {
            userEmail,
            userRole: locals.user.role,
            stats: {
                totalEntriesToday: todayLogs.length,
                mainCampusPresence,
                rnpCampusPresence,
                paseoCampusPresence,
                main2W, main4W,
                rnp2W, rnp4W,
                paseo2W, paseo4W,
                vehicleCount: vehicleCount || 0,
                totalComplaints: totalComplaints || 0,
                mainEvent,
                rnpEvent,
                paseoEvent,
                mainCapacity,
                rnpCapacity,
                paseoCapacity
            },
            roleBreakdownByCampus,
            hourlyChart,
            unreadComplaints: unreadComplaints || 0,
            flaggedAlerts,
            latestInsideLog: activeInsideLogs && activeInsideLogs.length > 0 ? activeInsideLogs[0] : null
        };
    } catch (e) {
        console.error('Error loading security dashboard data:', e);
        return {
            userEmail,
            userRole: locals.user.role,
            stats: {
                totalEntriesToday: 0,
                twoWheelers: 0,
                fourWheelers: 0,
                mainCampusPresence: 0,
                rnpCampusPresence: 0,
                paseoCampusPresence: 0,
                vehicleCount: 0,
                totalComplaints: 0
            },
            roleBreakdown: {
                student: 0,
                employee: 0,
                visitor: 0,
                concessionaire: 0,
                guest: 0,
                vip: 0
            } as any,
            hourlyChart: Array(24).fill(0),
            unreadComplaints: 0,
            flaggedAlerts: []
        };
    }
};