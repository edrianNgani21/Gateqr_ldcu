import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || (locals.user.role !== 'administrative' && locals.user.role !== 'dean')) {
        throw redirect(303, '/login');
    }

    const { data: userRow } = await supabase
        .from('users')
        .select(`
            user_id, 
            email, 
            account_role, 
            account_type, 
            is_active, 
            created_at, 
            google_auth_id,
            department_id,
            department:department_id(*)
        `)
        .eq('user_id', locals.user.user_id)
        .single();

    let departmentName = '';
    if (userRow?.department) {
        const d = userRow.department as any;
        departmentName = d.administrative_department || d.academic_department || d.department_name || d.department || '';
    }

    return {
        userEmail: locals.user.email,
        userRole: 'administrative',
        adminUser: {
            user_id: userRow?.user_id || locals.user.user_id,
            email: userRow?.email || locals.user.email,
            account_role: 'Administrative Department Head',
            account_type: userRow?.account_type || 'Staff',
            department_name: departmentName,
            created_at: userRow?.created_at || null,
            is_active: userRow?.is_active ?? true,
            google_linked: !!userRow?.google_auth_id
        }
    };
};
