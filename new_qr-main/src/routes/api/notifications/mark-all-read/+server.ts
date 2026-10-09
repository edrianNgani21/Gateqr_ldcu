import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ locals }) => {
    try {
        if (!locals.user) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = locals.user.user_id;

        let updateQuery = supabase
            .from('notifications')
            .update({
                is_read: true,
                read_at: new Date().toISOString()
            })
            .eq('is_read', false);

        if (locals.user.role !== 'osa') {
            updateQuery = updateQuery.eq('user_id', userId);
        }

        const { error } = await updateQuery;

        if (error) {
            console.error('Error marking all notifications as read:', error);
            return json({ error: 'Failed to mark notifications as read' }, { status: 500 });
        }

        return json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all read error:', error);
        return json({ error: 'Internal server error' }, { status: 500 });
    }
};
