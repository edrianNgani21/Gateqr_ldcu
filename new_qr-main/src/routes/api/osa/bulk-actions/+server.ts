import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import { reasonLengthError } from '$lib/limits';
import { isOsaAcceptBlocked, OSA_ACCEPT_BLOCKED_MESSAGE } from '$lib/utils/statusLabels';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { generateStyledQRBuffer } from '$lib/server/qr';
import { uploadToStorage } from '$lib/server/storage';

function generateUniqueCode(length: number = 8): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const { registration_ids, action, schedule, reason, school_year, expires_at } = await request.json();
        const reasonError = reasonLengthError(reason);
        if (reasonError) return json({ error: reasonError }, { status: 400 });


        if (!registration_ids || !Array.isArray(registration_ids) || registration_ids.length === 0) {
            return json({ error: 'No valid applications were selected. Please select them again and retry.' }, { status: 400 });
        }

        if (!action || !['accept', 'reject'].includes(action)) {
            return json({ error: 'This action is not recognized. Please refresh the page and try again.' }, { status: 400 });
        }

        const results = {
            success: 0,
            failed: 0,
            errors: [] as string[]
        };

        for (const registration_id of registration_ids) {
            try {
                // Fetch registration details for QR and notification
                const { data: reg } = await supabase
                    .from('sticker_application')
                    .select('user_id, role, status, dept_approved_at, signed_agreement_form, created_at, qr_image, qr_code').neq('status', 'deleted')
                    .eq('registration_id', registration_id)
                    .single();

                if (action === 'accept') {
                    if (reg && isOsaAcceptBlocked(reg)) throw new Error(OSA_ACCEPT_BLOCKED_MESSAGE);

                    // Bulk accept with schedule
                    const updateData: any = {
                        status: 'osa_validated',
                        hardcopy_due_at: schedule || null,
                        osa_approved_at: new Date().toISOString()
                    };

                    if (school_year) {
                        updateData.school_year = school_year;
                    }

                    if (expires_at) {
                        updateData.expires_at = new Date(expires_at).toISOString();
                    }

                    // /api/apply stores 'PENDING' until the application is scheduled
                    if (!reg?.qr_image || reg.qr_image === 'PENDING') {
                        let uniqueCode = reg?.qr_code;
                        if (uniqueCode === 'PENDING') uniqueCode = null;
                        if (!uniqueCode) {
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
                        }
                        const filename = `qr-codes/qr-${registration_id}-${Date.now()}.png`;
                        const qrBuffer = await generateStyledQRBuffer(uniqueCode as string, reg?.role || 'student', registration_id);
                        const qrUrl = await uploadToStorage(filename, qrBuffer, 'image/png');
                        updateData.qr_image = qrUrl;
                        updateData.qr_code = uniqueCode;

                        if (!expires_at) {
                            const expiryMonths = parseInt(process.env.QR_EXPIRY_MONTHS || '6', 10);
                            updateData.expires_at = new Date(new Date(reg?.created_at || Date.now()).getTime() + expiryMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
                        }
                    }

                    const { error } = await supabase
                        .from('sticker_application')
                        .update(updateData)
                        .eq('registration_id', registration_id);

                    if (error) throw error;
                    results.success++;

                    if (reg?.user_id) {
                        const notifMsg = `Your vehicle registration application has been accepted by OSA!${schedule ? ' Scheduled visit: ' + new Date(schedule).toLocaleString() : ''}`;
                        await supabase.from('notification').insert({
                            recipient_user_id: reg.user_id,
                            title: notifMsg,
                            notification_type: 'application_approved',
                            message: notifMsg,
                            actor_id: locals.user.user_id,
                            action_type: 'approve_application',
                            target_entity_type: 'registration',
                            target_entity_id: registration_id,
                            reference_id: registration_id,
                            is_read: false
                        });
                    }

                } else if (action === 'reject') {
                    // Bulk reject with reason
                    const updateData: any = {
                        status: 'rejected',
                        rejected_reason: reason || 'Bulk rejection',
                        rejected_at: new Date().toISOString()
                    };

                    const { error } = await supabase
                        .from('sticker_application')
                        .update(updateData)
                        .eq('registration_id', registration_id);

                    if (error) throw error;
                    results.success++;

                    if (reg?.user_id) {
                        const notifMsg = `Your vehicle registration application was rejected by OSA. Reason: ${reason || 'Bulk rejection'}`;
                        await supabase.from('notification').insert({
                            recipient_user_id: reg.user_id,
                            title: notifMsg,
                            notification_type: 'application_rejected',
                            message: notifMsg,
                            actor_id: locals.user.user_id,
                            action_type: 'reject_application',
                            target_entity_type: 'registration',
                            target_entity_id: registration_id,
                            reference_id: registration_id,
                            is_read: false
                        });
                    }
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`Registration ID ${registration_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        return json({
            message: `Bulk ${action} completed`,
            results
        });

    } catch (error) {
        console.error('Bulk action error:', error);
        return apiFailure('process the bulk action', error);
    }
};