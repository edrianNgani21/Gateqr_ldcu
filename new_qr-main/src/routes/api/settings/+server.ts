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
            .select('capacity')
            .eq('campus_gate', 'main')
            .maybeSingle();

        const capacity = row?.capacity ?? 500;

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

        // Main Campus limits row (one row per campus)
        const { error: updateError } = await supabase
            .from('parking_capacity')
            .update({ capacity: newCap, updated_at: new Date().toISOString() })
            .eq('campus_gate', 'main');
        if (updateError) throw updateError;

        return json({ success: true, max_capacity: newCap, parking_capacity: newCap });
    } catch (error) {
        console.error('[Settings] PUT error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
