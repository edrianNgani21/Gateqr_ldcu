import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { isApplicationFormOpen } from '$lib/server/applicationForm';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(303, '/login');
    }

    try {
        // First get the user_id from the users table
        const { data: users } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (!users) {
            console.error('Error fetching user');
            return {
                userEmail: locals.user.email,
                scheduledCount: 0,
                application: null
            };
        }

        const userId = users.user_id;

        // Fetch the most recent application for this user with vehicle information
        const { data: applications } = await supabase
            .from('sticker_application')
            .select(`
                *,
                department:department_id(
                    department_id,
                    academic_department,
                    administrative_department
                ),
                vehicle:vehicle_id(
                    "official_receipt_file",
                    certificate_of_registration_file,
                    authorization_letter_file,
                    plate_number,
                    brand,
                    color,
                    vehicle_type
                )
            `).neq('status', 'deleted')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        // Count complaints with a schedule (new alert for the user)
        const { count: scheduledCount } = await supabase
            .from('incident_report')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('scheduled_at', 'is', null)
            .neq('status', 'resolved');

        const application = applications ? {
            ...applications,
            // Map Supabase column names to match frontend expectations
            id: applications.registration_id, // Map registration_id to id
            department_name: applications.department?.academic_department || applications.department?.administrative_department || (applications.department as any)?.department_name || (applications.department as any)?.department || '-',
            user: { email: locals.user.email },
            // Map vehicle information & registration fields to match frontend document expectations
            school_id_file: (applications as any).school_id_file || 
                    (applications.agreement_form_file && typeof applications.agreement_form_file === 'string' && applications.agreement_form_file.startsWith('http') ? applications.agreement_form_file : null) || 
                    (applications.school_id && typeof applications.school_id === 'string' && applications.school_id.startsWith('http') ? applications.school_id : null) || null,
            doc_load: applications.enrollment_form_file || null,
            doc_or: applications.vehicle?.official_receipt_file || applications.vehicle?.or_document || null,
            doc_cr: applications.vehicle?.certificate_of_registration_file || applications.vehicle?.cr_document || null,
            doc_license: applications.drivers_license_file || applications.vehicle?.drivers_license_file || null,
            doc_letter: applications.vehicle?.authorization_letter_file || null,
            invalid_reason: applications.rejected_reason || applications.revoked_reason || null,
            schedule: typeof applications.hardcopy_due_at === 'string' ? applications.hardcopy_due_at : (applications.hardcopy_due_at?.toISOString?.() || (applications as any).dist_sched || null),
            dist_sched: typeof applications.hardcopy_due_at === 'string' ? applications.hardcopy_due_at : (applications.hardcopy_due_at?.toISOString?.() || (applications as any).dist_sched || null),
            security_checked_at: typeof applications.security_checked_at === 'string' ? applications.security_checked_at : (applications.security_checked_at?.toISOString?.() || (applications as any).security_checked_at || null),
            // Map vehicle details
            vehicle_make: applications.vehicle?.brand || 'Unknown',
            vehicle_color: applications.vehicle?.color || '-',
            vehicle_plate: applications.vehicle?.plate_number || '-',
            vehicle_type: applications.vehicle?.vehicle_type || '-'
        } : null;

        // Only expose QR code once application has reached registered vehicle status (completed, approved, registered, or sticker_installed)
        if (application && !['completed', 'approved', 'registered', 'sticker_installed'].includes((application.status || '').toLowerCase())) {
            delete (application as any).qr_image;
            delete (application as any).qr_code;
        }

        // Fetch most recent change vehicle request for this user
        const { data: changeRequest } = await supabase
            .from('profile_update_request')
            .select('*')
            .eq('user_id', userId)
            .order('requested_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const applicationOpen = await isApplicationFormOpen();

        return {
            userEmail: locals.user.email,
            scheduledCount: scheduledCount || 0,
            application,
            changeRequest: changeRequest || null,
            applicationOpen
        };
    } catch (error) {
        console.error('Error loading status:', error);
        return {
            userEmail: locals.user.email,
            scheduledCount: 0,
            application: null,
            changeRequest: null,
            applicationOpen: true
        };
    }
};
