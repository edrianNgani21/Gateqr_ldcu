import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

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
            .from('registration')
            .select(`
                *,
                department:department_id(
                    department_name
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
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        // Count complaints with a schedule (new alert for the user)
        const { count: scheduledCount } = await supabase
            .from('complaint')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('schedule', 'is', null)
            .neq('status', 'resolved');

        const application = applications ? {
            ...applications,
            // Map Supabase column names to match frontend expectations
            id: applications.registration_id, // Map registration_id to id
            department_name: applications.department?.department_name || applications.department?.department || '-',
            user: { email: locals.user.email },
            // Map vehicle information & registration fields to match frontend document expectations
            doc_id: (applications as any).doc_id || 
                    (applications.agreement_form && typeof applications.agreement_form === 'string' && applications.agreement_form.startsWith('http') ? applications.agreement_form : null) || 
                    (applications.school_id && typeof applications.school_id === 'string' && applications.school_id.startsWith('http') ? applications.school_id : null) || null,
            doc_load: applications.enrollment_form || null,
            doc_or: applications.vehicle_information?.or || applications.vehicle_information?.or_document || null,
            doc_cr: applications.vehicle_information?.cr || applications.vehicle_information?.cr_document || null,
            doc_license: applications.drivers_license || applications.vehicle_information?.drivers_license || null,
            doc_letter: applications.vehicle_information?.authorization_letter || null,
            invalid_reason: applications.rejection_reason || applications.revoke_reason || null,
            schedule: typeof applications.schedule === 'string' ? applications.schedule : (applications.schedule?.toISOString?.() || (applications as any).dist_sched || null),
            dist_sched: typeof applications.schedule === 'string' ? applications.schedule : (applications.schedule?.toISOString?.() || (applications as any).dist_sched || null),
            security_check_at: typeof applications.security_check_at === 'string' ? applications.security_check_at : (applications.security_check_at?.toISOString?.() || (applications as any).security_checked_at || null),
            security_checked_at: typeof applications.security_check_at === 'string' ? applications.security_check_at : (applications.security_check_at?.toISOString?.() || (applications as any).security_checked_at || null),
            // Map vehicle details
            vehicle_make: applications.vehicle_information?.brand || 'Unknown',
            vehicle_color: applications.vehicle_information?.color || '-',
            vehicle_plate: applications.vehicle_information?.plate_number || '-',
            vehicle_type: applications.vehicle_information?.type || '-'
        } : null;

        // Fetch most recent change vehicle request for this user
        const { data: changeRequest } = await supabase
            .from('change_vehicle_request')
            .select('*')
            .eq('user_id', userId)
            .order('request_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        return {
            userEmail: locals.user.email,
            scheduledCount: scheduledCount || 0,
            application,
            changeRequest: changeRequest || null
        };
    } catch (error) {
        console.error('Error loading status:', error);
        return {
            userEmail: locals.user.email,
            scheduledCount: 0,
            application: null,
            changeRequest: null
        };
    }
};
