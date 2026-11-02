import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ locals }) => {
    try {
        // Check if user is authenticated
        if (!locals.user) {
            return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
        }

        const userId = locals.user.user_id;
        console.log('Fetching notifications for user_id:', userId);

        let query = supabase
            .from('notification')
            .select(`
                *,
                user:recipient_user_id(email)
            `)
            .order('created_at', { ascending: false })
            .limit(50);

        // Show only notifications addressed to this authenticated user
        query = query.eq('recipient_user_id', userId);

        const { data: notifications, error } = await query;

        console.log('Notifications query result:', { error, count: notifications?.length });

        if (error) {
            console.error('Error fetching notifications:', error);
            return apiFailure('load your notifications', error);
        }

        // Safely resolve actor email if actor_id is present
        if (notifications && notifications.length > 0) {
            const actorIds = [...new Set(notifications.map(n => n.actor_id).filter(Boolean))];
            if (actorIds.length > 0) {
                const { data: actors } = await supabase
                    .from('users')
                    .select('user_id, email')
                    .in('user_id', actorIds);
                
                const actorMap = new Map((actors || []).map(a => [a.user_id, a.email]));
                notifications.forEach(n => {
                    if (n.actor_id && actorMap.has(n.actor_id)) {
                        n.actor = { email: actorMap.get(n.actor_id) };
                    }
                });
            }
        }

        return json({ notifications: notifications || [] });
    } catch (error) {
        console.error('Notifications API error:', error);
        return apiFailure('load your notifications', error);
    }
};