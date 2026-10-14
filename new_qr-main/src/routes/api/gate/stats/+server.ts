import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

// Optionally check auth if this is meant for the gate, 
// but we might want this route to be accessible via session for the web dashboard too.
export const GET: RequestHandler = async ({ request, url, locals }) => {
    // Allow either X-Gate-Key (from RPi) or logged-in OSA user (from Web)
    const isGate = request.headers.get('X-Gate-Key') === env.GATE_API_KEY;
    const isOsa = locals.user && (locals.user.role === 'osa' || locals.user.role === 'security');
    
    if (!isGate && !isOsa) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

        const { count: currentlyIn } = await supabase
            .from('vehicle_log')
            .select('*', { count: 'exact', head: true })
            .is('check_out', null);

        const { count: visitsToday } = await supabase
            .from('vehicle_log')
            .select('*', { count: 'exact', head: true })
            .gte('check_in', today)
            .lt('check_in', tomorrow);

        // Also count guests currently in (have `in` but no `out` yet)
        const { count: guestCurrentlyIn } = await supabase
            .from('guestlog')
            .select('*', { count: 'exact', head: true })
            .is('out', null);

        const { count: guestVisitsToday } = await supabase
            .from('guestlog')
            .select('*', { count: 'exact', head: true })
            .gte('in', today)
            .lt('in', tomorrow);

        // VIP entries today
        const { count: vipInCount } = await supabase
            .from('vip_log')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'in')
            .gte('timestamp', today)
            .lt('timestamp', tomorrow);

        const { count: vipOutCount } = await supabase
            .from('vip_log')
            .select('*', { count: 'exact', head: true })
            .eq('type', 'out')
            .gte('timestamp', today)
            .lt('timestamp', tomorrow);

        const vipCurrentlyIn = Math.max(0, (vipInCount || 0) - (vipOutCount || 0));
        const vipVisitsToday = vipInCount || 0;

        const totalCurrentlyIn = (currentlyIn || 0) + (guestCurrentlyIn || 0) + vipCurrentlyIn;
        const totalVisitsToday = (visitsToday || 0) + (guestVisitsToday || 0) + vipVisitsToday;

        // Anomalies today (registered + guest entries with a logged_status)
        const { count: anomalyRegCount } = await supabase
            .from('vehicle_log')
            .select('*', { count: 'exact', head: true })
            .gte('check_in', today)
            .lt('check_in', tomorrow)
            .not('logged_status', 'is', null)
            .neq('logged_status', '')
            .neq('logged_status', 'OK')
            .neq('logged_status', 'Inside');

        const { count: anomalyGuestCount } = await supabase
            .from('guestlog')
            .select('*', { count: 'exact', head: true })
            .gte('in', today)
            .lt('in', tomorrow)
            .not('logged_status', 'is', null)
            .neq('logged_status', '');

        const anomaliesToday = (anomalyRegCount || 0) + (anomalyGuestCount || 0);

        // Role breakdown for today (registered entries only)
        const { data: roleBreakdownData } = await supabase
            .from('vehicle_log')
            .select(`
                registration:registration_id(
                    role
                )
            `)
            .gte('check_in', today)
            .lt('check_in', tomorrow);

        const roleBreakdown: Record<string, number> = { 
            student: 0, 
            employee: 0, 
            visitor: 0, 
            concessionaire: 0, 
            guest: guestVisitsToday || 0, 
            vip: vipVisitsToday || 0 
        };

        if (roleBreakdownData) {
            roleBreakdownData.forEach((log: any) => {
                const role = log.registration?.role;
                if (role && roleBreakdown.hasOwnProperty(role)) {
                    roleBreakdown[role]++;
                }
            });
        }

        // Hourly breakdown for today (entries only)
        const { data: hourlyData } = await supabase
            .from('vehicle_log')
            .select('check_in')
            .gte('check_in', today)
            .lt('check_in', tomorrow);

        const { data: guestHourlyData } = await supabase
            .from('guestlog')
            .select('in')
            .gte('in', today)
            .lt('in', tomorrow);

        const { data: vipHourlyData } = await supabase
            .from('vip_log')
            .select('timestamp')
            .eq('type', 'in')
            .gte('timestamp', today)
            .lt('timestamp', tomorrow);

        const hourlyChart = Array(24).fill(0);

        if (hourlyData) {
            hourlyData.forEach(row => {
                const hour = new Date(row.check_in).getHours();
                hourlyChart[hour]++;
            });
        }

        if (guestHourlyData) {
            guestHourlyData.forEach(row => {
                const hour = new Date(row.in).getHours();
                hourlyChart[hour]++;
            });
        }

        if (vipHourlyData) {
            vipHourlyData.forEach(row => {
                const hour = new Date(row.timestamp).getHours();
                hourlyChart[hour]++;
            });
        }

        const { data: settingsData } = await supabase
            .from('parking_capacity')
            .select('parking_capacity')
            .order('date_time', { ascending: false })
            .limit(1)
            .maybeSingle();

        const maxCapacity = settingsData?.parking_capacity ?? -1;

        // Vehicle classification breakdown (currently in)
        const { data: vehicleTypeData } = await supabase
            .from('vehicle_log')
            .select(`
                vehicle_information:vehicle_information_id(
                    type
                )
            `)
            .is('check_out', null);

        let total_2_wheelers = 0;
        let total_4_wheelers = 0;

        if (vehicleTypeData) {
            vehicleTypeData.forEach((log: any) => {
                const vehicleType = log.vehicle_information?.type || '';
                if (vehicleType && (vehicleType.includes('2-Wheeler') || vehicleType.includes('Motorcycle') || vehicleType.includes('2-wheel'))) {
                    total_2_wheelers++;
                } else if (vehicleType && (vehicleType.includes('4-Wheeler') || vehicleType.includes('Car') || vehicleType.includes('4-wheel'))) {
                    total_4_wheelers++;
                }
            });
        }

        return json({
            stats: {
                currentlyIn: totalCurrentlyIn,
                visitsToday: totalVisitsToday,
                registeredIn: currentlyIn || 0,
                guestsIn: guestCurrentlyIn,
                vipsIn: vipCurrentlyIn,
                anomaliesToday,
                maxCapacity,
                total2Wheelers: total_2_wheelers,
                total4Wheelers: total_4_wheelers
            },
            roleBreakdown,
            hourlyChart
        });
    } catch (error) {
        console.error('[Gate] Stats error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
