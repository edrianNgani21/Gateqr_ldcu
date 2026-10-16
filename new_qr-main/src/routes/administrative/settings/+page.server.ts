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
            user_type, 
            identification, 
            is_active, 
            created_at, 
            security_pin_hash,
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
            user_type: 'Administrative Department Head',
            identification: userRow?.identification || 'Staff',
            department_name: departmentName,
            created_at: userRow?.created_at || null,
            is_active: userRow?.is_active ?? true,
            has_pin: !!userRow?.security_pin_hash
        }
    };
};
