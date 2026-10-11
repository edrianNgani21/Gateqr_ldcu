import { json } from '@sveltejs/kit';
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
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { registration_ids, action, schedule, reason } = await request.json();

        if (!registration_ids || !Array.isArray(registration_ids) || registration_ids.length === 0) {
            return json({ error: 'Invalid registration IDs' }, { status: 400 });
        }

        if (!action || !['accept', 'reject'].includes(action)) {
            return json({ error: 'Invalid action' }, { status: 400 });
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
                    .from('registration')
                    .select('user_id, role, created_at, qr_code, qr_unique_code')
                    .eq('registration_id', registration_id)
                    .single();

                if (action === 'accept') {
                    // Bulk accept with schedule
                    const updateData: any = {
                        status: 'osa_validated',
                        schedule: schedule || null,
                        osa_val_at: new Date().toISOString()
                    };

                    if (!reg?.qr_code) {
                        const uniqueCode = reg?.qr_unique_code || generateUniqueCode(8);
                        const filename = `qr-codes/qr-${registration_id}-${Date.now()}.png`;
                        const qrBuffer = await generateStyledQRBuffer(uniqueCode, reg?.role || 'student');
                        const qrUrl = await uploadToStorage(filename, qrBuffer, 'image/png');
                        updateData.qr_code = qrUrl;
                        updateData.qr_unique_code = uniqueCode;

                        const expiryMonths = parseInt(process.env.QR_EXPIRY_MONTHS || '6', 10);
                        updateData.expires_at = new Date(new Date(reg?.created_at || Date.now()).getTime() + expiryMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
                    }

                    const { error } = await supabase
                        .from('registration')
                        .update(updateData)
                        .eq('registration_id', registration_id);

                    if (error) throw error;
                    results.success++;

                    if (reg?.user_id) {
                        const notifMsg = `Your vehicle registration application has been accepted by OSA!${schedule ? ' Scheduled visit: ' + new Date(schedule).toLocaleString() : ''}`;
                        await supabase.from('notification').insert({
                            user_id: reg.user_id,
                            activity: notifMsg,
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
                        rejection_reason: reason || 'Bulk rejection',
                        rejected_at: new Date().toISOString()
                    };

                    const { error } = await supabase
                        .from('registration')
                        .update(updateData)
                        .eq('registration_id', registration_id);

                    if (error) throw error;
                    results.success++;

                    if (reg?.user_id) {
                        const notifMsg = `Your vehicle registration application was rejected by OSA. Reason: ${reason || 'Bulk rejection'}`;
                        await supabase.from('notification').insert({
                            user_id: reg.user_id,
                            activity: notifMsg,
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
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};