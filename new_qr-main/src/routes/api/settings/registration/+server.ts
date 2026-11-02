import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabase } from '$lib/server/supabase';

// GET - Get registration status
export async function GET({}: RequestEvent) {
    try {
        const { data, error } = await supabase
            .from('parking_capacity')
            .select('registration_open')
            .eq('id', 1)
            .single();

        if (error) {
            // If settings don't exist, return default
            return json({ registration_open: true });
        }

        return json({ registration_open: data?.registration_open ?? true });
    } catch (error) {
        console.error('Get registration status error:', error);
        return apiFailure('load the registration status', error);
    }
};

// PUT - Update registration status
export async function PUT({ request }: RequestEvent) {
    try {
        const { registration_open } = await request.json();

        if (typeof registration_open !== 'boolean') {
            return json({ error: 'registration_open must be a boolean' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('parking_capacity')
            .update({ registration_open })
            .eq('id', 1);

        if (updateError) throw updateError;

        return json({ message: 'Registration status updated successfully', registration_open });
    } catch (error) {
        console.error('Update registration status error:', error);
        return apiFailure('update the registration status', error);
    }
};