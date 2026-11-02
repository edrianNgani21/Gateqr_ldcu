import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
    try {
        if (!locals.user) {
            return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
        }

        const userId = locals.user.user_id;

        let updateQuery = supabase
            .from('notification')
            .update({
                is_read: true
            })
            .eq('is_read', false);

        if (locals.user.role !== 'osa') {
            updateQuery = updateQuery.eq('recipient_user_id', userId);
        }

        const { error } = await updateQuery;

        if (error) {
            console.error('Error marking all notifications as read:', error);
            return apiFailure('mark your notifications as read', error);
        }

        return json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        return apiFailure('mark your notifications as read', error);
    }
};
