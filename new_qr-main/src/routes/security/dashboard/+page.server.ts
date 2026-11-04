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
            campusResults,
            violationRowsRes
        ] = await Promise.all([
            // 1. All currently active inside vehicles (where exited_at is null)
            supabase
                .from('gate_log')
                .select(`
                    gate_log_id,
                    entered_at,
                    exited_at,
                    presence_status,
                    is_vip,
                    guest_id,
                    campus_gate,
                    registration_id,
                    vehicle:vehicle_id(
                        vehicle_type
                    ),
                    registration:registration_id(
                        role,
                        vehicle:vehicle_id(
                            vehicle_type
                        )
                    )
                `)
                .is('exited_at', null),

            // 2. Today's vehicle entries for hourly traffic chart and role breakdown
            supabase
                .from('gate_log')
                .select(`
                    gate_log_id,
                    entered_at,
                    exited_at,
                    created_at,
                    presence_status,
                    note,
                    guest_id,
                    is_vip,
                    campus_gate,
                    vehicle:vehicle_id(
                        brand,
                        plate_number,
                        vehicle_type,
                        color
                    ),
                    registration:registration_id(
                        first_name,
                        last_name,
                        role
                    )
                `)
                .or(`entered_at.gte.${today},created_at.gte.${today}`)
                // Refused gate attempts are alerts, not visits
                .neq('presence_status', 'denied')
                .order('entered_at', { ascending: false })
                .limit(200),

            // 3. Flagged alerts / anomalies
            supabase
                .from('gate_log')
                .select(`
                    gate_log_id,
                    entered_at,
                    created_at,
                    presence_status,
                    flagged_alert,
                    note,
                    owner_name_snapshot,
                    plate_snapshot,
                    campus_gate,
                    vehicle:vehicle_id(
                        brand,
                        plate_number,
                        vehicle_type
                    ),
                    registration:registration_id(
                        first_name,
                        last_name,
                        role
                    )
                `)
                // main.py sets flagged_alert on every gate alert; 'denied' covers rows saved before that column existed
                .or('flagged_alert.not.is.null,presence_status.eq.denied')
                .order('entered_at', { ascending: false })
                .limit(20),

            // 4. Incident report & registration counts
            Promise.all([
                supabase.from('incident_report').select('*', { count: 'exact', head: true }),
                supabase.from('incident_report').select('*', { count: 'exact', head: true }).or('status.eq.pending,status.eq.Pending'),
                supabase.from('sticker_application').select('*', { count: 'exact', head: true }).in('status', ['approved', 'distributed', 'completed', 'security_checked'])
            ]),

            // 5. Parking capacity & active events for all 3 campuses
            Promise.all(campusesList.map(async (name) => {
                const gate = name === 'RNP' ? 'rnp' : (name === 'PASEO' ? 'paseo' : 'main');
                const nowIso = new Date().toISOString();
                const [paRes, evRes] = await Promise.all([
                    supabase
                        .from('parking_capacity')
                        .select('*')
                        .eq('campus_gate', gate)
                        .maybeSingle(),
                    supabase
                        .from('campus_event')
                        .select('*')
                        .eq('campus_gate', gate)
                        .eq('is_active', true)
                        .gt('ends_at', nowIso)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle()
                ]);
                return { name, paData: paRes.data, evData: evRes.data };
            })),

            // 6. Violations recorded by OSA / Security (warnings and gate blocks)
            supabase
                .from('blocklist')
                .select(`
                    blocklist_id,
                    violation_level,
                    reason,
                    blocked_by,
                    blocked_at,
                    blocked_until,
                    vehicle:vehicle_id(
                        plate_number
                    ),
                    registration:registration_id(
                        first_name,
                        last_name,
                        role
                    )
                `)
                .order('blocked_at', { ascending: false })
                .limit(20)
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

        const roleBreakdownByCampus: Record<string, Record<string, number>> = {
            'Main Campus': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0, guest: 0 },
            'RNP': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0, guest: 0 },
            'PASEO': { student: 0, faculty: 0, staff: 0, administrator: 0, concessionaire: 0, supplier: 0, vps: 0, vip: 0, guest: 0 }
        };

        activeInsideLogs.forEach((log: any) => {
            if (log.exited_at) return;
            const st = (log.presence_status || '').toLowerCase();
            if (st === 'denied' || st === 'exit' || st === 'out' || st === 'exited' || st === 'exited_campus') return;

            const isGuestOrVip = !log.registration_id || log.registration_id === 1 || Boolean(log.guest_id) || Boolean(log.is_vip) || st === 'guest' || st === 'vip';
            const vehicleKey = isGuestOrVip ? `log_${log.gate_log_id}` : `reg_${log.registration_id}`;

            const rawVInfo = Array.isArray(log.vehicle) ? log.vehicle[0] : log.vehicle;
            const regVInfo = Array.isArray(log.registration?.vehicle) ? log.registration?.vehicle[0] : log.registration?.vehicle;
            const vType = (
                rawVInfo?.type || 
                regVInfo?.type || 
                ''
            ).toLowerCase();
            const is2W = vType.includes('2') || vType.includes('motorcycle') || vType.includes('bike') || vType.includes('scooter');

            const rawRole = (log.registration?.role || log.role || (log.is_vip ? 'vip' : '')).toLowerCase();
            let role = 'student';
            if (log.guest_id && !log.registration) role = 'guest';
            else if (rawRole.includes('faculty')) role = 'faculty';
            else if (rawRole.includes('admin')) role = 'administrator';
            else if (rawRole.includes('staff') || rawRole.includes('employee')) role = 'staff';
            else if (rawRole.includes('concessionaire') || rawRole.includes('concecioonaire') || rawRole.includes('concession')) role = 'concessionaire';
            else if (rawRole.includes('supplier')) role = 'supplier';
            else if (rawRole.includes('vps')) role = 'vps';
            else if (rawRole.includes('vip') || log.is_vip) role = 'vip';
            else if (rawRole.includes('student')) role = 'student';
            else if (log.guest_id || st.includes('guest')) role = 'guest';
            else role = 'student';

            const c = (log.campus_gate || '').toLowerCase();
            if (c.includes('rnp')) {
                if (!countedRnp.has(vehicleKey)) {
                    countedRnp.add(vehicleKey);
                    rnpCampusPresence++;
                    if (is2W) rnp2W++; else rnp4W++;
                    if (roleBreakdownByCampus['RNP'][role] !== undefined) {
                        roleBreakdownByCampus['RNP'][role]++;
                    }
                }
            } else if (c.includes('paseo')) {
                if (!countedPaseo.has(vehicleKey)) {
                    countedPaseo.add(vehicleKey);
                    paseoCampusPresence++;
                    if (is2W) paseo2W++; else paseo4W++;
                    if (roleBreakdownByCampus['PASEO'][role] !== undefined) {
                        roleBreakdownByCampus['PASEO'][role]++;
                    }
                }
            } else {
                if (!countedMain.has(vehicleKey)) {
                    countedMain.add(vehicleKey);
                    mainCampusPresence++;
                    if (is2W) main2W++; else main4W++;
                    if (roleBreakdownByCampus['Main Campus'][role] !== undefined) {
                        roleBreakdownByCampus['Main Campus'][role]++;
                    }
                }
            }
        });

        const hourlyChart = Array(24).fill(0);
        todayLogs.forEach((log: any) => {
            const timeStr = log.entered_at || log.created_at;
            if (timeStr) {
                const hour = new Date(timeStr).getHours();
                if (hour >= 0 && hour < 24) {
                    hourlyChart[hour]++;
                }
            }
        });

        const violationLevelLabels: Record<string, string> = {
            first_warning: '1st Warning',
            second_warning: '2nd Warning',
            gate_block: 'Gate Block'
        };
        const violationAlerts = (violationRowsRes.data || []).map((v: any) => {
            const blockedUntil = v.blocked_until ? new Date(v.blocked_until) : null;
            const by = v.blocked_by === 'osa_admin' ? 'OSA' : 'Security';
            return {
                id: `violation-${v.blocklist_id}`,
                time: v.blocked_at,
                alert: 'Violation',
                reason: `Violation (${by}): ${v.reason}${blockedUntil ? ` - blocked until ${blockedUntil.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}` : ''}`,
                plate: v.vehicle?.plate_number || 'No Plate',
                name: `${v.registration?.first_name || ''} ${v.registration?.last_name || ''}`.trim() || 'Unknown',
                role: v.registration?.role ? (v.registration.role.charAt(0).toUpperCase() + v.registration.role.slice(1)) : '-',
                campus: 'All Campuses',
                status: violationLevelLabels[v.violation_level] || 'Violation'
            };
        });

        const alertLabels: Record<string, string> = {
            double_access: 'Double Access',
            deleted: 'Deleted Account',
            wrong_campus_exit: 'Wrong Campus Exit',
            blocked: 'Blocked',
            revoked: 'Revoked QR',
            not_registered: 'Not Registered'
        };
        // main.py saves scanned codes with no matching registration under this owner name
        const alertName = (r: any) =>
            r.owner_name_snapshot === 'Unrecognized QR Code' ? 'Unrecognized or Unregistered QR Code' : alertLabels[r.flagged_alert];
        const gateAlerts = flaggedRows
            .filter((r: any) => r.flagged_alert || r.presence_status === 'denied')
            .map((r: any) => ({
                id: r.gate_log_id,
                time: r.entered_at || r.created_at || new Date().toISOString(),
                // gate_log.flagged_alert, shown as the alert name
                alert: alertName(r) || 'Denied',
                reason: r.note || (r.presence_status === 'denied' ? 'QR Code Not Recognized / Denied' : r.presence_status) || 'Flagged Alert',
                plate: r.vehicle?.plate_number || r.plate_snapshot || 'No Plate',
                name: `${r.registration?.first_name || ''} ${r.registration?.last_name || ''}`.trim() || r.owner_name_snapshot || 'Guest / Unregistered',
                role: r.registration?.role ? (r.registration.role.charAt(0).toUpperCase() + r.registration.role.slice(1)) : 'Visitor',
                campus: (() => {
                    const raw = (r.campus_gate || 'main').trim();
                    const low = raw.toLowerCase();
                    if (low === 'rnp' || low.includes('rnp')) return 'RNP Campus';
                    if (low === 'paseo' || low.includes('paseo')) return 'Paseo Campus';
                    if (low === 'main' || low.includes('main')) return 'Main Campus';
                    return raw.charAt(0).toUpperCase() + raw.slice(1);
                })(),
                status: alertName(r) || (r.presence_status === 'denied' ? 'Denied' : 'Flagged')
            }));

        // Gate events and recorded violations, newest first
        const flaggedAlerts = [...gateAlerts, ...violationAlerts]
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .slice(0, 20);

        let mainEvent = null;
        let rnpEvent = null;
        let paseoEvent = null;
        
        let mainCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let rnpCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };
        let paseoCapacity = { capacity: 0, occupied: 0, available: 0, unoccupied: 0 };

        for (const { name, paData, evData } of (campusResults || [])) {
            const presence = name === 'RNP' ? rnpCampusPresence : (name === 'PASEO' ? paseoCampusPresence : mainCampusPresence);
            const cap = paData?.capacity ?? 200;
            const occ = presence;
            const avail = Math.max(0, cap - occ);

            if (name === 'Main Campus') mainCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };
            if (name === 'RNP') rnpCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };
            if (name === 'PASEO') paseoCapacity = { capacity: cap, occupied: occ, available: avail, unoccupied: avail };

            if (evData?.event_name) {
                const evt = { name: evData.event_name, start: evData.starts_at, end: evData.ends_at };
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