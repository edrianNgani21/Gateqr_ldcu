import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, cookies }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    const userEmail = locals.user.email;

    try {
        // Fetch registrations and change vehicle requests concurrently in parallel
        const [
            { data: rows },
            { data: changeReqs }
        ] = await Promise.all([
            supabase
                .from('registration')
                .select(`
                    *,
                    department:department_id(
                        department,
                        email
                    ),
                    user:user_id(
                        email
                    ),
                    vehicle_information:vehicle_information_id(
                        or_document,
                        cr_document,
                        drivers_license,
                        school_id,
                        authorization_letter,
                        plate_number,
                        brand,
                        color,
                        type,
                        qr_code
                    )
                `)
                .order('created_at', { ascending: false }),
            supabase
                .from('change_vehicle_requests')
                .select('*, new_vehicle:new_vehicle_id(brand, plate_number, type)')
                .in('status', ['Pending', 'pending', 'Approved', 'approved', 'in_progress', 'scheduled'])
                .order('requested_at', { ascending: false })
        ]);

        const changeReqMap = new Map<number, any>();
        (changeReqs || []).forEach((cr: any) => {
            if (!changeReqMap.has(cr.registration_id)) {
                changeReqMap.set(cr.registration_id, cr);
            }
        });

        const activeTab = cookies.get('osa_active_tab') || 'validation';

        const applications = (rows || []).map(app => {
            const changeReq = changeReqMap.get(app.registration_id);
            return {
                ...app,
                id: app.registration_id, // Map registration_id to id
                department_name: app.department?.department || 'Unknown Department',
                department_email: app.department?.email || '-',
                user_email: app.user?.email,
                // Map vehicle information fields to match frontend expectations
                doc_id: app.vehicle_information?.school_id || null,
                doc_load: app.enrollment_form || null,
                doc_or: app.vehicle_information?.or_document || null,
                doc_cr: app.vehicle_information?.cr_document || null,
                doc_license: app.vehicle_information?.drivers_license || null,
                doc_letter: app.vehicle_information?.authorization_letter || null,
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
                dist_sched: typeof app.dist_sched === 'string' ? app.dist_sched : app.dist_sched?.toISOString(),
                expires_at: typeof app.expires_at === 'string' ? app.expires_at : app.expires_at?.toISOString(),
                revoked_at: typeof app.revoked_at === 'string' ? app.revoked_at : app.revoked_at?.toISOString(),
                rejected_at: typeof app.rejected_at === 'string' ? app.rejected_at : app.rejected_at?.toISOString(),
                // Change vehicle request tracking
                change_vehicle_request: changeReq ? {
                    request_id: changeReq.request_id,
                    reason: changeReq.reason,
                    status: changeReq.status,
                    requested_at: changeReq.requested_at,
                    new_vehicle_make: changeReq.new_vehicle?.brand || '-',
                    new_vehicle_plate: changeReq.new_vehicle?.plate_number || '-',
                    new_vehicle_type: changeReq.new_vehicle?.type || '-',
                    new_vehicle_id: changeReq.new_vehicle_id
                } : null,
                is_change_vehicle: !!changeReq
            };
        });

        console.log('OSA applications fetched:', applications.length);
        console.log('Application statuses:', applications.map(a => ({ id: a.id, status: a.status, role: a.role, department: a.department_name })));

        return {
            activeTab,
            applications,
            userEmail
        };
    } catch (error) {
        console.error('Error loading osa applications:', error);
        return { applications: [], userEmail };
    }
};
