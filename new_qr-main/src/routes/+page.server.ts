import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isApplicationFormOpen } from '$lib/server/applicationForm';

export const load: PageServerLoad = async ({ locals, url }) => {
    if (!locals.user) {
        throw redirect(303, '/login');
    }

    if (locals.user.role === 'osa') {
        throw redirect(303, '/osa');
    } else if (locals.user.role === 'security') {
        throw redirect(303, '/security');
    } else if (locals.user.role === 'dean') {
        throw redirect(303, '/dean');
    } else if (locals.user.role === 'administrative') {
        throw redirect(303, '/administrative');
    }

    // Check if the user already has an active registration to prevent duplicate applications
    const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .ilike('email', locals.user.email)
        .maybeSingle();

    let isRenewal = false;
    let existingApplicationData: any = null;

    if (userRow?.user_id) {
        const { data: existingApp } = await supabase
            .from('registration')
            .select(`
                *,
                department:department_id(
                    department_id,
                    academic_department,
                    administrative_department
                ),
                vehicle_information:vehicle_information_id(*)
            `)
            .eq('user_id', userRow.user_id)
            .not('status', 'in', '("rejected","revoked")')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existingApp) {
            const isExpired = existingApp.status === 'expired' || (existingApp.expires_at && new Date(existingApp.expires_at).getTime() < Date.now());
            const wantsRenewal = url.searchParams.get('renew') === 'true';

            if (wantsRenewal && isExpired) {
                isRenewal = true;
                existingApplicationData = existingApp;
            } else {
                throw redirect(303, '/status');
            }
        }
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
            isRenewal,
            existingApplicationData,
            academicDepartments: sortedAcad,
            administrativeDepartments: sortedAdmin,
            departments: [...sortedAcad, ...sortedAdmin]
        };
    } catch (e) {
        return { userEmail, applicationOpen, isRenewal, existingApplicationData, academicDepartments: [], administrativeDepartments: [], departments: [] };
    }
};
