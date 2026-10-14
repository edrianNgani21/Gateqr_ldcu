import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ locals }) => {
    // Both OSA and Security can view settings
    const isOsaOrSecurity = locals.user && (locals.user.role === 'osa' || locals.user.role === 'security');

    if (!isOsaOrSecurity) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { data: row } = await supabase
            .from('parking_capacity')
            .select('parking_capacity, max_capacity')
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const capacity = row?.parking_capacity ?? row?.max_capacity ?? 500;

        return json({ max_capacity: capacity, parking_capacity: capacity });
    } catch (error) {
        console.error('[Settings] GET error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const PUT: RequestHandler = async ({ request, locals }) => {
    const isOsaOrSecurity = locals.user && (locals.user.role === 'osa' || locals.user.role === 'security');

    if (!isOsaOrSecurity) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const newCap = typeof body.parking_capacity === 'number' ? body.parking_capacity : body.max_capacity;

        if (typeof newCap !== 'number') {
            return json({ error: 'parking_capacity must be a number' }, { status: 400 });
        }

        // Try updating latest parking_availability record, or insert one
        const { data: latest } = await supabase
            .from('parking_capacity')
            .select('parking_availability_id')
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (latest?.parking_availability_id) {
            const { error: updateError } = await supabase
                .from('parking_capacity')
                .update({ parking_capacity: newCap, max_capacity: newCap })
                .eq('parking_availability_id', latest.parking_availability_id);
            if (updateError) throw updateError;
        } else {
            const { error: insertError } = await supabase
                .from('parking_capacity')
                .insert({ parking_capacity: newCap, max_capacity: newCap, vehicle_log_id: 1 });
            if (insertError) throw insertError;
        }

        return json({ success: true, max_capacity: newCap, parking_capacity: newCap });
    } catch (error) {
        console.error('[Settings] PUT error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
