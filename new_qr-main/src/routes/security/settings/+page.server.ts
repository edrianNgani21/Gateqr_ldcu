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
        ? supabase.from('users').select('user_id, email, account_role, account_type, is_active, created_at, google_auth_id').eq('user_id', locals.user.user_id)
        : supabase.from('users').select('user_id, email, account_role, account_type, is_active, created_at, google_auth_id').ilike('email', locals.user.email);

    const { data: userRow } = await userQuery.maybeSingle();

    const adminUser = {
        user_id: userRow?.user_id || locals.user.user_id,
        email: userRow?.email || locals.user.email,
        account_role: 'Security Administrator',
        account_type: userRow?.account_type || 'Admin',
        created_at: userRow?.created_at || null,
        is_active: userRow?.is_active ?? true,
        google_linked: !!userRow?.google_auth_id
    };

    userCache.set(cacheKey, { data: adminUser, timestamp: now });

    return {
        userEmail: locals.user.email,
        userRole: 'security',
        adminUser
    };
};
