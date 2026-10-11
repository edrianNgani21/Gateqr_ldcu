import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/auth/login');
    }

    const { data: rows } = await supabase
        .from('registration')
        .select(`
            *,
            user:user_id(
                email
            ),
            department:department_id(
                department_name
            )
        `)
        .order('created_at', { ascending: false });

    const vehicles = (rows || []).map(row => ({
        ...row,
        user_email: row.user?.email,
        department_name: row.department?.department_name || (row.department as any)?.department || '-'
    }));

    return {
        userRole: locals.user.role,
        vehicles
    };
};
