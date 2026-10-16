import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        throw redirect(303, '/login');
    }

    const { data: userRow } = await supabase
        .from('users')
        .select('user_id, email, user_type, identification, is_active, created_at, security_pin_hash')
        .eq('user_id', locals.user.user_id)
        .single();

    return {
        userEmail: locals.user.email,
        userRole: 'security',
        adminUser: {
            user_id: userRow?.user_id || locals.user.user_id,
            email: userRow?.email || locals.user.email,
            user_type: 'Security Administrator',
            identification: userRow?.identification || 'Admin',
            created_at: userRow?.created_at || null,
            is_active: userRow?.is_active ?? true,
            has_pin: !!userRow?.security_pin_hash
        }
    };
};
