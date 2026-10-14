import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    // RBAC: Only OSA
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    try {
        const { data: deptRows } = await supabase
            .from('department')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: true });

        const academicDepartments: { id: number; name: string }[] = [];
        const administrativeDepartments: { id: number; name: string }[] = [];

        (deptRows || []).forEach(d => {
            const admin = d.administrative_department || d['Administrative Department'];
            const acad = d.academic_department || d['Academic Department'] || (!admin ? d.department_name : null);
            if (admin) {
                administrativeDepartments.push({ id: d.department_id, name: admin });
            } else if (acad) {
                academicDepartments.push({ id: d.department_id, name: acad });
            }
        });

        return {
            userEmail: locals.user.email,
            academicDepartments,
            administrativeDepartments
        };
    } catch (error) {
        console.error('Error loading admin page data:', error);
        return {
            userEmail: locals.user.email,
            academicDepartments: [],
            administrativeDepartments: []
        };
    }
};