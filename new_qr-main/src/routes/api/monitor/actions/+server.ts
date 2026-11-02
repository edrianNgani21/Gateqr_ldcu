import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import { reasonLengthError } from '$lib/limits';
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
            recipient_user_id: userId,
            title: message,
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
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const { vehicle_id, action, reason, schedule } = await request.json();
        const reasonError = reasonLengthError(reason);
        if (reasonError) return json({ error: reasonError }, { status: 400 });


        if (!vehicle_id || !action) {
            return json({ error: 'The request is missing required details. Please refresh the page and try again.' }, { status: 400 });
        }

        // Fetch user id & user email from registration to send notification
        const { data: reg, error: fetchError } = await supabase
            .from('sticker_application')
            .select('user_id, users:user_id(email)')
            .eq('registration_id', vehicle_id)
            .single();

        if (fetchError || !reg) {
            return json({ error: 'This registration could not be found. It may have been deleted. Please refresh the page.' }, { status: 404 });
        }

        let updateData: any = {};
        let notifType = '';
        let notifMessage = '';
        let emailSubject = '';

        if (action === 'security_check') {
            updateData = { 
                security_checked_at: new Date().toISOString(),
                status: 'security_checked'
            };
            notifType = 'security_checked';
            notifMessage = 'Safety and Security has checked your documents. You can now pay at the cashier and upload your payment receipt.';
            emailSubject = 'Payment Required - Liceo GateQR';
        } else if (action === 'security_reject') {
            const rejectReason = (reason || schedule || '').trim();
            if (!rejectReason) {
                return json({ error: 'Please enter the reason for rejecting this request.' }, { status: 400 });
            }
            updateData = {
                status: 'rejected',
                rejected_at: new Date().toISOString(),
                rejected_reason: rejectReason
            };
            notifType = 'rejected';
            notifMessage = `Your vehicle registration was rejected during Security Document Review. Reason: ${rejectReason}`;
            emailSubject = 'Application Rejected - Liceo GateQR';
        } else {
            return json({ error: 'This action is not recognized. Please refresh the page and try again.' }, { status: 400 });
        }

        const { error: updateError } = await supabase
            .from('sticker_application')
            .update(updateData)
            .eq('registration_id', vehicle_id);

        if (updateError) {
            console.error('Update error:', updateError);
            return apiFailure('update the application', updateError);
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
        return apiFailure('process the action', error);
    }
};
