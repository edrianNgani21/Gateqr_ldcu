import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
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
        await supabaseAdmin.from('notification').insert({
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

export async function POST({ request, locals }: RequestEvent) {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { request_id, action, schedule, rejection_reason } = await request.json();

        if (!request_id || !action) {
            return json({ error: 'Request ID and action are required' }, { status: 400 });
        }

        // Get the change request details
        const { data: changeRequest, error: queryError } = await supabaseAdmin
            .from('modification_request')
            .select(`
                *,
                registration:registration_id(
                    *,
                    user:user_id(user_id, email),
                    vehicle_information:vehicle_information_id(*)
                )
            `)
            .eq('change_vehicle_request_id', request_id)
            .single();

        if (queryError || !changeRequest) {
            return json({ error: 'Change vehicle request not found' }, { status: 404 });
        }

        const registration = changeRequest.registration;
        const targetUserId = changeRequest.user_id || registration?.user_id;

        // Get actor user_id
        const { data: actorUser } = await supabaseAdmin
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();
        const actorId = actorUser?.user_id || null;

        if (action === 'approve' || action === 'accept') {
            if (!schedule) {
                return json({ error: 'A schedule date and time is required to proceed with hardcopies compliance' }, { status: 400 });
            }

            const scheduleDate = new Date(schedule).toISOString();

            // 1. Update change request status to approved
            const { error: updateReqError } = await supabaseAdmin
                .from('modification_request')
                .update({ 
                    status: 'approved',
                    process_at: new Date().toISOString()
                })
                .eq('change_vehicle_request_id', request_id);

            if (updateReqError) throw updateReqError;

            // 2. Update vehicle information if proposed changes exist
            const proposed = changeRequest.proposed_changes || {};
            const vehicleInfoId = registration?.vehicle_information_id;
            if (vehicleInfoId && (proposed.vehicle_plate || proposed.plate_number)) {
                await supabaseAdmin
                    .from('vehicle_information')
                    .update({
                        brand: proposed.vehicle_make || proposed.brand || 'Unknown',
                        plate_number: proposed.vehicle_plate || proposed.plate_number,
                        color: proposed.vehicle_color || proposed.color || 'Not Specified',
                        type: (proposed.vehicle_type || proposed.type || '2_wheels') as any,
                        "or": proposed.doc_or || proposed.or || 'N/A',
                        cr: proposed.doc_cr || proposed.cr || 'N/A',
                        authorization_letter: proposed.doc_letter || proposed.authorization_letter || ''
                    })
                    .eq('vehicle_information_id', vehicleInfoId);
            }

            // 3. Move registration to osa_validated and set schedule, resetting previous timestamps so it follows the compliance flow for the new vehicle
            const { error: updateRegError } = await supabaseAdmin
                .from('registration')
                .update({ 
                    status: 'osa_validated',
                    schedule: scheduleDate,
                    osa_dist_at: null,
                    security_check_at: null,
                    sticker_released_at: null,
                    receipt: null
                })
                .eq('registration_id', changeRequest.registration_id);

            if (updateRegError) throw updateRegError;

            // 3. Notify user via email
            const applicantEmail = registration?.user?.email;
            const newPlate = proposed.vehicle_plate || proposed.plate_number || 'your new vehicle';
            const newMake = proposed.vehicle_make || proposed.brand || '';
            const schedStr = new Date(schedule).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

            if (applicantEmail) {
                await sendEmail(
                    applicantEmail,
                    'Request to Change Vehicle Accepted — Visit OSA Office for Hardcopy Compliance',
                    `Your request to change vehicle for ${newMake} (${newPlate}) has been accepted. Please visit the OSA office on ${schedStr} to comply with your hard copy requirements for your new vehicle.`,
                    `<h3>Request to Change Vehicle Accepted</h3>
                    <p>Good news! Your request to change vehicle has been accepted by the Office of Student Affairs (OSA).</p>
                    <p>Please visit the OSA office on <strong>${schedStr}</strong> to comply with your hard copy requirements for your new vehicle.</p>
                    <p><strong>New Vehicle:</strong> ${newMake} (${newPlate})</p>
                    <p><strong>Scheduled Visit:</strong> ${schedStr}</p>
                    <p>Please bring the required hard copies (OR, CR, Driver's License, and Authorization Letter if applicable) to proceed with physical verification and sticker release.</p>`
                );
            }

            // 4. Create in-app notification
            if (targetUserId) {
                await createNotification(
                    targetUserId,
                    'registration_change_approved',
                    `Your request to change vehicle has been accepted! Please visit the OSA office on ${schedStr} to comply with your hard copy requirements for your new vehicle.`,
                    actorId,
                    'approve_registration_change',
                    'modification_request',
                    request_id,
                    changeRequest.registration_id,
                    { schedule: scheduleDate }
                );
            }

            return json({ 
                success: true, 
                message: 'Registration change request accepted. Application has moved to Hardcopy Compliance Schedules.' 
            });
        } 
        else if (action === 'reject') {
            const reason = (rejection_reason || 'Request did not meet requirements').trim();

            const { error: updateReqError } = await supabaseAdmin
                .from('modification_request')
                .update({ 
                    status: 'rejected',
                    process_at: new Date().toISOString()
                })
                .eq('change_vehicle_request_id', request_id);

            if (updateReqError) throw updateReqError;

            const applicantEmail = registration?.user?.email;
            if (applicantEmail) {
                await sendEmail(
                    applicantEmail,
                    'Request to Change Registration Details Rejected — Liceo GateQR',
                    `Your request to change registration details has been rejected by OSA. Reason: ${reason}`,
                    `<h3>Request to Change Registration Details Rejected</h3>
                    <p>Your request to change registration details was reviewed and has been rejected by OSA.</p>
                    <p><strong>Reason:</strong> ${reason}</p>
                    <p>Please contact the Office of Student Affairs for inquiries.</p>`
                );
            }

            if (targetUserId) {
                await createNotification(
                    targetUserId,
                    'registration_change_rejected',
                    `Your request to change registration details was rejected by OSA. Reason: ${reason}`,
                    actorId,
                    'reject_registration_change',
                    'modification_request',
                    request_id,
                    changeRequest.registration_id,
                    { reason }
                );
            }

            return json({ success: true, message: 'Registration change request rejected successfully.' });
        } else {
            return json({ error: 'Invalid action specified' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Change vehicle approval error:', error);
        return json({ error: error.message || 'Failed to process change vehicle request' }, { status: 500 });
    }
}