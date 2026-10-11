import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'dean') {
        throw redirect(303, '/login');
    }

    const userEmail = locals.user.email;

    try {
        // Fetch department name for the logged-in dean
        let departmentName = '';
        
        if (locals.user.department_id) {
            const { data: departmentData } = await supabase
                .from('department')
                .select('department_name')
                .eq('department_id', locals.user.department_id)
                .maybeSingle();

            if (departmentData) {
                departmentName = (departmentData as any).department_name || (departmentData as any).department || '';
            }
        }

        // Get the department_id to use for fetching applications
        let departmentIdForQuery = locals.user.department_id;

        const { data: rows } = await supabase
            .from('registration')
            .select(`
                *,
                department:department_id(
                    department_name
                ),
                user:user_id(
                    email
                ),
                vehicle_information:vehicle_information_id(
                    "or",
                    cr,
                    authorization_letter,
                    plate_number,
                    brand,
                    color,
                    type
                )
            `)
            .eq('department_id', departmentIdForQuery)
            .order('created_at', { ascending: false });

        const applications = (rows || []).map(app => ({
            ...app,
            id: app.registration_id, // Map registration_id to id
            department_name: app.department?.department_name || (app.department as any)?.department || 'Unknown Department',
            department_email: '-',
            user_email: app.user?.email,
            // Map vehicle information fields to match frontend expectations
            doc_id: (app as any).doc_id || 
                    (app.agreement_form && typeof app.agreement_form === 'string' && app.agreement_form.startsWith('http') ? app.agreement_form : null) || 
                    (app.school_id && typeof app.school_id === 'string' && app.school_id.startsWith('http') ? app.school_id : null) || null,
            doc_load: app.enrollment_form || null,
            doc_or: app.vehicle_information?.or || (app.vehicle_information as any)?.or_document || null,
            doc_cr: app.vehicle_information?.cr || (app.vehicle_information as any)?.cr_document || null,
            doc_license: app.drivers_license || (app.vehicle_information as any)?.drivers_license || null,
            doc_letter: app.vehicle_information?.authorization_letter || null,
            rejection_reason: app.rejection_reason || (app as any).invalid_reason || null,
            // Map vehicle details
            vehicle_make: app.vehicle_information?.brand || 'Unknown',
            vehicle_color: app.vehicle_information?.color || '-',
            vehicle_plate: app.vehicle_information?.plate_number || '-',
            vehicle_type: app.vehicle_information?.type || '-',
            qr_code: app.qr_code || app.vehicle_information?.qr_code || null,
            qr_unique_code: app.qr_unique_code || app.vehicle_information?.qr_unique_code || null,
            created_at: typeof app.created_at === 'string' ? app.created_at : app.created_at?.toISOString(),
            dept_val_at: typeof app.dept_val_at === 'string' ? app.dept_val_at : app.dept_val_at?.toISOString(),
            osa_val_at: typeof app.osa_val_at === 'string' ? app.osa_val_at : app.osa_val_at?.toISOString(),
            osa_dist_at: typeof app.osa_dist_at === 'string' ? app.osa_dist_at : app.osa_dist_at?.toISOString(),
            dist_sched: typeof app.schedule === 'string' ? app.schedule : (app.schedule?.toISOString() || (typeof app.dist_sched === 'string' ? app.dist_sched : app.dist_sched?.toISOString())),
            schedule: typeof app.schedule === 'string' ? app.schedule : (app.schedule?.toISOString() || (typeof app.dist_sched === 'string' ? app.dist_sched : app.dist_sched?.toISOString())),
            security_check_at: typeof app.security_check_at === 'string' ? app.security_check_at : (app.security_check_at?.toISOString() || app.security_checked_at),
            security_checked_at: typeof app.security_check_at === 'string' ? app.security_check_at : (app.security_check_at?.toISOString() || app.security_checked_at),
            dist_checked: typeof app.dist_checked === 'string' ? app.dist_checked : app.dist_checked?.toISOString(),
            expires_at: typeof app.expires_at === 'string' ? app.expires_at : app.expires_at?.toISOString(),
            revoked_at: typeof app.revoke_at === 'string' ? app.revoke_at : (app.revoke_at?.toISOString() || (typeof app.revoked_at === 'string' ? app.revoked_at : app.revoked_at?.toISOString())),
            rejected_at: typeof app.rejected_at === 'string' ? app.rejected_at : app.rejected_at?.toISOString(),
        }));

        console.log('Dean applications fetched:', applications.length);
        console.log('Department ID used:', departmentIdForQuery);
        console.log('User email:', userEmail);
        console.log('Sample application department:', applications[0]?.department_name);

        return {
            applications,
            userEmail,
            departmentName
        };
    } catch (error) {
        console.error('Error loading dean applications:', error);
        return { applications: [], userEmail, departmentName: '' };
    }
};
