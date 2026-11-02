import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ params, locals }) => {
    try {
        // Check if user is authenticated
        if (!locals.user) {
            return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
        }

        const notificationId = parseInt(params.notificationId);
        const userId = locals.user.user_id;

        // Mark notification as read
        let updateQuery = supabase
            .from('notification')
            .update({ 
                is_read: true 
            })
            .eq('notification_id', notificationId);

        if (locals.user.role !== 'osa') {
            updateQuery = updateQuery.eq('recipient_user_id', userId);
        }

        const { error } = await updateQuery;

        if (error) {
            console.error('Error marking notification as read:', error);
            return apiFailure('mark the notification as read', error);
        }

        return json({ success: true });
    } catch (error) {
        console.error('Mark notification read API error:', error);
        return apiFailure('mark the notification as read', error);
    }
};