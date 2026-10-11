import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ params, locals }) => {
    try {
        // Check if user is authenticated
        if (!locals.user) {
            return json({ error: 'Unauthorized' }, { status: 401 });
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
            updateQuery = updateQuery.eq('user_id', userId);
        }

        const { error } = await updateQuery;

        if (error) {
            console.error('Error marking notification as read:', error);
            return json({ error: 'Failed to mark notification as read' }, { status: 500 });
        }

        return json({ success: true });
    } catch (error) {
        console.error('Mark notification read API error:', error);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};