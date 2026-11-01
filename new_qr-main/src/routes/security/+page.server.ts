import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { getActiveBlocks } from '$lib/server/blocks';

export const load: PageServerLoad = async ({ locals, url }) => {
    if (!locals.user) {
        throw redirect(303, '/login');
    }

    // Only users with role === 'security' can access security dashboard
    if (locals.user.role !== 'security') {
        if (locals.user.role === 'osa') {
            throw redirect(303, '/osa/dashboard');
        } else if (locals.user.role === 'dean') {
            throw redirect(303, '/dean');
        } else {
            throw redirect(303, '/login');
        }
    }

    const userEmail = locals.user.email;
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    try {
        // Run all queries concurrently in parallel for ultra-fast response
        const [
            { data: rows },
            { data: changeReqs },
            { data: statsRows },
            { count: vehicleCount },
            { count: unreadComplaints },
            { data: parkingData }
        ] = await Promise.all([
            supabase
                .from('sticker_application')
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
                .in('status', ['approved', 'distributed', 'completed', 'security_checked', 'revoked', 'osa_validated', 'rejected'])
                .order('created_at', { ascending: false }),
            supabase
                .from('profile_update_request')
                .select('*')
                .in('status', ['pending', 'approved']),
            supabase
                .from('gate_log')
                .select('*')
                .gte('entered_at', today)
                .lt('entered_at', tomorrow),
            supabase
                .from('sticker_application')
                .select('*', { count: 'exact', head: true }).neq('status', 'deleted')
                .in('status', ['approved', 'distributed', 'completed', 'security_checked']),
            supabase
                .from('incident_report')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending'),
            supabase
                .from('parking_capacity')
                .select('capacity, occupied, available, recorded_at')
                .order('recorded_at', { ascending: false })
                .limit(1)
                .maybeSingle()
        ]);

        // Active gate blocks show up under Rejected, Revoked & Blocked
        const activeBlocks = await getActiveBlocks();

        const changeReqMap = new Map<number, any>();
        (changeReqs || []).forEach((cr: any) => {
            if (!changeReqMap.has(cr.registration_id)) {
                changeReqMap.set(cr.registration_id, cr);
            }
        });

        const vehicles = (rows || []).map(v => {
            const changeReq = changeReqMap.get(v.registration_id);
            const isChangeInProgress = !!changeReq && ['approved', 'pending'].includes(changeReq.status) && v.status !== 'approved';
            const changeReqTime = changeReq ? new Date(changeReq.requested_at || changeReq.requested_at || 0).getTime() : 0;

            const rawOsaDist = typeof v.hardcopy_received_at === 'string' ? v.hardcopy_received_at : v.hardcopy_received_at?.toISOString?.();
            const rawSecCheck = typeof v.security_checked_at === 'string' ? v.security_checked_at : (v.security_checked_at?.toISOString?.() || v.security_checked_at);
            const rawStickerRel = typeof v.sticker_released_at === 'string' ? v.sticker_released_at : v.sticker_released_at?.toISOString?.();

            const hardcopy_received_at = isChangeInProgress && rawOsaDist && new Date(rawOsaDist).getTime() < changeReqTime ? null : rawOsaDist;
            const security_checked_at = isChangeInProgress && rawSecCheck && new Date(rawSecCheck).getTime() < changeReqTime ? null : rawSecCheck;
            const sticker_released_at = isChangeInProgress && rawStickerRel && new Date(rawStickerRel).getTime() < changeReqTime ? null : rawStickerRel;

            return {
                ...v,
                active_block: activeBlocks.get(v.registration_id) ?? null,
                hardcopy_received_at,
                security_checked_at,
                sticker_released_at,
                department_name: v.department?.academic_department || v.department?.administrative_department || (v.department as any)?.department_name || (v.department as any)?.department || 'Unknown Department',
                department_email: '-',
                user_email: v.user?.email,
                vehicle: v.vehicle,
                vehicle_make: v.vehicle?.brand || '',
                vehicle_color: v.vehicle?.color || '',
                vehicle_plate: v.vehicle?.plate_number || '',
                vehicle_type: v.vehicle?.vehicle_type || '',
                school_id_file: (v as any).school_id_file || 
                        (v.agreement_form_file && typeof v.agreement_form_file === 'string' && v.agreement_form_file.startsWith('http') ? v.agreement_form_file : null) || 
                        (v.school_id && typeof v.school_id === 'string' && v.school_id.startsWith('http') ? v.school_id : null) || null,
                doc_load: v.enrollment_form_file || null,
                doc_or: v.vehicle?.official_receipt_file || (v.vehicle as any)?.or_document || null,
                doc_cr: v.vehicle?.certificate_of_registration_file || (v.vehicle as any)?.cr_document || null,
                doc_license: v.drivers_license_file || (v.vehicle as any)?.drivers_license_file || null,
                doc_letter: v.vehicle?.authorization_letter_file || null,
                is_change_vehicle: changeReqMap.has(v.registration_id),
                qr_image: v.qr_image || v.vehicle?.qr_image || null,
                qr_code: v.qr_code || v.vehicle?.qr_code || null
            };
        });

        const max_capacity = parkingData?.capacity ?? 500;

        const parking_capacity = parkingData?.capacity ?? max_capacity;
        const slot_occupied = parkingData?.occupied || 0;
        const slot_unoccupied = parkingData?.available || parking_capacity;
        const parking_last_updated = parkingData?.recorded_at || null;

        // Calculate stats
        const stats = {
            currentlyIn: 0,
            visitsToday: 0,
            registeredIn: 0,
            guestsIn: 0,
            vipsIn: 0,
            anomaliesToday: 0,
            maxCapacity: max_capacity,
            total2Wheelers: 0,
            total4Wheelers: 0,
            slot_occupied,
            slot_unoccupied,
            parking_last_updated
        };

        const roleBreakdown: Record<string, number> = {
            student: 0,
            employee: 0,
            visitor: 0,
            concessionaire: 0,
            guest: 0,
            vip: 0
        };

        const hourlyChart = Array(24).fill(0);

        if (statsRows) {
            statsRows.forEach((log: any) => {
                const hour = new Date(log.entered_at).getHours();
                hourlyChart[hour]++;
                
                if (!log.exited_at) {
                    stats.registeredIn++;
                }
                
                if (log.presence_status && log.presence_status !== 'OK' && log.presence_status !== 'Inside' && log.presence_status !== 'REGISTERED') {
                    stats.anomaliesToday++;
                }
            });

            stats.currentlyIn = stats.registeredIn;
            stats.visitsToday = statsRows.length;
        }

        // Use max_capacity from parkingData already fetched above
        stats.maxCapacity = max_capacity;

        const tabParam = url.searchParams.get('tab');
        let initialTab = 'Document Review';
        if (tabParam) {
            const low = tabParam.toLowerCase();
            if (low.includes('doc') || low.includes('review')) initialTab = 'Document Review';
            else if (low.includes('reg') && !low.includes('revok') && !low.includes('reject')) initialTab = 'Registered Vehicles';
            else if (low.includes('reject') || low.includes('revok')) initialTab = 'Rejected or Revoked Accounts & Applications';
            else initialTab = tabParam;
        }

        return {
            userEmail,
            userRole: locals.user.role,
            initialTab,
            vehicles,
            stats,
            roleBreakdown: roleBreakdown as any,
            hourlyChart,
            vehicleCount: vehicleCount || 0,
            unreadComplaints: unreadComplaints || 0,
            parkingData: {
                parking_capacity,
                slot_occupied,
                slot_unoccupied,
                last_updated: parking_last_updated
            }
        };
    } catch (e) {
        console.error('Error loading security page data:', e);
        return {
            userEmail,
            userRole: locals.user.role,
            initialTab: 'Document Review',
            vehicles: [],
            stats: {
                currentlyIn: 0,
                visitsToday: 0,
                registeredIn: 0,
                guestsIn: 0,
                vipsIn: 0,
                anomaliesToday: 0,
                maxCapacity: -1,
                total2Wheelers: 0,
                total4Wheelers: 0,
                slot_occupied: 0,
                slot_unoccupied: 0,
                parking_last_updated: null
            },
            roleBreakdown: {
                student: 0,
                employee: 0,
                visitor: 0,
                concessionaire: 0,
                guest: 0,
                vip: 0
            } as any,
            hourlyChart: Array(24).fill(0),
            vehicleCount: 0,
            unreadComplaints: 0,
            parkingData: {
                parking_capacity: 0,
                slot_occupied: 0,
                slot_unoccupied: 0,
                last_updated: null
            }
        };
    }
};