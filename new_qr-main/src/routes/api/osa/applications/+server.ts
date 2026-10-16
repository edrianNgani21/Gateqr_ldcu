import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import QRCode from 'qrcode';
import { join } from 'path';
import fs from 'fs';
import { sendEmail } from '$lib/server/email';
import { generateStyledQR, generateStyledQRBuffer } from '$lib/server/qr';
import { uploadToStorage, deleteFromStorage } from '$lib/server/storage';

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
            notification_type: notificationType,
            message: message,
            activity: message,
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
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { data: rows } = await supabase
            .from('registration')
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
            `)
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
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || (locals.user.role !== 'osa' && locals.user.role !== 'security')) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { registration_id, action, reason, schedule, school_year, expires_at } = await request.json();

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
            .single();

        if (!rows) {
            return json({ error: 'Application not found' }, { status: 404 });
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
                    .from('registration')
                    .select('registration_id')
                    .eq('qr_unique_code', uniqueCode)
                    .maybeSingle();
                if (!duplicateCode) {
                    isCodeUnique = true;
                }
            }
            const qrData = uniqueCode;
            const filename = `qr-codes/qr-${registration_id}-${Date.now()}.png`;
            const qrBuffer = await generateStyledQRBuffer(qrData, reg.role);
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
                osa_val_at: new Date().toISOString(),
                qr_code: qrUrl,
                qr_unique_code: uniqueCode,
                schedule: new Date(schedule).toISOString(),
                expires_at: finalExpiresAt
            };
            if (school_year) {
                updatePayload.school_year = school_year;
            }

            const { error: updateError } = await supabase
                .from('registration')
                .update(updatePayload)
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Application Approved & Scheduled - Liceo GateQR',
                `Congrats your registration has been accepted. You are scheduled to visit OSA to pass the notarized filled up hardcopied agreements and notarized requirements, and receive your QR sticker code. Schedule: ${new Date(schedule).toLocaleString()}.`,
                `<p>Congrats your registration has been accepted. You are scheduled to visit OSA to pass the notarized filled up hardcopied agreements and notarized requirements, and receive your QR sticker code.</p><p>Schedule: <strong>${new Date(schedule).toLocaleString()}</strong>.</p>`
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
            const { error: updateError } = await supabase
                .from('registration')
                .update({ 
                    status: 'distributed',
                    osa_dist_at: new Date().toISOString()
                })
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            await sendEmail(
                reg.user.email,
                'Hardcopy Documents Received - Liceo GateQR',
                'Your hardcopy documents have been received by OSA and are now under review by Safety and Security.',
                '<p>Your hardcopy documents have been <strong>received by OSA</strong> and are now under review by Safety and Security.</p>'
            );

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
        else if (action === 'release_sticker' && ['distributed', 'osa_validated', 'security_checked'].includes((reg.status || '').toLowerCase())) {
            // Check if this application was undergoing a Request to Change Registration Details
            const { data: changeReq } = await supabase
                .from('modification_request')
                .select('*')
                .eq('registration_id', registration_id)
                .in('status', ['approved', 'pending'])
                .order('request_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const isChangeRequest = !!changeReq;
            const nowIso = new Date().toISOString();

            const updateData: any = {
                status: isChangeRequest ? 'approved' : 'completed',
                sticker_released_at: nowIso,
                ...(isChangeRequest ? { sticker_installed_at: nowIso } : {})
            };

            const { error: updateError } = await supabase
                .from('registration')
                .update(updateData)
                .eq('registration_id', registration_id);

            if (updateError) throw updateError;

            // If change request, update the vehicle info and mark change request as completed/approved
            if (isChangeRequest) {
                const proposed = changeReq.proposed_changes || {};
                const currentVehId = reg.vehicle_information_id;
                if (currentVehId && (proposed.vehicle_plate || proposed.plate_number)) {
                    await supabase
                        .from('vehicle_information')
                        .update({
                            plate_number: proposed.vehicle_plate || proposed.plate_number,
                            brand: proposed.vehicle_make || proposed.brand || undefined,
                            type: proposed.vehicle_type || proposed.type || undefined
                        })
                        .eq('vehicle_information_id', currentVehId);
                }

                await supabase
                    .from('modification_request')
                    .update({ status: 'approved', process_at: nowIso })
                    .eq('change_vehicle_request_id', changeReq.change_vehicle_request_id);

                await sendEmail(
                    reg.user.email,
                    'Registration Change Completed — Liceo GateQR',
                    'Your vehicle sticker has been released by OSA and your registration change has been finalized. Your vehicle is now officially registered.',
                    '<h3>Registration Change Completed</h3><p>Your vehicle sticker has been released by OSA and your registration change has been finalized.</p><p>Your updated vehicle is now officially registered with GateQR.</p>'
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
                    'Sticker Released - Liceo GateQR',
                    'Your vehicle sticker has been released by OSA. Please proceed to Safety and Security for sticker installation.',
                    '<p>Your vehicle sticker has been <strong>released by OSA</strong>. Please proceed to Safety and Security for sticker installation.</p>'
                );                if (reg.user?.user_id) {
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
                .from('registration')
                .update({ 
                    schedule: new Date(schedule).toISOString()
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
                .from('registration')
                .update({ 
                    schedule: newSchedule
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
            if (!reason) return json({ error: 'Reason required' }, { status: 400 });
            
            const { error: updateError } = await supabase
                .from('registration')
                .update({ 
                    status: 'revoked', 
                    revoke_at: new Date().toISOString(), 
                    revoke_reason: reason 
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
                .from('registration')
                .update({ 
                    status: 'osa_validated', 
                    security_check_at: null, 
                    revoke_at: null, 
                    rejected_at: null, 
                    rejection_reason: null, 
                    revoke_reason: null
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
            
            const restoredStatus = reg.security_check_at ? 'approved' : 'osa_validated';
            const { error: updateError } = await supabase
                .from('registration')
                .update({ 
                    status: restoredStatus, 
                    revoke_at: null, 
                    revoke_reason: null 
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
            const files = [reg.doc_id, reg.doc_load, reg.doc_or, reg.doc_cr, reg.doc_license, reg.doc_letter, reg.qr_code].filter(Boolean);
            for (const file of files) {
                if (file.startsWith('http://') || file.startsWith('https://')) {
                    await deleteFromStorage(file);
                } else {
                    const filepath = join(process.cwd(), 'static', file);
                    try {
                        if (fs.existsSync(filepath)) {
                            fs.unlinkSync(filepath);
                        }
                    } catch (e) {
                        console.error('Failed to delete file', filepath, e);
                    }
                }
            }
            
            // Pre-emptively clean up related records to prevent foreign key errors
            await supabase.from('modification_request').delete().eq('registration_id', registration_id);
            await supabase.from('vehicle_log').delete().eq('registration_id', registration_id);
            await supabase.from('incident_report').delete().eq('registration_id', registration_id);

            const { error: deleteError } = await supabase
                .from('registration')
                .delete()
                .eq('registration_id', registration_id);

            if (deleteError) throw deleteError;

            await sendEmail(
                reg.user.email,
                'Application Deleted - Liceo GateQR',
                'Your vehicle sticker application has been permanently deleted by OSA.',
                '<p>Your vehicle sticker application has been <strong>permanently deleted</strong> by OSA.</p>'
            );

            // Create notification for the applicant and OSA admin
            const actorId = locals.user?.user_id;
            if (reg.user?.user_id) {
                await createNotification(
                    reg.user.user_id,
                    'application_deleted',
                    'Your vehicle registration application record has been permanently deleted by OSA.',
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
                    `Successfully deleted application record for ${reg.user.email}.`,
                    actorId,
                    'delete_application_success',
                    'registration',
                    registration_id,
                    registration_id
                );
            }
        }
        else {
            return json({ error: 'Invalid action for current status' }, { status: 400 });
        }

        return json({ message: 'Application updated' });
    } catch (error) {
        console.error('Failed to update osa application:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
