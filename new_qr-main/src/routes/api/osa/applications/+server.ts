import { apiFailure } from '$lib/server/apiError';
import { skipsSecurityReview } from '$lib/utils/statusLabels';
import { json } from '@sveltejs/kit';
import { reasonLengthError } from '$lib/limits';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import QRCode from 'qrcode';
import { sendEmail } from '$lib/server/email';
import { generateStyledQR, generateStyledQRBuffer } from '$lib/server/qr';
import { uploadToStorage } from '$lib/server/storage';
import { moveToRecycleBin } from '$lib/server/recycleBin';

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
            notification_type: notificationType,
            message: message,
            title: message,
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

function generateUniqueCode(length: number = 8): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { data: rows } = await supabase
            .from('sticker_application')
            .select(`
                *,
                department:department_id(
                    department_id,
                    academic_department,
                    administrative_department
                ),
                user:user_id(
                    email
                )
            `).neq('status', 'deleted')
            .order('created_at', { ascending: false });

        const applications = rows?.map(row => ({
            ...row,
            department_name: row.department?.academic_department || row.department?.administrative_department || (row.department as any)?.department_name || (row.department as any)?.department || 'Unknown Department',
            department_email: '-',
            user_email: row.user?.email
        })) || [];

        return json({ applications });
    } catch (error) {
        console.error('Failed to fetch osa applications:', error);
        return apiFailure('load the applications', error);
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || (locals.user.role !== 'osa' && locals.user.role !== 'security')) {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { registration_id, action, reason, schedule, school_year, expires_at } = await request.json();
        const reasonError = reasonLengthError(reason);
        if (reasonError) return json({ error: reasonError }, { status: 400 });


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
            .single();

        if (!rows) {
            return json({ error: 'This application could not be found. It may have been deleted. Please refresh the page.' }, { status: 404 });
        }

        const reg = rows;

        if (action === 'accept' && ['pending', 'dept_val', 'dept_validated', 'osa_val'].includes((reg.status || '').toLowerCase())) {
            if (!schedule) {
                return json({ error: 'Schedule is required to accept application' }, { status: 400 });
            }
            // Generate QR code with guaranteed unique alphanumeric string
            let uniqueCode = '';
            let isCodeUnique = false;
            let attempts = 0;
            while (!isCodeUnique && attempts < 15) {
                attempts++;
                uniqueCode = generateUniqueCode(8);
                const { data: duplicateCode } = await supabase
                    .from('sticker_application')
                    .select('registration_id')
                    .eq('qr_code', uniqueCode)
                    .maybeSingle();
                if (!duplicateCode) {
                    isCodeUnique = true;
                }
            }
            const qrData = uniqueCode;
            const filename = `qr-codes/qr-${registration_id}-${Date.now()}.png`;
            const qrBuffer = await generateStyledQRBuffer(qrData, reg.role, registration_id);
            const qrUrl = await uploadToStorage(filename, qrBuffer, 'image/png');

            let finalExpiresAt: string;
            if (expires_at) {
                finalExpiresAt = new Date(expires_at).toISOString();
            } else {
                const expiryMonths = parseInt(process.env.QR_EXPIRY_MONTHS || '6', 10);
                finalExpiresAt = new Date(new Date(reg.created_at).getTime() + expiryMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
            }

            const updatePayload: any = {
                status: 'osa_validated',
                osa_approved_at: new Date().toISOString(),
                qr_image: qrUrl,
                qr_code: uniqueCode,
                hardcopy_due_at: new Date(schedule).toISOString(),
                expires_at: finalExpiresAt
            };
            if (school_year) {
                updatePayload.school_year = school_year;
            }

            const { error: updateError } = await supabase
                .from('sticker_application')
                .update(updatePayload)
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Approved & Scheduled - Liceo GateQR',
                `Congratulations! Your vehicle sticker application (Registration No. ${registration_id}) has been accepted by OSA. Please visit the Office of Student Affairs on ${new Date(schedule).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila' })} and bring the notarized, filled-out hardcopy agreement and requirements.`,
                `<p style="margin:0 0 12px;">Congratulations! Your vehicle sticker application has been <strong>accepted by OSA</strong>.</p>
                 <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;font-size:14px;">
                   <tr><td style="padding:6px 0;color:#64748B;width:140px;">Registration No.</td><td style="padding:6px 0;font-weight:700;color:#6B1D2F;">${registration_id}</td></tr>
                   <tr><td style="padding:6px 0;color:#64748B;">OSA visit schedule</td><td style="padding:6px 0;font-weight:700;color:#6B1D2F;">${new Date(schedule).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila' })}</td></tr>
                 </table>
                 <p style="margin:0 0 6px;"><strong>Please bring:</strong></p>
                 <ul style="margin:0;padding-left:20px;">
                   <li>Notarized, filled-out hardcopy agreement</li>
                   <li>Notarized hardcopies of your submitted requirements</li>
                 </ul>`
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'application_approved',
                    `Your vehicle registration application has been approved by OSA. Your physical hardcopy compliance visit is scheduled on: ${new Date(schedule).toLocaleString()}.`,
                    actorId,
                    'approve_application',
                    'registration',
                    registration_id,
                    registration_id,
                    { schedule: new Date(schedule).toISOString() }
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'application_approved',
                    `Successfully approved application for ${reg.user.email} and scheduled visit for: ${new Date(schedule).toLocaleString()}.`,
                    actorId,
                    'approve_application_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        } 
        else if (action === 'reject' && ['osa_val', 'osa_validated', 'dept_validated', 'dept_val', 'pending'].includes((reg.status || '').toLowerCase())) {
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

            await sendEmail(
                reg.user.email,
                'Application Rejected by OSA - Liceo GateQR',
                `Your vehicle sticker application was rejected by OSA. Reason: ${reason}`,
                `<p>Your vehicle sticker application was <strong>rejected by OSA</strong>.</p><p>Reason: <em>${reason}</em></p>`
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'application_rejected',
                    `Your vehicle registration application was reviewed and rejected by OSA. Reason: ${reason}`,
                    actorId,
                    'reject_application',
                    'registration',
                    registration_id,
                    registration_id,
                    { reason }
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'application_rejected',
                    `Successfully rejected application for ${reg.user.email}. Reason: ${reason}`,
                    actorId,
                    'reject_application_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'check_hardcopy' && ['distributed', 'osa_validated'].includes((reg.status || '').toLowerCase())) {
            const skipsSecurity = skipsSecurityReview(reg.role);
            const nowHardcopyIso = new Date().toISOString();
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update(skipsSecurity ? {
                    // These applications skip the Security document review
                    status: 'security_checked',
                    hardcopy_received_at: nowHardcopyIso,
                    security_checked_at: nowHardcopyIso
                } : { 
                    status: 'distributed',
                    hardcopy_received_at: nowHardcopyIso
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            if (skipsSecurity) {
                await sendEmail(
                    reg.user.email,
                    'Payment Required - Liceo GateQR',
                    'OSA has checked your hardcopy documents. You can now pay at the cashier, then log in to GateQR and upload a photo of your payment receipt.',
                    '<p style="margin:0 0 12px;">OSA has <strong>checked your hardcopy documents</strong>.</p><p style="margin:0 0 6px;"><strong>Next steps:</strong></p><ol style="margin:0;padding-left:20px;"><li>Pay the sticker fee at the cashier.</li><li>Log in to GateQR and upload a clear photo of your payment receipt.</li></ol>'
                );
            } else {
                await sendEmail(
                    reg.user.email,
                    'Hardcopy Documents Received - Liceo GateQR',
                    'Your hardcopy documents have been checked by OSA and forwarded to Safety and Security for document review. We will email you once you can proceed to payment.',
                    '<p style="margin:0 0 12px;">Your hardcopy documents have been <strong>checked by OSA</strong> and forwarded to <strong>Safety and Security</strong> for document review.</p><p style="margin:0;">We will email you as soon as you can proceed to payment.</p>'
                );
            }

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'hardcopy_received',
                    'OSA has verified and confirmed your physical hardcopy compliance documents.',
                    actorId,
                    'check_hardcopy',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'hardcopy_received',
                    `Successfully verified hardcopy compliance documents for ${reg.user.email}.`,
                    actorId,
                    'check_hardcopy_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'release_sticker' && ['receipt_submitted'].includes((reg.status || '').toLowerCase())) {
            // Check if this application was undergoing a Request to Change Registration Details
            const { data: changeReq } = await supabase
                .from('profile_update_request')
                .select('*')
                .eq('registration_id', registration_id)
                .in('status', ['approved', 'pending'])
                .order('requested_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const isChangeRequest = !!changeReq;
            const nowIso = new Date().toISOString();

            const updateData: any = {
                status: isChangeRequest ? 'approved' : 'completed',
                sticker_released_at: nowIso
            };

            const { error: updateError } = await supabase
                .from('sticker_application')
                .update(updateData)
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            // If change request, update the vehicle info and mark change request as completed/approved
            if (isChangeRequest) {
                const proposed = changeReq.proposed_changes || {};
                const currentVehId = reg.vehicle_id;
                if (currentVehId && (proposed.vehicle_plate || proposed.plate_number)) {
                    await supabase
                        .from('vehicle')
                        .update({
                            plate_number: proposed.vehicle_plate || proposed.plate_number,
                            brand: proposed.vehicle_make || proposed.brand || undefined,
                            vehicle_type: proposed.vehicle_type || proposed.type || undefined
                        })
                        .eq('vehicle_id', currentVehId);
                }

                await supabase
                    .from('profile_update_request')
                    .update({ status: 'approved', processed_at: nowIso })
                    .eq('profile_update_request_id', changeReq.profile_update_request_id);

                await sendEmail(
                    reg.user.email,
                    'Application Completed - Liceo GateQR',
                    'Your application has been completed. You can now claim your sticker at the Office of Student Affairs and go to the Security Office to get it installed on your vehicle.',
                    '<p style="margin:0 0 12px;">Your vehicle sticker application is <strong>complete</strong>.</p><ol style="margin:0;padding-left:20px;"><li>Claim your sticker at the Office of Student Affairs.</li><li>Proceed to the Security Office to have it installed on your vehicle.</li></ol>'
                );

                if (reg.user?.user_id) {
                    const actorId = locals.user?.user_id;
                    await createNotification(
                        reg.user.user_id,
                        'registration_change_completed',
                        'Your vehicle sticker was released and your registration change is now completed and registered!',
                        actorId,
                        'release_sticker',
                        'registration',
                        registration_id,
                        registration_id
                    );
                }
            } else {
                await sendEmail(
                    reg.user.email,
                    'Application Completed - Liceo GateQR',
                    'Your application has been completed. You can now claim your sticker at the Office of Student Affairs and go to the Security Office to get it installed on your vehicle.',
                    '<p style="margin:0 0 12px;">Your vehicle sticker application is <strong>complete</strong>.</p><ol style="margin:0;padding-left:20px;"><li>Claim your sticker at the Office of Student Affairs.</li><li>Proceed to the Security Office to have it installed on your vehicle.</li></ol>'
                );
                if (reg.user?.user_id) {
                    const actorId = locals.user?.user_id;
                    await createNotification(
                        reg.user.user_id,
                        'sticker_released',
                        'Your vehicle sticker has been authorized and released by OSA. Please proceed to Safety and Security for sticker installation.',
                        actorId,
                        'release_sticker',
                        'registration',
                        registration_id,
                        registration_id
                    );
                }
                const actorId = locals.user?.user_id;
                if (actorId) {
                    await createNotification(
                        actorId,
                        'sticker_released',
                        `Successfully released vehicle sticker authorization for ${reg.user.email}.`,
                        actorId,
                        'release_sticker_success',
                        'registration',
                        registration_id,
                        registration_id
                    );
                }
            }
        }
        else if (action === 'reschedule' && ['distributed', 'osa_validated'].includes((reg.status || '').toLowerCase())) {
            if (!schedule) {
                return json({ error: 'A new schedule date is required to reschedule' }, { status: 400 });
            }

            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    hardcopy_due_at: new Date(schedule).toISOString()
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'OSA Visit Rescheduled — Liceo GateQR',
                `Your OSA visit for hardcopy submission has been rescheduled. New schedule: ${new Date(schedule).toLocaleString()}. Please make sure to visit OSA on this date to submit your hardcopy documents.`,
                `<p>Your OSA visit for hardcopy submission has been <strong>rescheduled</strong>.</p><p>New schedule: <strong>${new Date(schedule).toLocaleString()}</strong>.</p><p>Please make sure to visit OSA on this date to submit your hardcopy documents.</p>`
            );

            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'schedule_updated',
                    `Your OSA visit for hardcopy compliance has been rescheduled to ${new Date(schedule).toLocaleString()}.`,
                    actorId,
                    'reschedule_visit',
                    'registration',
                    registration_id,
                    registration_id,
                    { schedule: new Date(schedule).toISOString() }
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'schedule_updated',
                    `Successfully rescheduled the application visit for ${reg.user.email}.`,
                    actorId,
                    'reschedule_visit_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'proceed_overdue' && ['distributed', 'osa_validated'].includes((reg.status || '').toLowerCase())) {
            const newSchedule = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    hardcopy_due_at: newSchedule
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'schedule_updated',
                    `Your OSA visit was marked as overdue and has proceeded to Hardcopy Compliance.`,
                    actorId,
                    'proceed_overdue',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'schedule_updated',
                    `Successfully proceeded overdue application for ${reg.user.email} directly to Hardcopy Compliance.`,
                    actorId,
                    'proceed_overdue_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'revoke' && ['distributed', 'completed', 'approved', 'security_checked', 'osa_validated'].includes((reg.status || '').toLowerCase())) {
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

            await sendEmail(
                reg.user.email,
                'Application Revoked - Liceo GateQR',
                `Your parking access has been revoked by OSA. Reason: ${reason}`,
                `<p>Your parking access has been <strong>revoked</strong> by OSA.</p><p>Reason: <em>${reason}</em></p>`
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'access_revoked',
                    `Your vehicle registration access has been revoked by OSA. Reason: ${reason}`,
                    actorId,
                    'revoke_access',
                    'registration',
                    registration_id,
                    registration_id,
                    { reason }
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'access_revoked',
                    `Successfully revoked vehicle registration access for ${reg.user.email}. Reason: ${reason}`,
                    actorId,
                    'revoke_access_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'retract') {
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    status: 'osa_validated', 
                    security_checked_at: null, 
                    revoked_at: null, 
                    rejected_at: null, 
                    rejected_reason: null, 
                    revoked_reason: null
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Approval Retracted - Liceo GateQR',
                'Your application approval has been retracted by OSA and is back under review.',
                '<p>Your application approval has been <strong>retracted</strong> by OSA and is back under review.</p>'
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'approval_retracted',
                    'Your vehicle registration approval was retracted by OSA and placed back under review.',
                    actorId,
                    'retract_approval',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'approval_retracted',
                    `Successfully retracted application approval for ${reg.user.email}.`,
                    actorId,
                    'retract_approval_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'unrevoke' && reg.status === 'revoked') {
            if (reg.expires_at && new Date(reg.expires_at) < new Date()) {
                return json({ error: 'Cannot unrevoke an expired registration' }, { status: 400 });
            }
            
            const restoredStatus = reg.security_checked_at ? 'approved' : 'osa_validated';
            const { error: updateError } = await supabase
                .from('sticker_application')
                .update({ 
                    status: restoredStatus, 
                    revoked_at: null, 
                    revoked_reason: null 
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Unrevoked - Liceo GateQR',
                'Your parking access has been restored by OSA.',
                '<p>Your parking access has been <strong>restored</strong> by OSA.</p>'
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'access_restored',
                    'Your vehicle registration access has been restored by OSA.',
                    actorId,
                    'restore_access',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'access_restored',
                    `Successfully restored vehicle registration access for ${reg.user.email}.`,
                    actorId,
                    'restore_access_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else if (action === 'delete') {
            // Deletion moves the application to Recently Deleted (OSA can restore it); the applicant is emailed
            if (!reason || typeof reason !== 'string' || !reason.trim()) {
                return json({ error: 'Please give a reason for deleting this application.' }, { status: 400 });
            }
            await moveToRecycleBin(registration_id, reason, {
                user_id: locals.user?.user_id,
                email: locals.user?.email,
                role: locals.user?.role
            });

            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'application_deleted',
                    `Your vehicle registration was deleted. Reason: ${reason.trim()}`,
                    actorId,
                    'delete_application',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
            if (actorId) {
                await createNotification(
                    actorId,
                    'application_deleted',
                    `Moved the application of ${reg.user?.email || `Reg. No. ${registration_id}`} to Recently Deleted.`,
                    actorId,
                    'delete_application_success',
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
        console.error('Failed to update osa application:', error);
        return apiFailure('process this action on the application', error);
    }
};
