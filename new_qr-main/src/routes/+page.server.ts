import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isApplicationFormOpen } from '$lib/server/applicationForm';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(303, '/login');
    }

    if (locals.user.role === 'osa') {
        throw redirect(303, '/osa');
    } else if (locals.user.role === 'security') {
        throw redirect(303, '/security');
    } else if (locals.user.role === 'dean') {
        throw redirect(303, '/dean');
    }

    // Pass the user's email to display in the greeting
    const userEmail = locals.user.email;

    const applicationOpen = await isApplicationFormOpen();

    try {
        // Fetch only active departments for the select dropdown from Supabase
        const { data: rows } = await supabase
            .from('department')
            .select('department_name')
            .eq('is_active', true)
            .order('department_name', { ascending: true });
        
        return {
            userEmail,
            applicationOpen,
            departments: (rows || []).map(r => r.department_name)
        };
    } catch (e) {
        return { userEmail, applicationOpen, departments: [] };
    }
};
