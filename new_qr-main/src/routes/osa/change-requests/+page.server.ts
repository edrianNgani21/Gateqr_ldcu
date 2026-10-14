import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    try {
        const { data: rows, error } = await supabase
            .from('modification_request')
            .select(`
                *,
                user:user_id(
                    user_id,
                    email
                ),
                registration:registration_id(
                    registration_id,
                    first_name,
                    last_name,
                    mobile,
                    role,
                    status,
                    schedule,
                    department:department_id(
                        department_name
                    ),
                    vehicle_information:vehicle_information_id(
                        vehicle_information_id,
                        brand,
                        color,
                        plate_number,
                        type,
                        "or",
                        cr,
                        authorization_letter
                    )
                )
            `)
            .order('request_at', { ascending: false });

        if (error) {
            console.error('Error fetching change vehicle requests:', error);
        }

        const requests = (rows || []).map((req: any) => {
            const reg = req.registration || {};
            const orig = reg.vehicle_information || {};
            const proposed = req.proposed_changes || {};

            return {
                request_id: req.change_vehicle_request_id,
                change_vehicle_request_id: req.change_vehicle_request_id,
                user_id: req.user_id,
                registration_id: req.registration_id,
                reason: req.reason || 'No reason provided',
                status: req.status || 'pending',
                requested_at: req.request_at,
                processed_at: req.process_at,
                applicant: {
                    name: `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Unknown Applicant',
                    email: req.user?.email || '-',
                    mobile: reg.mobile || '-',
                    role: reg.role || 'student',
                    campus: 'Main Campus',
                    department: reg.department?.department_name || '-',
                    department_email: '-',
                    year_level: null,
                    registration_status: reg.status || '-',
                    dist_sched: reg.schedule || null
                },
                current_vehicle: {
                    brand: orig.brand || 'Unknown',
                    color: orig.color || '-',
                    plate_number: orig.plate_number || '-',
                    type: orig.type || '-'
                },
                new_vehicle: {
                    brand: proposed.vehicle_make || proposed.brand || 'Unknown',
                    color: proposed.vehicle_color || proposed.color || 'Not Specified',
                    plate_number: proposed.vehicle_plate || proposed.plate_number || 'Not Specified',
                    type: proposed.vehicle_type || proposed.type || '-',
                    is_owner: true,
                    doc_or: proposed.doc_or || proposed.or || null,
                    doc_cr: proposed.doc_cr || proposed.cr || null,
                    doc_license: proposed.doc_license || null,
                    doc_letter: proposed.doc_letter || proposed.authorization_letter || null
                }
            };
        });

        return {
            requests,
            userEmail: locals.user.email
        };
    } catch (err) {
        console.error('Error loading change requests:', err);
        return {
            requests: [],
            userEmail: locals.user.email
        };
    }
};
