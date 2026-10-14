import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

export const GET: RequestHandler = async ({ request, url }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    const qr = url.searchParams.get('qr');
    if (!qr) {
        return json({ error: 'Missing qr parameter' }, { status: 400 });
    }

    try {
        let reg = null;

        // First try to lookup by unique alphanumeric code (new format)
        const { data: uniqueCodeRows } = await supabase
            .from('registration')
            .select(`
                *,
                user:user_id(email),
                department:department_id(department, email),
                vehicle_information:vehicle_information_id(
                    plate_number,
                    brand,
                    color,
                    type
                )
            `)
            .eq('qr_unique_code', qr)
            .maybeSingle();

        if (uniqueCodeRows) {
            reg = {
                ...uniqueCodeRows,
                user_email: uniqueCodeRows.user?.email,
                department_name: uniqueCodeRows.department?.department
            };
        } else {
            // Fallback to old REG-{number} format for backward compatibility
            const regIdMatch = qr.match(/^REG-(\d+)$/i);
            if (regIdMatch) {
                const autoId = parseInt(regIdMatch[1]);
                const { data: rows } = await supabase
                    .from('registration')
                    .select(`
                        *,
                        user:user_id(email),
                        department:department_id(department, email),
                        vehicle_information:vehicle_information_id(
                            plate_number,
                            brand,
                            color,
                            type
                        )
                    `)
                    .eq('registration_id', autoId)
                    .single();

                if (rows) {
                    reg = {
                        ...rows,
                        user_email: rows.user?.email,
                        department_name: rows.department?.department
                    };
                }
            } else {
                // Direct registration_id lookup
                const { data: rows } = await supabase
                    .from('registration')
                    .select(`
                        *,
                        user:user_id(email),
                        department:department_id(department, email),
                        vehicle_information:vehicle_information_id(
                            plate_number,
                            brand,
                            color,
                            type
                        )
                    `)
                    .eq('registration_id', qr)
                    .single();

                if (rows) {
                    reg = {
                        ...rows,
                        user_email: rows.user?.email,
                        department_name: rows.department?.department_name || (rows.department as any)?.department
                    };
                }
            }
        }

        if (!reg) {
            return json({ registered: false }, { status: 404 });
        }

        // Check if there is an approved change vehicle request (which means QR should be deactivated until sticker release)
        const { data: activeChange } = await supabase
            .from('modification_request')
            .select('status')
            .eq('registration_id', reg.registration_id)
            .eq('status', 'approved')
            .maybeSingle();

        if (activeChange) {
            return json({ registered: false, error: 'QR Code is deactivated pending new vehicle sticker release.' }, { status: 403 });
        }

        const { data: logRows } = await supabase
            .from('vehicle_log')
            .select('vehicle_log_id, check_in, check_out')
            .eq('registration_id', reg.registration_id)
            .order('check_in', { ascending: false })
            .limit(1)
            .single();

        let lastLog = null;
        let logged_status = 'Outside'; // Default to outside

        if (logRows) {
            const log = logRows;
            lastLog = {
                log_id: log.vehicle_log_id,
                type: log.check_out ? 'out' : 'in',
                date: new Date(log.check_in).toISOString().slice(0, 10), // YYYY-MM-DD
                time: new Intl.DateTimeFormat('en-US', {
                    hour: '2-digit', minute: '2-digit', hour12: false
                }).format(new Date(log.check_in)),
            };

            // Determine if vehicle is currently inside based on last log
            logged_status = log.check_out ? 'Outside' : 'Inside';
        }

        return json({ registered: true, registration: reg, lastLog, logged_status });
    } catch (error) {
        console.error('[Gate] Lookup error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
