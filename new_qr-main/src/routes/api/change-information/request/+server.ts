import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

export async function POST({ request, locals }: RequestEvent) {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { message } = await request.json();

        // Check if user has a registration
        const { data: userData, error: userError } = await supabaseAdmin
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (userError || !userData) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        // Get the user's current registration
        const { data: registrations, error: regError } = await supabaseAdmin
            .from('registration')
            .select('*')
            .eq('user_id', userData.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (regError || !registrations) {
            return json({ error: 'No registration found' }, { status: 400 });
        }

        const registration = registrations;

        // For now, we'll send an email to OSA as the change information request
        // This avoids the need for a new table and ensures the request is received
        const userEmail = locals.user.email;
        const userName = `${registration.first_name || ''} ${registration.last_name || ''}`.trim() || 'Applicant';
        const regId = registration.registration_id;

        // Send email to OSA about the change information request
        await sendEmail(
            'osa@liceo.edu.ph',
            'Change Information Request - ' + userName,
            'User ' + userEmail + ' (' + userName + ') has requested to change their registration information.\n\nReason: ' + (message || 'No specific reason provided') + '\n\nRegistration ID: ' + regId,
            '<h3>Change Information Request</h3><p><strong>User:</strong> ' + userEmail + ' (' + userName + ')</p><p><strong>Registration ID:</strong> ' + regId + '</p><p><strong>Reason:</strong> ' + (message || 'No specific reason provided') + '</p><p>Please review this request and contact the user directly to process the changes.</p>'
        );

        // Also send confirmation to the user
        await sendEmail(
            userEmail,
            'Change Information Request Submitted - Liceo GateQR',
            'Your request to change your registration information has been submitted to OSA. They will contact you shortly to process your request.\n\nYour message: ' + (message || 'No specific reason provided'),
            '<h3>Change Information Request Submitted</h3><p>Your request to change your registration information has been submitted to OSA.</p><p>They will contact you shortly to process your request.</p><p><strong>Your message:</strong> ' + (message || 'No specific reason provided') + '</p>'
        );

        return json({ message: 'Change information request submitted successfully. OSA will contact you shortly.' });
    } catch (error) {
        console.error('Change information request error:', error);
        return json({ error: 'Failed to submit change information request' }, { status: 500 });
    }
};