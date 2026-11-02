import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request, locals }) => {
    try {
        // Check if user is authenticated
        if (!locals.user) {
            return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
        }

        const notificationData = await request.json();
        
        // Validate required fields
        if (!notificationData.user_id || !notificationData.notification_type || !notificationData.message) {
            return json({ error: 'Some required details are missing. Please fill in every required field and try again.' }, { status: 400 });
        }

        // Insert notification into database
        const { error } = await supabase
            .from('notification')
            .insert({
                recipient_user_id: notificationData.user_id,
                title: notificationData.activity || notificationData.message,
                notification_type: notificationData.notification_type,
                message: notificationData.message,
                actor_id: notificationData.actor_id || null,
                action_type: notificationData.action_type || null,
                target_entity_type: notificationData.target_entity_type || null,
                target_entity_id: notificationData.target_entity_id || null,
                reference_id: notificationData.reference_id || null,
                metadata: notificationData.metadata || null,
                is_read: false
            });

        if (error) {
            console.error('Error creating notification:', error);
            return apiFailure('create the notification', error);
        }

        return json({ success: true });
    } catch (error) {
        console.error('Create notification API error:', error);
        return apiFailure('create the notification', error);
    }
};