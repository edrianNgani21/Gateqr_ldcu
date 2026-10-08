import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
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
                .in('status', ['distributed', 'completed', 'revoked'])
                .order('created_at', { ascending: false }),
            supabase
                .from('change_vehicle_requests')
                .select('*')
                .in('status', ['pending', 'approved', 'Pending', 'Approved']),
            supabase
                .from('vehicle_log')
                .select('*')
                .gte('check_in', today)
                .lt('check_in', tomorrow),
            supabase
                .from('registration')
                .select('*', { count: 'exact', head: true })
                .in('status', ['distributed', 'completed']),
            supabase
                .from('complaint')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Pending'),
            supabase
                .from('parking_availability')
                .select('parking_capacity, slot_occupied, slot_unoccupied, date_time')
                .order('date_time', { ascending: false })
                .limit(1)
                .maybeSingle()
        ]);

        const changeReqMap = new Map<number, any>();
        (changeReqs || []).forEach((cr: any) => {
            if (!changeReqMap.has(cr.registration_id)) {
                changeReqMap.set(cr.registration_id, cr);
            }
        });

        const vehicles = (rows || []).map(v => ({
            ...v,
            department_name: v.department?.department,
            department_email: v.department?.email,
            user_email: v.user?.email,
            vehicle_information: v.vehicle_information,
            doc_id: v.vehicle_information?.school_id || v.student_id || null,
            doc_load: v.enrollment_form || null,
            doc_or: v.vehicle_information?.or_document || null,
            doc_cr: v.vehicle_information?.cr_document || null,
            doc_license: v.vehicle_information?.drivers_license || null,
            doc_letter: v.vehicle_information?.authorization_letter || null,
            is_change_vehicle: changeReqMap.has(v.registration_id),
            qr_code: v.qr_code || v.vehicle_information?.qr_code || null,
            qr_unique_code: v.qr_unique_code || v.vehicle_information?.qr_unique_code || null
        }));

        const max_capacity = parkingData?.parking_capacity ?? 500;

        const parking_capacity = parkingData?.parking_capacity ?? max_capacity;
        const slot_occupied = parkingData?.slot_occupied || 0;
        const slot_unoccupied = parkingData?.slot_unoccupied || parking_capacity;
        const parking_last_updated = parkingData?.date_time || null;

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
                const hour = new Date(log.check_in).getHours();
                hourlyChart[hour]++;
                
                if (!log.check_out) {
                    stats.registeredIn++;
                }
                
                if (log.logged_status && log.logged_status !== 'OK' && log.logged_status !== 'Inside' && log.logged_status !== 'REGISTERED') {
                    stats.anomaliesToday++;
                }
            });

            stats.currentlyIn = stats.registeredIn;
            stats.visitsToday = statsRows.length;
        }

        // Use max_capacity from parkingData already fetched above
        stats.maxCapacity = max_capacity;

        return {
            userEmail,
            userRole: locals.user.role,
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
            userRole: locals.user.role,
            parkingData: {
                parking_capacity: 0,
                slot_occupied: 0,
                slot_unoccupied: 0,
                last_updated: null
            }
        };
    }
};