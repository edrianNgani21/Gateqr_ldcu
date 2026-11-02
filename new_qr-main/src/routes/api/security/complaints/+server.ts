import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        let query = supabase
            .from('incident_report')
            .select(`
                *,
                user:user_id(
                    email
                )
            `)
            .order('created_at', { ascending: false });

        // Security users see all complaints, regular users see only their own
        if (locals.user.role !== 'security') {
            // Get user_id from email for regular users
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('user_id')
                .eq('email', locals.user.email)
                .single();

            if (userError || !userData) {
                return json({ error: 'Your account record could not be found. Please sign out, sign in again, and retry.' }, { status: 404 });
            }

            query = query.eq('user_id', userData.user_id);
        }

        const { data, error } = await query.limit(100);

        if (error) throw error;

        // Map user_email for frontend compatibility
        const complaints = data?.map(c => ({
            ...c,
            user_email: c.user?.email
        })) || [];

        return json({ complaints });
    } catch (error) {
        console.error('Error fetching complaints:', error);
        return apiFailure('load the incident reports', error);
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const { message } = await request.json();

        if (!message || message.trim() === '') {
            return json({ error: 'Please enter a message before submitting.' }, { status: 400 });
        }

        // Get user_id from email
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (userError || !userData) {
            return json({ error: 'Your account record could not be found. Please sign out, sign in again, and retry.' }, { status: 404 });
        }

        const { data: newComplaint, error: insertError } = await supabase
            .from('incident_report')
            .insert([{
                user_id: userData.user_id,
                message: message.trim()
            }])
            .select('incident_report_id')
            .single();

        if (insertError) throw insertError;

        // Notify complainant (applicant)
        try {
            await supabase.from('notification').insert({
                recipient_user_id: userData.user_id,
                title: 'Your complaint has been submitted successfully to Safety & Security.',
                notification_type: 'complaint_submitted',
                message: 'Your complaint has been submitted successfully to Safety & Security.',
                actor_id: userData.user_id,
                action_type: 'create_complaint',
                target_entity_type: 'incident_report',
                target_entity_id: newComplaint?.incident_report_id,
                is_read: false
            });
        } catch (notifErr) {
            console.error('Failed to notify complainant:', notifErr);
        }

        // Notify Security staff
        let secEmails: string[] = [];
        try {
            const orFilters = ['account_role.eq.safety_security', 'account_role.eq.security'];
            if (env.SECURITY_EMAIL) {
                orFilters.push(`email.eq.${env.SECURITY_EMAIL}`);
            }

            const { data: secUsers } = await supabase
                .from('users')
                .select('user_id, email')
                .or(orFilters.join(','));

            if (secUsers && secUsers.length > 0) {
                secEmails = secUsers.map(u => u.email).filter(Boolean);
                const complaintSnippet = message.trim().slice(0, 70) + (message.trim().length > 70 ? '...' : '');
                const secNotifs = secUsers.map(u => ({
                    recipient_user_id: u.user_id,
                    title: `New Incident Report received from ${locals.user?.email || 'applicant'}: "${complaintSnippet}"`,
                    notification_type: 'incident_report',
                    message: `New Incident Report received from ${locals.user?.email || 'applicant'}: "${complaintSnippet}"`,
                    actor_id: userData.user_id,
                    action_type: 'incident_report_submitted',
                    target_entity_type: 'incident_report',
                    target_entity_id: newComplaint?.incident_report_id,
                    target_id: newComplaint?.incident_report_id,
                    is_read: false
                }));
                await supabase.from('notification').insert(secNotifs);
            }
        } catch (secNotifErr) {
            console.error('Failed to notify security staff:', secNotifErr);
        }

        // Notify Security via email
        const targetSecEmail = env.SECURITY_EMAIL || secEmails[0];
        if (targetSecEmail) {
            await sendEmail(
                targetSecEmail,
                'New Incident Report Received',
                `A new incident report has been submitted by ${locals.user.email}.\n\nMessage: ${message.trim()}`,
                `<p>A new incident report has been submitted by <strong>${locals.user.email}</strong>.</p>
                 <p><strong>Message:</strong><br/>${message.trim().replace(/\n/g, '<br>')}</p>
                 <p>Please log in to the security dashboard to review.</p>`
            );
        }

        return json({ message: 'Incident report submitted successfully' });
    } catch (error) {
        console.error('Error creating complaint:', error);
        return apiFailure('submit the incident report', error);
    }
};