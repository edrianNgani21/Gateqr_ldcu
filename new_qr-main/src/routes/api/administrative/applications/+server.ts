import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

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
    } catch (error) {
        console.error('Failed to create notification:', error);
    }
}

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || (locals.user.role !== 'dean' && locals.user.role !== 'administrative')) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { registration_id, action, reason } = await request.json();

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

        // Check if registration belongs to user's administrative dept
        const { data: rows } = await supabase
            .from('registration')
            .select(`
                *,
                user:user_id(
                    email,
                    user_id
                )
            `)
            .eq('registration_id', registration_id)
            .eq('department_id', departmentIdForAuth)
            .single();

        if (!rows) {
            return json({ error: 'Application not found or unauthorized' }, { status: 404 });
        }

        const reg = rows;

        if (action === 'accept' && (reg.status === 'dept_val' || reg.status === 'pending')) {
            const { error: updateError } = await supabase
                .from('registration')
                .update({ status: 'dept_validated', dept_val_at: new Date().toISOString() })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Approved by Department Head - Liceo GateQR',
                'Your vehicle sticker application has been approved by your Administrative Department Head and is now pending final validation by the Office of Student Affairs (OSA).',
                '<p>Your vehicle sticker application has been <strong>approved by your Administrative Department Head</strong>.</p><p>It is now pending final validation by the Office of Student Affairs (OSA).</p>'
            );

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'application_approved_by_dean',
                    'Your vehicle registration application has been approved by your Administrative Department Head and forwarded to OSA.',
                    actorId,
                    'approve_application',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        } 
        else if (action === 'reject' && (reg.status === 'dept_val' || reg.status === 'pending' || reg.status === 'dept_validated')) {
            if (!reason) return json({ error: 'Reason required' }, { status: 400 });
            
            const { error: updateError } = await supabase
                .from('registration')
                .update({ 
                    status: 'rejected', 
                    rejected_at: new Date().toISOString(), 
                    rejection_reason: reason 
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Rejected by Department Head - Liceo GateQR',
                `Your vehicle sticker application has been rejected by your Administrative Department Head. Reason: ${reason}`,
                `<p>Your vehicle sticker application has been <strong>rejected by your Administrative Department Head</strong>.</p><p><strong>Reason:</strong> ${reason}</p>`
            );

            // Create notification for the applicant
            if (reg.user?.user_id) {
                const actorId = locals.user?.user_id;
                await createNotification(
                    reg.user.user_id,
                    'application_rejected_by_dean',
                    `Your vehicle registration application was rejected by your Administrative Department Head: ${reason}`,
                    actorId,
                    'reject_application',
                    'registration',
                    registration_id,
                    registration_id,
                    { reason }
                );
            }
        } else {
            return json({ error: 'Invalid action or application status not eligible for department review' }, { status: 400 });
        }

        return json({ success: true });
    } catch (error: any) {
        console.error('Error handling administrative application action:', error);
        return json({ error: error?.message || 'Failed to update application' }, { status: 500 });
    }
};
