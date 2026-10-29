import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail, sendEmailAsync } from '$lib/server/email';

async function createNotification(
    userId: number,
    notificationType: string,
    message: string,
    actorId?: number,
    actionType?: string,
    targetEntityType?: string,
    targetEntityId?: number,
    referenceId?: number,
    metadata?: any
) {
    try {
        await supabase.from('notification').insert({
            user_id: userId,
            activity: message,
            notification_type: notificationType,
            message: message,
            actor_id: actorId || null,
            action_type: actionType || null,
            target_entity_type: targetEntityType || null,
            target_entity_id: targetEntityId || null,
            reference_id: referenceId || null,
            metadata: metadata || null,
            is_read: false
        });
    } catch (e) {
        console.error('Failed to create notification:', e);
    }
}

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || (locals.user.role !== 'security' && locals.user.role !== 'osa')) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { vehicle_id, action, reason, schedule } = await request.json();

        if (!vehicle_id || !action) {
            return json({ error: 'Missing parameters' }, { status: 400 });
        }

        // Fetch user id & user email from registration to send notification
        const { data: reg, error: fetchError } = await supabase
            .from('registration')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', vehicle_id)
            .single();

        if (fetchError || !reg) {
            return json({ error: 'Registration not found' }, { status: 404 });
        }

        let updateData: any = {};
        let notifType = '';
        let notifMessage = '';
        let emailSubject = '';

        if (action === 'security_check') {
            updateData = { 
                security_check_at: new Date().toISOString(),
                status: 'security_checked'
            };
            notifType = 'security_checked';
            notifMessage = 'You can now pay at the cashier and upload your payment receipt.';
            emailSubject = 'Payment Required - Liceo GateQR';
        } else if (action === 'security_reject') {
            const rejectReason = (reason || schedule || '').trim();
            if (!rejectReason) {
                return json({ error: 'Rejection reason is required' }, { status: 400 });
            }
            updateData = {
                status: 'rejected',
                rejected_at: new Date().toISOString(),
                rejection_reason: rejectReason
            };
            notifType = 'rejected';
            notifMessage = `Your vehicle registration was rejected during Security Document Review. Reason: ${rejectReason}`;
            emailSubject = 'Application Rejected - Liceo GateQR';
        } else {
            return json({ error: 'Invalid action' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('registration')
            .update(updateData)
            .eq('registration_id', vehicle_id);

        if (updateError) {
            console.error('Update error:', updateError);
            return json({ error: 'Database update failed' }, { status: 500 });
        }

        if (reg.user_id) {
            await createNotification(
                reg.user_id,
                notifType,
                notifMessage,
                locals.user.user_id,
                action,
                'registration',
                vehicle_id,
                vehicle_id
            );

            // Send email in background
            const targetEmail = (reg.users as any)?.email;
            if (targetEmail) {
                sendEmailAsync(targetEmail, emailSubject, notifMessage);
            }
        }

        // Notify Security officer
        if (locals.user?.user_id) {
            const officerMsg = `Successfully verified vehicle documents for ${(reg.users as any)?.email || 'applicant'}.`;
            await createNotification(
                locals.user.user_id,
                notifType,
                officerMsg,
                locals.user.user_id,
                action,
                'registration',
                vehicle_id,
                vehicle_id
            );
        }

        return json({ success: true });
    } catch (error) {
        console.error('Error in monitor action:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
