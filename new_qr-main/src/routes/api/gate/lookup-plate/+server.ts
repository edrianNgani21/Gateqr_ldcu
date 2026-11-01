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

    const plate = url.searchParams.get('plate');
    const name = url.searchParams.get('name');

    if (!plate && !name) {
        return json({ error: 'Missing plate or name parameter' }, { status: 400 });
    }

    try {
        let data;

        // Search by plate if provided
        if (plate) {
            const { data: plateData, error: plateError } = await supabase
                .from('guestlog')
                .select('*')
                .eq('plate', plate)
                .is('out', null)  // Only find guests currently inside
                .order('in', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!plateError && plateData) {
                data = plateData;
            }
        }

        // Search by name if provided and plate search didn't return results
        if (!data && name) {
            const { data: nameData, error: nameError } = await supabase
                .from('guestlog')
                .select('*')
                .ilike('name', `%${name}%`)  // Case-insensitive partial match
                .is('out', null)  // Only find guests currently inside
                .order('in', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!nameError && nameData) {
                data = nameData;
            }
        }

        if (data) {
            return json({
                found: true,
                visitor: {
                    guest_id: data.guest_id,
                    ticket_no: data.ticket_no,
                    name: data.name,
                    mobile: data.mobile,
                    make_model: data.make_model,
                    plate: data.plate,
                    guest_id_number: data.guest_id_number,
                    purpose: data.purpose,
                    reason: data.reason,
                    in_time: data.in,
                    presence_status: data.presence_status
                }
            });
        } else {
            return json({
                found: false,
                message: 'No active guest found with the provided information'
            });
        }
    } catch (error) {
        console.error('[Gate] Lookup error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};