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
    targetEntityId?: number
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
            is_read: false
        });
    } catch (e) {
        console.error('Failed to create notification:', e);
    }
}

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { registration_id } = await request.json();

        if (!registration_id) {
            return json({ error: 'Registration ID is required' }, { status: 400 });
        }

        // Verify the registration exists
        const { data: reg, error: fetchError } = await supabase
            .from('registration')
            .select('registration_id, user_id, status, security_check_at, users:user_id(email)')
            .eq('registration_id', registration_id)
            .single();

        if (fetchError || !reg) {
            console.error('Registration not found. Fetch error:', fetchError, 'registration_id:', registration_id);
            return json({ error: 'Registration not found' }, { status: 404 });
        }

        // Mark sticker as installed / security check complete and update status to approved
        const { error: updateError } = await supabase
            .from('registration')
            .update({
                sticker_installed_at: new Date().toISOString(),
                security_check_at: reg.security_check_at || new Date().toISOString(),
                status: 'approved'
            })
            .eq('registration_id', registration_id);

        if (updateError) throw updateError;

        // If this application was undergoing a change vehicle request, finalize it
        try {
            const { data: changeReq } = await supabase
                .from('change_vehicle_request')
                .select('*')
                .eq('registration_id', registration_id)
                .in('status', ['approved', 'pending'])
                .order('request_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (changeReq) {
                await supabase
                    .from('change_vehicle_request')
                    .update({ status: 'approved', process_at: new Date().toISOString() })
                    .eq('change_vehicle_request_id', changeReq.change_vehicle_request_id);
            }
        } catch (cvErr) {
            console.error('Error finalizing change vehicle request:', cvErr);
        }

        // Notify the applicant
        if (reg.user_id) {
            const notifMsg = 'Campus Security has successfully installed your vehicle QR code Sticker. Congratulations! You have completed the vehicle registration process and your vehicle is now officially registered.';
            await createNotification(
                reg.user_id,
                'sticker_installed',
                notifMsg,
                locals.user?.user_id,
                'install_sticker',
                'registration',
                registration_id
            );

            // Send email
            const targetEmail = (reg.users as any)?.email;
            if (targetEmail) {
                await sendEmail(
                    targetEmail,
                    'Application Update: QR Code Sticker Installed & Registration Complete',
                    notifMsg
                );
            }
        }

        // Notify the security officer
        if (locals.user?.user_id) {
            await createNotification(
                locals.user.user_id,
                'sticker_installed',
                `Successfully installed QR code Sticker for ${(reg.users as any)?.email || 'applicant'}. Registration finalized.`,
                locals.user.user_id,
                'install_sticker_success',
                'registration',
                registration_id
            );
        }

        return json({ message: 'Sticker marked as installed. Registration completed.' });
    } catch (error) {
        console.error('Sticker install API error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
