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
            departments: (rows || []).map(row => {
                const administrative = row.administrative_department || row['Administrative Department'];
                const academic = row.academic_department || row['Academic Department'] || (!administrative ? row.department_name : null);
                const deptType = administrative ? 'administrative' : 'academic';
                const displayName = (deptType === 'administrative' ? administrative : academic) || row.department_name || 'Unnamed Department';

                return {
                    auto_id: row.department_id,
                    department_id: row.department_id,
                    name: displayName,
                    department: displayName,
                    academic_department: academic,
                    administrative_department: administrative,
                    type: deptType,
                    created_at: row.created_at,
                    is_active: row.is_active ?? true
                };
            }),
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
