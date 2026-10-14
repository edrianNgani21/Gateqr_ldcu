import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabase';

// GET - Get current gate access filter
export async function GET({}: RequestEvent) {
    try {
        const { data, error } = await supabase
            .from('parking_capacity')
            .select('gate_access_filter, gate_access_filter_reason')
            .eq('id', 1)
            .single();

        if (error) {
            // If settings don't exist, return default
            return json({ gate_access_filter: 'all', gate_access_filter_reason: null });
        }

        return json({ 
            gate_access_filter: data?.gate_access_filter || 'all',
            gate_access_filter_reason: data?.gate_access_filter_reason 
        });
    } catch (error) {
        console.error('Get gate filter error:', error);
        return json({ error: 'Failed to get gate filter' }, { status: 500 });
    }
};

// PUT - Update gate access filter
export async function PUT({ request }: RequestEvent) {
    try {
        const { gate_access_filter, gate_access_filter_reason } = await request.json();

        if (!gate_access_filter) {
            return json({ error: 'gate_access_filter is required' }, { status: 400 });
        }

        const validFilters = ['all', 'students', 'employees', 'visitors', 'concessionaires'];
        if (!validFilters.includes(gate_access_filter)) {
            return json({ error: 'Invalid gate_access_filter value' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('parking_capacity')
            .update({ 
                gate_access_filter,
                gate_access_filter_reason: gate_access_filter_reason || null
            })
            .eq('id', 1);

        if (updateError) throw updateError;

        return json({ message: 'Gate access filter updated successfully' });
    } catch (error) {
        console.error('Update gate filter error:', error);
        return json({ error: 'Failed to update gate filter' }, { status: 500 });
    }
};