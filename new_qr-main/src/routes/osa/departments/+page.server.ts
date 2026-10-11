import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    // RBAC: Only OSA
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    try {
        const { data: rows } = await supabase
            .from('department')
            .select('*')
            .order('created_at', { ascending: false });

        return {
            departments: (rows || []).map(row => ({
                auto_id: row.department_id,
                department_id: row.department_id,
                name: row.department_name,
                department: row.department_name,
                created_at: row.created_at,
                is_active: row.is_active ?? true
            })),
            userEmail: locals.user.email
        };
    } catch (error) {
        console.error('Error loading departments:', error);
        return {
            departments: [],
            userEmail: locals.user.email
        };
    }
};
