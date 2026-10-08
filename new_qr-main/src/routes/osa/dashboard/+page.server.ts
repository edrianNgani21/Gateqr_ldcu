import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';
import { getApplicationFormStatus } from '$lib/server/applicationForm';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const formStatus = await getApplicationFormStatus();

    try {
        // Run all statistics, breakdown, and recent applications queries in parallel
        const [
            totalApplicationsResult,
            pendingValidationResult,
            pendingDistributionResult,
            completedTodayResult,
            rejectedTodayResult,
            totalDepartmentsResult,
            statusBreakdownResult,
            recentApplicationsResult
        ] = await Promise.all([
            supabase.from('registration').select('*', { count: 'exact', head: true }).in('status', ['pending', 'dept_val', 'osa_val']),
            supabase.from('registration').select('*', { count: 'exact', head: true }).eq('status', 'distributed').is('security_checked_at', null),
            supabase.from('registration').select('*', { count: 'exact', head: true }).eq('status', 'distributed').not('security_checked_at', 'is', null).is('sticker_released_at', null),
            supabase.from('registration').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
            supabase.from('registration').select('*', { count: 'exact', head: true }).eq('status', 'rejected').gte('rejected_at', today).lt('rejected_at', tomorrow),
            supabase.from('department').select('*', { count: 'exact', head: true }),
            supabase.from('registration').select('status').order('created_at', { ascending: false }),
            supabase.from('registration').select(`
                *,
                user:user_id(email),
                department:department_id(department)
            `).order('created_at', { ascending: false }).limit(5)
        ]);

        const totalApplications = totalApplicationsResult?.count || 0;
        const pendingValidation = pendingValidationResult?.count || 0;
        const pendingDistribution = pendingDistributionResult?.count || 0;
        const completedToday = completedTodayResult?.count || 0;
        const rejectedToday = rejectedTodayResult?.count || 0;
        const totalDepartments = totalDepartmentsResult?.count || 0;

        const statusBreakdown = statusBreakdownResult?.data;
        const recentApplications = recentApplicationsResult?.data;

        const statusCounts: Record<string, number> = {
            pending: 0,
            dept_val: 0,
            osa_val: 0,
            distributed: 0,
            completed: 0,
            rejected: 0,
            revoked: 0
        };

        statusBreakdown?.forEach((app: any) => {
            if (statusCounts[app.status] !== undefined) {
                statusCounts[app.status]++;
            }
        });

        return {
            stats: {
                totalApplications,
                pendingValidation,
                pendingDistribution,
                completedToday,
                rejectedToday,
                totalDepartments
            },
            statusBreakdown: statusCounts,
            recentApplications: recentApplications || [],
            applicationOpen: formStatus.open,
            formStatus,
            userEmail: locals.user.email
        };
    } catch (e) {
        console.error('Failed to load OSA dashboard data:', e);
        return {
            stats: {
                totalApplications: 0,
                pendingValidation: 0,
                pendingDistribution: 0,
                completedToday: 0,
                rejectedToday: 0,
                totalDepartments: 0
            },
            statusBreakdown: {
                pending: 0,
                dept_val: 0,
                osa_val: 0,
                distributed: 0,
                completed: 0,
                rejected: 0,
                revoked: 0
            },
            recentApplications: [],
            applicationOpen: formStatus.open,
            formStatus,
            userEmail: locals.user.email
        };
    }
};