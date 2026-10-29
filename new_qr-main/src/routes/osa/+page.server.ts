import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { getActiveBlocks } from '$lib/server/blocks';

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
                        department_id,
                        academic_department,
                        administrative_department
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
                .order('created_at', { ascending: false }),
            supabase
                .from('modification_request')
                .select('*')
                .in('status', ['pending', 'approved'])
                .order('request_at', { ascending: false })
        ]);

        // Active gate blocks show up under Rejected, Revoked & Blocked
        const activeBlocks = await getActiveBlocks();

        const changeReqMap = new Map<number, any>();
        (changeReqs || []).forEach((cr: any) => {
            if (!changeReqMap.has(cr.registration_id)) {
                changeReqMap.set(cr.registration_id, cr);
            }
        });

        const activeTab = cookies.get('osa_active_tab') || 'validation';

        const applications = (rows || []).map(app => {
            const changeReq = changeReqMap.get(app.registration_id);
            const isChangeInProgress = !!changeReq && ['approved', 'pending'].includes(changeReq.status) && app.status !== 'approved';
            const changeReqTime = changeReq ? new Date(changeReq.request_at || changeReq.requested_at || 0).getTime() : 0;

            const rawOsaDist = typeof app.osa_dist_at === 'string' ? app.osa_dist_at : app.osa_dist_at?.toISOString();
            const rawSecCheck = typeof app.security_check_at === 'string' ? app.security_check_at : (app.security_check_at?.toISOString() || app.security_checked_at);
            const rawStickerRel = typeof app.sticker_released_at === 'string' ? app.sticker_released_at : app.sticker_released_at?.toISOString();

            const osa_dist_at = isChangeInProgress && rawOsaDist && new Date(rawOsaDist).getTime() < changeReqTime ? null : rawOsaDist;
            const security_check_at = isChangeInProgress && rawSecCheck && new Date(rawSecCheck).getTime() < changeReqTime ? null : rawSecCheck;
            const sticker_released_at = isChangeInProgress && rawStickerRel && new Date(rawStickerRel).getTime() < changeReqTime ? null : rawStickerRel;

            return {
                ...app,
                id: app.registration_id, // Map registration_id to id
                active_block: activeBlocks.get(app.registration_id) ?? null,
                department_name: app.department?.academic_department || app.department?.administrative_department || (app.department as any)?.department_name || (app.department as any)?.department || 'Unknown Department',
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
                osa_dist_at,
                dist_sched: typeof app.schedule === 'string' ? app.schedule : (app.schedule?.toISOString() || (typeof app.dist_sched === 'string' ? app.dist_sched : app.dist_sched?.toISOString())),
                schedule: typeof app.schedule === 'string' ? app.schedule : (app.schedule?.toISOString() || (typeof app.dist_sched === 'string' ? app.dist_sched : app.dist_sched?.toISOString())),
                security_check_at,
                security_checked_at: security_check_at,
                sticker_released_at,
                expires_at: typeof app.expires_at === 'string' ? app.expires_at : app.expires_at?.toISOString(),
                revoked_at: typeof app.revoke_at === 'string' ? app.revoke_at : (app.revoke_at?.toISOString() || (typeof app.revoked_at === 'string' ? app.revoked_at : app.revoked_at?.toISOString())),
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
