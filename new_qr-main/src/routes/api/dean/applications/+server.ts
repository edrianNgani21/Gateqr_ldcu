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
    } catch (error) {
        console.error('Failed to create notification:', error);
    }
}

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || (locals.user.role !== 'dean' && locals.user.role !== 'administrative')) {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { registration_id, action, reason } = await request.json();
        const reasonError = reasonLengthError(reason);
        if (reasonError) return json({ error: reasonError }, { status: 400 });


        // Get the department_id to use for authorization
        let departmentIdForAuth = locals.user.department_id;
        
        if (!departmentIdForAuth) {
            // Fallback: get department_id from users table
            const { data: userRow } = await supabase
                .from('users')
                .select('department_id')
                .eq('email', locals.user.email)
                .maybeSingle();
            
            if (userRow?.department_id) {
                departmentIdForAuth = userRow.department_id;
            }
        }

        // Check if registration belongs to dean's dept
        const { data: rows } = await supabase
            .from('sticker_application')
            .select(`
                *,
                user:user_id(
                    email,
                    user_id
                )
            `).neq('status', 'deleted')
            .eq('registration_id', registration_id)
            .eq('department_id', departmentIdForAuth)
            .single();

        if (!rows) {
            return json({ error: 'This application could not be found, or it does not belong to your department. Please refresh the page.' }, { status: 404 });
        }

        const reg = rows;

        if (action === 'accept' && (reg.status === 'dept_val' || reg.status === 'pending')) {
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ status: 'dept_validated', dept_approved_at: new Date().toISOString() })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            sendEmailAsync(
                reg.user.email,
                'Application Approved by Dean - Liceo GateQR',
                'Your vehicle sticker application has been approved by your Dean and is now pending final validation by the Office of Student Affairs (OSA).',
                '<p>Your vehicle sticker application has been <strong>approved by your Dean</strong>.</p><p>It is now pending final validation by the Office of Student Affairs (OSA).</p>'
            );

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'application_approved_by_dean',
                    'Your vehicle registration application has been approved by your Department Dean and forwarded to OSA.',
                    actorId,
                    'approve_application',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        } 
        else if (action === 'reject' && (reg.status === 'dept_val' || reg.status === 'pending' || reg.status === 'dept_validated')) {
            if (!reason) return json({ error: 'Please enter a reason before continuing.' }, { status: 400 });
            
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    status: 'rejected', 
                    rejected_at: new Date().toISOString(), 
                    rejected_reason: reason 
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            sendEmailAsync(
                reg.user.email,
                'Application Rejected by Dean - Liceo GateQR',
                `Your vehicle sticker application was rejected by your Dean. Reason: ${reason}`,
                `<p>Your vehicle sticker application was <strong>rejected by your Dean</strong>.</p><p>Reason: <em>${reason}</em></p>`
            );

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'application_rejected_by_dean',
                    `Your vehicle registration application was rejected by your Dean. Reason: ${reason}`,
                    actorId,
                    'reject_application',
                    'registration',
                    registration_id,
                    registration_id,
                    { reason }
                );
            }
        }
        else if (action === 'revoke' && (reg.status === 'osa_val' || reg.status === 'dept_validated' || reg.status === 'osa_validated')) {
            // Dean can revoke if OSA hasn't completed yet
            if (!reason) return json({ error: 'Please enter a reason before continuing.' }, { status: 400 });
            
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    status: 'revoked', 
                    revoked_at: new Date().toISOString(), 
                    revoked_reason: reason 
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            sendEmailAsync(
                reg.user.email,
                'Application Revoked by Dean - Liceo GateQR',
                `Your vehicle sticker application was revoked by your Dean before OSA validation. Reason: ${reason}`,
                `<p>Your vehicle sticker application was <strong>revoked by your Dean</strong>.</p><p>Reason: <em>${reason}</em></p>`
            );

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'application_revoked_by_dean',
                    'Application revoked by Dean successfully!',
                    actorId,
                    'revoke_application',
                    'registration',
                    registration_id,
                    registration_id,
                    { reason }
                );
            }
        }
        else if (action === 'retract' && (reg.status === 'osa_val' || reg.status === 'rejected' || reg.status === 'dept_validated')) {
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    status: 'pending', 
                    dept_approved_at: null, 
                    rejected_at: null, 
                    rejected_reason: null 
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'approval_retracted_by_dean',
                    'Approval retracted by Dean successfully!',
                    actorId,
                    'retract_approval',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else {
            return json({ error: 'This action is not available for the current status of the application. It may already have been processed. Please refresh the page.' }, { status: 400 });
        }

        return json({ message: 'Application updated' });
    } catch (error) {
        console.error('Failed to update dean application:', error);
        return apiFailure('update the application', error);
    }
};
