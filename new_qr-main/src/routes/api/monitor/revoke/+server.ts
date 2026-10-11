import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

export const POST: RequestHandler = async ({ request, locals }) => {
    // Only Security can revoke
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const targetId = body.registration_id || body.id || body.vehicle_id;
        if (!targetId) return json({ error: 'Missing registration_id' }, { status: 400 });

        // Get user for email notification
        const { data: reg } = await supabase
            .from('registration')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', targetId)
            .single();

        const { error: updateError } = await supabase
            .from('registration')
            .update({ 
                status: 'revoked', 
                revoke_at: new Date().toISOString() 
            })
            .eq('registration_id', targetId);

        if (updateError) throw updateError;

        if (reg?.user_id) {
            const notifMsg = 'Your vehicle registration has been revoked by Safety & Security Admin.';
            await supabase.from('notification').insert({
                user_id: reg.user_id,
                activity: notifMsg,
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
                await sendEmail(
                    email,
                    'Application Update: Vehicle Registration Revoked',
                    'Your vehicle registration status has been changed to REVOKED by Safety & Security Admin.'
                );
            }
        }

        return json({ success: true });
    } catch (error) {
        console.error('[Monitor] Revoke error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
    // Only Security can unrevoke
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        const targetId = body.registration_id || body.id || body.vehicle_id;
        if (!targetId) return json({ error: 'Missing registration_id' }, { status: 400 });

        const { data: reg } = await supabase
            .from('registration')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', targetId)
            .single();

        // Restore to approved (fully approved) and clear the revoked timestamp
        const { error: updateError } = await supabase
            .from('registration')
            .update({
                status: 'approved',
                revoke_at: null
            })
            .eq('registration_id', targetId)
            .eq('status', 'revoked');

        if (updateError) throw updateError;

        if (reg?.user_id) {
            const notifMsg = 'Your vehicle registration has been restored to active status.';
            await supabase.from('notification').insert({
                user_id: reg.user_id,
                activity: notifMsg,
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
                await sendEmail(
                    email,
                    'Application Update: Registration Restored',
                    'Your vehicle registration status has been restored to active status by Safety & Security Admin.'
                );
            }
        }

        return json({ success: true });
    } catch (error) {
        console.error('[Monitor] Unrevoke error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

