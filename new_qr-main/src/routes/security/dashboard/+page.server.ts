import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

let cachedDashboard: { data: any; timestamp: number } | null = null;

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    const now = Date.now();
    if (cachedDashboard && (now - cachedDashboard.timestamp < 4000)) {
        return cachedDashboard.data;
    }

    const userEmail = locals.user.email;
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    try {
        const campusesList = ['Main Campus', 'RNP', 'PASEO'];

        // Run all queries concurrently in parallel for ultra-fast load time
        const [
            activeInsideRes,
            todayLogsRes,
            flaggedRowsRes,
            complaintsCountsRes,
            campusResults
        ] = await Promise.all([
            // 1. All currently active inside vehicles (where check_out is null)
            supabase
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
                .is('check_out', null),

            // 2. Today's vehicle entries for hourly traffic chart and role breakdown
            supabase
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
                .or(`check_in.gte.${today},created_at.gte.${today}`)
                .order('check_in', { ascending: false })
                .limit(200),

            // 3. Flagged alerts / anomalies
            supabase
                .from('vehicle_log')
                .select(`
                    vehicle_log_id,
                    check_in,
                    created_at,
                    logged_status,
                    reason,
                    campus,
                    campus_gate,
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
                .or('reason.not.is.null,logged_status.ilike.%denied%,logged_status.ilike.%flagged%')
                .order('check_in', { ascending: false })
                .limit(20),

            // 4. Incident report & registration counts
            Promise.all([
                supabase.from('incident_report').select('*', { count: 'exact', head: true }),
                supabase.from('incident_report').select('*', { count: 'exact', head: true }).or('status.eq.pending,status.eq.Pending'),
                supabase.from('registration').select('*', { count: 'exact', head: true }).in('status', ['approved', 'distributed', 'completed', 'security_checked'])
            ]),

            // 5. Parking capacity & active events for all 3 campuses
            Promise.all(campusesList.map(async (name) => {
                const gate = name === 'RNP' ? 'rnp' : (name === 'PASEO' ? 'paseo' : 'main');
                const nowIso = new Date().toISOString();
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
                        .gt('end_date', nowIso)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle()
                ]);
                return { name, paData: paRes.data, evData: evRes.data };
            }))
        ]);

        const activeInsideLogs = activeInsideRes.data || [];
        const todayLogs = todayLogsRes.data || [];
        const flaggedRows = flaggedRowsRes.data || [];
        const [
            { count: totalComplaints },
            { count: unreadComplaints },
            { count: vehicleCount }
        ] = complaintsCountsRes;

        let mainCampusPresence = 0;
        let rnpCampusPresence = 0;
        let paseoCampusPresence = 0;
        let main2W = 0, main4W = 0;
        let rnp2W = 0, rnp4W = 0;
        let paseo2W = 0, paseo4W = 0;

        const countedMain = new Set<string | number>();
        const countedRnp = new Set<string | number>();
        const countedPaseo = new Set<string | number>();

        activeInsideLogs.forEach((log: any) => {
            if (log.check_out) return;
            const st = (log.logged_status || '').toLowerCase();
            if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited' || st === 'exited_campus') return;

            const isGuestOrVip = !log.registration_id || log.registration_id === 1 || Boolean(log.guest_id) || Boolean(log.vip_access) || st === 'guest' || st === 'vip';
            const vehicleKey = isGuestOrVip ? `log_${log.vehicle_log_id}` : `reg_${log.registration_id}`;

            const rawVInfo = Array.isArray(log.vehicle_information) ? log.vehicle_information[0] : log.vehicle_information;
            const regVInfo = Array.isArray(log.registration?.vehicle_information) ? log.registration?.vehicle_information[0] : log.registration?.vehicle_information;
            const vType = (
                rawVInfo?.type || 
                regVInfo?.type || 
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

        const hourlyChart = Array(24).fill(0);
        const roleBreakdownByCampus: Record<string, Record<string, number>> = {
            'Main Campus': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0 },
            'RNP': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0 },
            'PASEO': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0 }
        };

        todayLogs.forEach((log: any) => {
            const timeStr = log.check_in || log.created_at;
            if (timeStr) {
                const hour = new Date(timeStr).getHours();
                if (hour >= 0 && hour < 24) {
                    hourlyChart[hour]++;
                }
            }

            const rawRole = (log.registration?.role || log.role || (log.vip_access ? 'vip' : '')).toLowerCase();
            let role = 'student';
            if (rawRole.includes('faculty')) role = 'faculty';
            else if (rawRole.includes('admin')) role = 'administrator';
            else if (rawRole.includes('staff') || rawRole.includes('employee')) role = 'staff';
            else if (rawRole.includes('concessionaire') || rawRole.includes('concecioonaire') || rawRole.includes('concession')) role = 'concessionaire';
            else if (rawRole.includes('supplier')) role = 'supplier';
            else if (rawRole.includes('vps')) role = 'vps';
            else if (rawRole.includes('vip') || log.vip_access) role = 'vip';
            else if (rawRole.includes('student')) role = 'student';
            else role = 'student';

            const logCampus = (log.campus || log.campus_gate || 'Main Campus');
            let mappedCampus = 'Main Campus';
            if (logCampus.toLowerCase().includes('rnp')) mappedCampus = 'RNP';
            else if (logCampus.toLowerCase().includes('paseo')) mappedCampus = 'PASEO';
            
            if (roleBreakdownByCampus[mappedCampus]) {
                if (roleBreakdownByCampus[mappedCampus][role] !== undefined) {
                    roleBreakdownByCampus[mappedCampus][role]++;
                } else {
                    roleBreakdownByCampus[mappedCampus].student++;
                }
            }
        });

        const flaggedAlerts = flaggedRows
            .filter((r: any) => {
                const st = (r.logged_status || '').toLowerCase();
                const reason = (r.reason || '').toLowerCase();
                if (reason === 'vip access' && !st.includes('denied') && !st.includes('flag')) return false;
                if ((st === 'inside_campus' || st === 'inside' || st === 'exited_campus' || st === 'exited' || st === 'ok') && !reason) return false;
                return reason.length > 0 || st.includes('denied') || st.includes('flag') || st.includes('warn');
            })
            .map((r: any) => ({
                id: r.vehicle_log_id,
                time: r.check_in || r.created_at || new Date().toISOString(),
                reason: r.reason || (r.logged_status === 'Denied' ? 'QR Code Not Recognized / Denied' : r.logged_status) || 'Flagged Alert',
                plate: r.vehicle_information?.plate_number || 'No Plate',
                name: `${r.registration?.first_name || ''} ${r.registration?.last_name || ''}`.trim() || 'Guest / Unregistered',
                role: r.registration?.role ? (r.registration.role.charAt(0).toUpperCase() + r.registration.role.slice(1)) : 'Visitor',
                campus: (() => {
                    const raw = (r.campus || r.campus_gate || 'Main Campus').trim();
                    const low = raw.toLowerCase();
                    if (low === 'rnp' || low.includes('rnp')) return 'RNP Campus';
                    if (low === 'paseo' || low.includes('paseo')) return 'Paseo Campus';
                    if (low === 'main' || low.includes('main')) return 'Main Campus';
                    return raw.charAt(0).toUpperCase() + raw.slice(1);
                })(),
                status: r.logged_status || 'Flagged'
            }));

        let mainEvent = null;
        let rnpEvent = null;
        let paseoEvent = null;
        
        let mainCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let rnpCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let paseoCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };

        for (const { name, paData, evData } of (campusResults || [])) {
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

        const returnData = {
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

        cachedDashboard = { data: returnData, timestamp: now };
        return returnData;
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