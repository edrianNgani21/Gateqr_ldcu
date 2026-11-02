import { apiFailure } from '$lib/server/apiError';
import { acceptUploadedFile, UploadRejected } from '$lib/server/directUpload';
import { PDF_TYPES, reasonLengthError } from '$lib/limits';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
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
        await supabaseAdmin.from('notification').insert({
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

export async function POST({ request, locals }: RequestEvent) {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const contentType = request.headers.get('content-type') || '';
        let reason = '';
        let vehicle_make = '';
        let vehicle_plate = '';
        let vehicle_color = '';
        let vehicle_type = '4-wheeler';
        let is_owner = true;
        let registration_id: number | null = null;
        let doc_or: string | null = null;
        let doc_cr: string | null = null;
        let doc_license: string | null = null;
        let doc_letter: string | null = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            reason = (formData.get('reason') as string || '').trim();
            vehicle_make = (formData.get('vehicle_make') as string || '').trim();
            vehicle_plate = (formData.get('vehicle_plate') as string || '').trim();
            vehicle_color = (formData.get('vehicle_color') as string || '').trim();
            vehicle_type = (formData.get('vehicle_type') as string || '4-wheeler').trim();
            is_owner = formData.get('is_owner') === 'yes' || formData.get('is_owner') === 'true';
            
            const regIdParam = formData.get('registration_id');
            if (regIdParam) registration_id = parseInt(regIdParam as string, 10);

            // Documents were uploaded straight to storage by the browser; confirm each one before saving it
            const saveFile = async (key: string, label: string) => {
                const path = formData.get(key);
                if (typeof path !== 'string' || !path) return null;
                return await acceptUploadedFile(path, locals.user!.user_id as number, label, PDF_TYPES);
            };

            doc_or = await saveFile('doc_or', 'Vehicle OR');
            doc_cr = await saveFile('doc_cr', 'Vehicle CR');
            doc_license = await saveFile('doc_license', "Driver's License");
            doc_letter = await saveFile('doc_letter', 'Signed Letter');
        } else {
            const body = await request.json();
            reason = (body.reason || '').trim();
            vehicle_make = (body.vehicle_make || '').trim();
            vehicle_plate = (body.vehicle_plate || '').trim();
            vehicle_color = (body.vehicle_color || '').trim();
            vehicle_type = body.vehicle_type || '4-wheeler';
            is_owner = body.is_owner === true || body.is_owner === 'yes';
            registration_id = body.registration_id ? parseInt(body.registration_id, 10) : null;
        }

        if (!reason) {
            return json({ error: 'Please provide a reason for changing vehicle information.' }, { status: 400 });
        }
        const reasonError = reasonLengthError(reason);
        if (reasonError) return json({ error: reasonError }, { status: 400 });
        if (!vehicle_make || !vehicle_plate) {
            return json({ error: 'New vehicle make/brand and plate number are required.' }, { status: 400 });
        }

        // Get user_id from users table
        const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('user_id, email')
            .eq('email', locals.user.email)
            .single();

        if (userError || !userData) {
            return json({ error: 'Your account record could not be found. Please sign out, sign in again, and retry.' }, { status: 404 });
        }

        // Get registration
        let regQuery = supabaseAdmin
            .from('sticker_application')
            .select('*, vehicle:vehicle_id(*)').neq('status', 'deleted')
            .eq('user_id', userData.user_id);

        if (registration_id) {
            regQuery = regQuery.eq('registration_id', registration_id);
        } else {
            regQuery = regQuery.order('created_at', { ascending: false }).limit(1);
        }

        const { data: regList, error: regError } = await regQuery;
        if (regError || !regList || regList.length === 0) {
            return json({ error: 'No existing registration found for this user.' }, { status: 404 });
        }

        const registration = regList[0];

        // Check if there is already a pending change request
        const { data: existingRequests, error: checkError } = await supabaseAdmin
            .from('profile_update_request')
            .select('*')
            .eq('registration_id', registration.registration_id)
            .eq('status', 'pending');

        if (checkError) throw checkError;

        if (existingRequests && existingRequests.length > 0) {
            return json({ error: 'You already have a pending change vehicle request for this registration.' }, { status: 400 });
        }

        // Find OSA admin user_id
        const { data: osaAdmin } = await supabaseAdmin
            .from('users')
            .select('user_id')
            .eq('account_role', 'osa')
            .limit(1)
            .maybeSingle();

        const recipientId = osaAdmin?.user_id || 1;

        // 2. Insert into change_vehicle_request
        const insertPayload: any = {
            user_id: userData.user_id,
            registration_id: registration.registration_id,
            assigned_to_user_id: recipientId,
            reason: reason,
            status: 'pending',
            proposed_changes: {
                vehicle_make,
                vehicle_plate,
                vehicle_color: vehicle_color || 'Not Specified',
                vehicle_type,
                doc_or: doc_or || null,
                doc_cr: doc_cr || null,
                doc_license: doc_license || null,
                doc_letter: doc_letter || null
            }
        };

        const { data: insertedRequest, error: insertError } = await supabaseAdmin
            .from('profile_update_request')
            .insert([insertPayload])
            .select()
            .single();

        if (insertError) {
            throw insertError;
        }

        // 3. Notify OSA Admin via email in background
        const applicantName = `${registration.first_name || ''} ${registration.last_name || ''}`.trim() || locals.user.email;
        sendEmailAsync(
            'osa@liceo.edu.ph',
            'New Request to Change Registration Details - Liceo GateQR',
            `Applicant ${applicantName} has submitted a request to change their registration details.\n\nReason: ${reason}\nNew Vehicle: ${vehicle_make} (${vehicle_plate})`,
            `<h3>New Request to Change Registration Details</h3>
            <p><strong>Applicant:</strong> ${applicantName} (${locals.user.email})</p>
            <p><strong>Reason for Change:</strong> ${reason}</p>
            <p><strong>New Vehicle:</strong> ${vehicle_make} - ${vehicle_plate} (${vehicle_color})</p>
            <p>Please log in to the OSA Admin dashboard under <em>Request to Change Registration Details</em> to review the details and schedule hardcopy compliance.</p>`
        );

        // Notify user via in-app notification
        await createNotification(
            userData.user_id,
            'registration_change_requested',
            'Your request to change registration details has been submitted to OSA for review.',
            userData.user_id,
            'request_registration_change',
            'profile_update_request',
            insertedRequest?.profile_update_request_id,
            registration.registration_id,
            { reason, vehicle_make, vehicle_plate }
        );

        return json({
            message: 'Your request to change registration details has been submitted successfully.',
            request: insertedRequest
        });
    } catch (error: any) {
        console.error('Change vehicle request error:', error);
        if (error instanceof UploadRejected) return json({ error: error.message }, { status: 400 });
        return apiFailure('submit your vehicle change request', error);
    }
}