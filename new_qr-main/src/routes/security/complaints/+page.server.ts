import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(302, '/login');
    }

    try {
        // Fetch pending complaints count from Supabase
        const { count: unreadComplaints } = await supabase
            .from('incident_report')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        return {
            userEmail: locals.user.email,
            userRole: locals.user.role,
            unreadComplaints: unreadComplaints || 0
        };
    } catch (error) {
        console.error('Error loading security complaints page:', error);
        return {
            userEmail: locals.user.email,
            userRole: locals.user.role,
            unreadComplaints: 0
        };
    }
};