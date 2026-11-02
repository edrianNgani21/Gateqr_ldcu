import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

export const GET: RequestHandler = async ({ request, url }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    const qr = url.searchParams.get('qr');
    if (!qr) {
        return json({ error: 'Missing qr parameter' }, { status: 400 });
    }

    try {
        let reg = null;

        // First try to lookup by unique alphanumeric code (new format)
        const { data: uniqueCodeRows } = await supabase
            .from('sticker_application')
            .select(`
                *,
                user:user_id(email),
                department:department_id(department_id, academic_department, administrative_department),
                vehicle:vehicle_id(
                    plate_number,
                    brand,
                    color,
                    vehicle_type
                )
            `)
            .eq('qr_code', qr)
            .maybeSingle();

        if (uniqueCodeRows) {
            reg = {
                ...uniqueCodeRows,
                user_email: uniqueCodeRows.user?.email,
                department_name: uniqueCodeRows.department?.academic_department || uniqueCodeRows.department?.administrative_department || '-'
            };
        } else {
            // Fallback to old REG-{number} format for backward compatibility
            const regIdMatch = qr.match(/^REG-(\d+)$/i);
            if (regIdMatch) {
                const autoId = parseInt(regIdMatch[1]);
                const { data: rows } = await supabase
                    .from('sticker_application')
                    .select(`
                        *,
                        user:user_id(email),
                        department:department_id(department_id, academic_department, administrative_department),
                        vehicle:vehicle_id(
                            plate_number,
                            brand,
                            color,
                            vehicle_type
                        )
                    `)
                    .eq('registration_id', autoId)
                    .single();

                if (rows) {
                    reg = {
                        ...rows,
                        user_email: rows.user?.email,
                        department_name: rows.department?.academic_department || rows.department?.administrative_department || '-'
                    };
                }
            } else {
                // Direct registration_id lookup
                const { data: rows } = await supabase
                    .from('sticker_application')
                    .select(`
                        *,
                        user:user_id(email),
                        department:department_id(department_id, academic_department, administrative_department),
                        vehicle:vehicle_id(
                            plate_number,
                            brand,
                            color,
                            vehicle_type
                        )
                    `)
                    .eq('registration_id', qr)
                    .single();

                if (rows) {
                    reg = {
                        ...rows,
                        user_email: rows.user?.email,
                        department_name: rows.department?.academic_department || rows.department?.administrative_department || '-'
                    };
                }
            }
        }

        if (!reg) {
            return json({ registered: false }, { status: 404 });
        }

        // In OSA's Recently Deleted: the QR no longer gives access
        if (reg.status === 'deleted') {
            return json({ registered: false, deleted: true, message: 'This account has been recently deleted. Access denied.' }, { status: 403 });
        }

        // Check if there is an approved change vehicle request (which means QR should be deactivated until sticker release)
        const { data: activeChange } = await supabase
            .from('profile_update_request')
            .select('status')
            .eq('registration_id', reg.registration_id)
            .eq('status', 'approved')
            .maybeSingle();

        if (activeChange) {
            return json({ registered: false, error: 'QR Code is deactivated pending new vehicle sticker release.' }, { status: 403 });
        }

        const { data: logRows } = await supabase
            .from('gate_log')
            .select('gate_log_id, entered_at, exited_at')
            .eq('registration_id', reg.registration_id)
            .order('entered_at', { ascending: false })
            .limit(1)
            .single();

        let lastLog = null;
        let presence_status = 'Outside'; // Default to outside

        if (logRows) {
            const log = logRows;
            lastLog = {
                log_id: log.gate_log_id,
                type: log.exited_at ? 'out' : 'in',
                date: new Date(log.entered_at).toISOString().slice(0, 10), // YYYY-MM-DD
                time: new Intl.DateTimeFormat('en-US', {
                    hour: '2-digit', minute: '2-digit', hour12: false
                }).format(new Date(log.entered_at)),
            };

            // Determine if vehicle is currently inside based on last log
            presence_status = log.exited_at ? 'Outside' : 'Inside';
        }

        return json({ registered: true, registration: reg, lastLog, presence_status });
    } catch (error) {
        console.error('[Gate] Lookup error:', error);
        return apiFailure('look up the QR code', error);
    }
};
