import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ request, url, locals }) => {
    const isGate = request.headers.get('X-Gate-Key') === env.GATE_API_KEY;
    const isOsa = locals.user && (locals.user.role === 'osa' || locals.user.role === 'security');
    
    if (!isGate && !isOsa) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dateParam  = url.searchParams.get('date') || '';
    const search     = (url.searchParams.get('search') || '').trim().toLowerCase();
    const boundFilter= url.searchParams.get('bound') || 'all';   // all | in | out
    const page       = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit      = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25')));
    const rolesFilter= url.searchParams.get('roles')?.split(',').filter(Boolean) || [];
    const campusFilter= url.searchParams.get('campus');

    try {
        let dateFilter = new Date().toISOString().split('T')[0];
        const dateParams: string[] = [];
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            dateFilter = dateParam;
            dateParams.push(dateParam);
        }

        const tomorrow = new Date(new Date(dateFilter).getTime() + 86400000).toISOString().split('T')[0];

        // ── Registered, Guest, & VIP entries ────────────────────────────────
        let regRows: any[] = [];
        let query = supabase
            .from('vehicle_log')
            .select(`
                vehicle_log_id,
                vehicle_information:vehicle_information_id(plate_number),
                registration:registration_id(first_name, last_name, role),
                guest:guest_id(guest_id, plate_number, id_number, purpose, timestamp),
                guest_id,
                check_in,
                check_out,
                logged_status,
                vip_access,
                reason,
                campus,
                created_at
            `)
            .gte('check_in', dateFilter)
            .lt('check_in', tomorrow);

        let { data, error } = await query;
        if ((!data || data.length === 0) && !error) {
            const { data: createdData } = await supabase
                .from('vehicle_log')
                .select(`
                    vehicle_log_id,
                    vehicle_information:vehicle_information_id(plate_number),
                    registration:registration_id(first_name, last_name, role),
                    guest:guest_id(guest_id, plate_number, id_number, purpose, timestamp),
                    guest_id,
                    check_in,
                    check_out,
                    logged_status,
                    vip_access,
                    reason,
                    campus,
                    created_at
                `)
                .gte('created_at', dateFilter)
                .lt('created_at', tomorrow);
            if (createdData) data = createdData;
        }

        if (data) {
            regRows = data;
        }

        // ── Process logs ─────────────────────────────────────────────────────
        const logs: any[] = [];
        const normalizedRolesFilter = rolesFilter.map(r => r.toLowerCase().trim());

        regRows.forEach(row => {
            const inDate = new Date(row.check_in || row.created_at || Date.now());
            const hasCheckout = row.check_out !== null && String(row.check_out).trim() !== '' && String(row.check_out).trim() !== 'null';
            const isInside = !hasCheckout && String(row.logged_status || '').toLowerCase() !== 'exited' && String(row.logged_status || '').toLowerCase() !== 'out' && String(row.logged_status || '').toLowerCase() !== 'exited_campus';
            const statusDisplay = isInside ? 'INSIDE CAMPUS' : 'EXITED';

            const st = String(row.logged_status || '').toLowerCase();
            const guestRecord = Array.isArray(row.guest) ? row.guest[0] : row.guest;
            const isVip = Boolean(row.vip_access) || Boolean(row.is_vip) || st === 'vip' || st.includes('vip');
            const isGuest = Boolean(guestRecord) || st === 'guest' || st.includes('guest');

            let role = row.registration?.role ? (row.registration.role.charAt(0).toUpperCase() + row.registration.role.slice(1)) : 'Driver';
            let driverName = `${row.registration?.first_name || ''} ${row.registration?.last_name || ''}`.trim() || 'Driver';
            let plate = row.vehicle_information?.plate_number || 'No Plate';

            if (isVip) {
                role = 'VIP';
                driverName = 'VIP Access';
                plate = 'VIP';
            } else if (isGuest) {
                role = 'Guest';
                if (guestRecord) {
                    driverName = guestRecord.purpose ? `Guest (${guestRecord.purpose})` : (guestRecord.id_number ? `Guest (ID: ${guestRecord.id_number})` : 'Guest');
                    plate = guestRecord.plate_number || 'Guest Vehicle';
                } else {
                    driverName = 'Guest';
                    plate = 'Guest Vehicle';
                }
            }

            // Role filter check
            if (normalizedRolesFilter.length > 0 && !normalizedRolesFilter.includes(role.toLowerCase())) {
                return;
            }

            // Campus filter check: only show logs for the specific campus
            if (campusFilter && campusFilter.trim() !== '') {
                const cf = campusFilter.toLowerCase().trim();
                const targetCampus = cf.includes('main') ? 'main' : (cf.includes('rnp') ? 'rnp' : (cf.includes('paseo') ? 'paseo' : cf));
                const rowCampus = (row.campus || row.registration?.campus || '').toLowerCase().trim();
                const matchesCampus = targetCampus === 'main'
                    ? (rowCampus.includes('main') || rowCampus === '')
                    : rowCampus.includes(targetCampus);

                if (!matchesCampus) {
                    return;
                }
            }

            // Apply bound filter: 'in' = Entry only (inside campus), 'out' = Exit only (exited)
            if (boundFilter === 'all' || 
                (boundFilter === 'in' && isInside) || 
                (boundFilter === 'out' && !isInside)) {
                const displayCampus = row.campus || row.registration?.campus || 'Main Campus';
                logs.push({
                    vehicle_log_id: row.vehicle_log_id,
                    plate: plate,
                    driver_name: driverName,
                    role: role,
                    is_vip: isVip,
                    is_guest: isGuest,
                    guest_details: guestRecord ? {
                        guest_id: guestRecord.guest_id,
                        plate_number: guestRecord.plate_number,
                        id_number: guestRecord.id_number,
                        purpose: guestRecord.purpose,
                        timestamp: guestRecord.timestamp
                    } : (isGuest ? {
                        guest_id: row.guest_id || null,
                        plate_number: plate,
                        id_number: 'N/A',
                        purpose: row.reason || 'Visitor',
                        timestamp: row.check_in || row.created_at
                    } : null),
                    campus: displayCampus || 'Main Campus',
                    bound: isInside ? 'in' : 'out',
                    check_in: row.check_in,
                    check_out: row.check_out,
                    logged_status: statusDisplay,
                    created_at: row.created_at,
                    timestamp: inDate.getTime()
                });
            }
        });



        // ── Sort descending ──────────────────────────────────────────────────
        logs.sort((a, b) => b.timestamp - a.timestamp);

        // ── Search filter (after merge & sort) ──────────────────────────────
        let filtered = logs;
        if (search) {
            const terms = search.split(/\s+/).filter(Boolean);
            filtered = logs.filter(l => {
                const searchableFields = [
                    String(l.vehicle_log_id),
                    String(l.plate),
                    String(l.driver_name),
                    String(l.role),
                    String(l.logged_status),
                    String(l.campus)
                ].join(' ').toLowerCase();
                return terms.every(term => searchableFields.includes(term));
            });
        }

        // ── Paginate ─────────────────────────────────────────────────────────
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const sliced = filtered.slice((safePage - 1) * limit, safePage * limit);

        return json({ logs: sliced, total, page: safePage, totalPages, limit });
    } catch (error) {
        console.error('[Gate] Logs error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
