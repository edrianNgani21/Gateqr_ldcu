import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { email, department_id } = await request.json();

        if (!email || !department_id) {
            return json({ error: 'Email and Department ID are required' }, { status: 400 });
        }

        // Check if the user exists
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, account_role')
            .eq('email', email)
            .single();

        if (userError || !userData) {
            return json({ error: 'Your account record could not be found. Please sign out, sign in again, and retry.' }, { status: 404 });
        }

        // Update the user to OSA role and link department
        const { error: updateError } = await supabase
            .from('users')
            .update({ account_role: 'osa', department_id })
            .eq('user_id', userData.user_id);

        if (updateError) throw updateError;

        return json({ message: 'Admin access granted successfully' });
    } catch (error) {
        console.error('Failed to set admin access:', error);
        return apiFailure('add the department administrator', error);
    }
};