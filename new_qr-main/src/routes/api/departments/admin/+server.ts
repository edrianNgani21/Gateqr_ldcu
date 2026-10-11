import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { email, department_id } = await request.json();

        if (!email || !department_id) {
            return json({ error: 'Email and Department ID are required' }, { status: 400 });
        }

        // Check if the user exists
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, user_type')
            .eq('email', email)
            .single();

        if (userError || !userData) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        // Update the user to OSA role and link department
        const { error: updateError } = await supabase
            .from('users')
            .update({ user_type: 'osa', department_id })
            .eq('user_id', userData.user_id);

        if (updateError) throw updateError;

        return json({ message: 'Admin access granted successfully' });
    } catch (error) {
        console.error('Failed to set admin access:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};