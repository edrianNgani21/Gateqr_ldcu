import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail, sendEmailAsync } from '$lib/server/email';

export const POST: RequestHandler = async ({ request, locals }) => {
    // Only Security can revoke
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const targetId = body.registration_id || body.id || body.vehicle_id;
        if (!targetId) return json({ error: 'No application was selected. Please refresh the page and try again.' }, { status: 400 });

        // Get user for email notification
        const { data: reg } = await supabase
            .from('sticker_application')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', targetId)
            .single();

        const { error: updateError } = await supabase
            .from('sticker_application')
            .update({ 
                status: 'revoked', 
                revoked_at: new Date().toISOString() 
            })
            .eq('registration_id', targetId);

        if (updateError) throw updateError;

        if (reg?.user_id) {
            const notifMsg = 'Your vehicle registration has been revoked by Safety & Security Admin.';
            await supabase.from('notification').insert({
                recipient_user_id: reg.user_id,
                title: notifMsg,
                notification_type: 'revoked',
                message: notifMsg,
                actor_id: locals.user.user_id,
                action_type: 'revoke',
                target_entity_type: 'registration',
                target_entity_id: targetId,
                reference_id: targetId,
                is_read: false
            });

            const email = (reg.users as any)?.email;
            if (email) {
                sendEmailAsync(
                    email,
                    'Application Update: Vehicle Registration Revoked',
                    'Your vehicle registration status has been changed to REVOKED by Safety & Security Admin.'
                );
            }
        }

        return json({ success: true });
    } catch (error) {
        console.error('[Monitor] Revoke error:', error);
        return apiFailure('revoke the QR code', error);
    }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
    // Only Security can unrevoke
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const targetId = body.registration_id || body.id || body.vehicle_id;
        if (!targetId) return json({ error: 'No application was selected. Please refresh the page and try again.' }, { status: 400 });

        const { data: reg } = await supabase
            .from('sticker_application')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', targetId)
            .single();

        // Restore to approved (fully approved) and clear the revoked timestamp
        const { error: updateError } = await supabase
            .from('sticker_application')
            .update({
                status: 'approved',
                revoked_at: null
            })
            .eq('registration_id', targetId)
            .eq('status', 'revoked');

        if (updateError) throw updateError;

        if (reg?.user_id) {
            const notifMsg = 'Your vehicle registration has been restored to active status.';
            await supabase.from('notification').insert({
                recipient_user_id: reg.user_id,
                title: notifMsg,
                notification_type: 'restored',
                message: notifMsg,
                actor_id: locals.user.user_id,
                action_type: 'restore',
                target_entity_type: 'registration',
                target_entity_id: targetId,
                reference_id: targetId,
                is_read: false
            });

            const email = (reg.users as any)?.email;
            if (email) {
                sendEmailAsync(
                    email,
                    'Application Update: Registration Restored',
                    'Your vehicle registration status has been restored to active status by Safety & Security Admin.'
                );
            }
        }

        return json({ success: true });
    } catch (error) {
        console.error('[Monitor] Unrevoke error:', error);
        return apiFailure('restore the QR code', error);
    }
};

