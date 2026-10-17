import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

interface CachedAdminUser {
    data: any;
    timestamp: number;
}
const userCache = new Map<string | number, CachedAdminUser>();

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    const cacheKey = locals.user.user_id || locals.user.email;
    const now = Date.now();
    const cached = userCache.get(cacheKey);

    if (cached && now - cached.timestamp < 15000) {
        return {
            userEmail: locals.user.email,
            userRole: 'security',
            adminUser: cached.data
        };
    }

    const userQuery = locals.user.user_id 
        ? supabase.from('users').select('user_id, email, user_type, identification, is_active, created_at, security_pin_hash').eq('user_id', locals.user.user_id)
        : supabase.from('users').select('user_id, email, user_type, identification, is_active, created_at, security_pin_hash').ilike('email', locals.user.email);

    const { data: userRow } = await userQuery.maybeSingle();

    const adminUser = {
        user_id: userRow?.user_id || locals.user.user_id,
        email: userRow?.email || locals.user.email,
        user_type: 'Security Administrator',
        identification: userRow?.identification || 'Admin',
        created_at: userRow?.created_at || null,
        is_active: userRow?.is_active ?? true,
        has_pin: !!userRow?.security_pin_hash
    };

    userCache.set(cacheKey, { data: adminUser, timestamp: now });

    return {
        userEmail: locals.user.email,
        userRole: 'security',
        adminUser
    };
};
