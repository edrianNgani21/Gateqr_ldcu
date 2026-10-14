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
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: true });
        
        const academicDepartments: string[] = [];
        const administrativeDepartments: string[] = [];

        (rows || []).forEach(r => {
            const admin = r.administrative_department || r['Administrative Department'];
            const acad = r.academic_department || r['Academic Department'];
            if (admin) {
                administrativeDepartments.push(admin);
            } else if (acad) {
                academicDepartments.push(acad);
            } else if (r.department_name) {
                academicDepartments.push(r.department_name);
            }
        });

        const sortedAcad = Array.from(new Set(academicDepartments)).sort();
        const sortedAdmin = Array.from(new Set(administrativeDepartments)).sort();

        return {
            userEmail,
            applicationOpen,
            academicDepartments: sortedAcad,
            administrativeDepartments: sortedAdmin,
            departments: [...sortedAcad, ...sortedAdmin]
        };
    } catch (e) {
        return { userEmail, applicationOpen, academicDepartments: [], administrativeDepartments: [], departments: [] };
    }
};
