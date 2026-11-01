import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { supabase } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    const { data: userRow } = await supabase
        .from('users')
        .select('user_id, email, account_role, account_type, is_active, created_at, google_auth_id')
        .eq('user_id', locals.user.user_id)
        .single();

    return {
        userEmail: locals.user.email,
        adminUser: {
            user_id: userRow?.user_id || locals.user.user_id,
            email: userRow?.email || locals.user.email,
            account_role: userRow?.account_role || 'Osa',
            account_type: userRow?.account_type || 'Admin',
            created_at: userRow?.created_at || null,
            is_active: userRow?.is_active ?? true,
            google_linked: !!userRow?.google_auth_id
        }
    };
};
