import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        let complaints = [];

        if (locals.user.role === 'security') {
            // Security sees all complaints, with sender details
            const { data: rows } = await supabase
                .from('incident_report')
                .select(`
                    *,
                    user:user_id(
                        email
                    )
                `)
                .order('created_at', { ascending: false });

            // Get additional sender details from registration
            if (rows) {
                complaints = await Promise.all(rows.map(async (complaint) => {
                    const { data: regData } = await supabase
                        .from('registration')
                        .select('first_name, last_name, mobile, role')
                        .eq('user_id', complaint.user_id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    return {
                        ...complaint,
                        sender_email: complaint.user?.email,
                        sender_name: regData ? `${regData.first_name} ${regData.last_name}` : null,
                        sender_phone: regData?.mobile,
                        sender_role: regData?.role
                    };
                }));
            }
        } else {
            // Standard users see only their complaints
            // Get user_id from email
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('user_id')
                .eq('email', locals.user.email)
                .single();

            if (userError || !userData) {
                return json({ error: 'User not found' }, { status: 404 });
            }

            const { data: rows } = await supabase
                .from('incident_report')
                .select('*')
                .eq('user_id', userData.user_id)
                .order('created_at', { ascending: false });

            complaints = rows || [];
        }
        
        return json({ complaints });
    } catch (error) {
        console.error('Error fetching complaints:', error);
        return json({ error: 'Failed to fetch complaints' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role === 'security') {
        return json({ error: 'Unauthorized. Only users can send incident reports.' }, { status: 403 });
    }

    try {
        const { message } = await request.json();

        if (!message || message.trim() === '') {
            return json({ error: 'Message is required' }, { status: 400 });
        }

        // Get user_id from email
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .single();

        if (userError || !userData) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        // Insert incident report and retrieve created record
        const { data: newIncident, error: insertError } = await supabase
            .from('incident_report')
            .insert({
                user_id: userData.user_id,
                message: message.trim()
            })
            .select('*')
            .single();

        if (insertError) throw insertError;

        // Fetch sender name details from registration if available
        let senderName = locals.user.email;
        try {
            const { data: regInfo } = await supabase
                .from('registration')
                .select('first_name, last_name, role')
                .eq('user_id', userData.user_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (regInfo?.first_name) {
                senderName = `${regInfo.first_name} ${regInfo.last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Error fetching registration profile for incident report notification:', e);
        }

        const snippet = message.trim().length > 60
            ? message.trim().slice(0, 57) + '...'
            : message.trim();

        // 1. Notify Security Admins via in-app notification
        let secEmails: string[] = [];
        try {
            const orFilters = ['user_type.eq.safety_security', 'user_type.eq.security'];
            if (env.SECURITY_EMAIL) {
                orFilters.push(`email.eq.${env.SECURITY_EMAIL}`);
            }

            const { data: secUsers } = await supabase
                .from('users')
                .select('user_id, email')
                .or(orFilters.join(','));

            if (secUsers && secUsers.length > 0) {
                secEmails = secUsers.map(u => u.email).filter(Boolean);
                const secNotifications = secUsers.map(u => ({
                    user_id: u.user_id,
                    activity: `New Incident Report from ${senderName}: "${snippet}"`,
                    message: `New Incident Report submitted by ${senderName}: "${snippet}"`,
                    notification_type: 'incident_report',
                    actor_id: userData.user_id,
                    action_type: 'incident_report_submitted',
                    target_entity_type: 'incident_report',
                    target_entity_id: newIncident?.complaint_id,
                    target_id: newIncident?.complaint_id,
                    is_read: false
                }));

                await supabase.from('notification').insert(secNotifications);
            }
        } catch (secNotifErr) {
            console.error('Failed to notify security admin users:', secNotifErr);
        }

        // 2. Notify Complainant (Applicant) via in-app notification
        try {
            await supabase.from('notification').insert({
                user_id: userData.user_id,
                activity: 'Your incident report has been submitted successfully to Safety & Security.',
                message: 'Your incident report has been submitted successfully to Safety & Security.',
                notification_type: 'incident_report',
                actor_id: userData.user_id,
                action_type: 'incident_report_submitted',
                target_entity_type: 'incident_report',
                target_entity_id: newIncident?.complaint_id,
                target_id: newIncident?.complaint_id,
                is_read: false
            });
        } catch (complainantNotifErr) {
            console.error('Failed to notify complainant:', complainantNotifErr);
        }

        // 3. Notify Security via Email
        const targetSecEmail = env.SECURITY_EMAIL || secEmails[0];
        if (targetSecEmail) {
            try {
                await sendEmail(
                    targetSecEmail,
                    'New Incident Report Submitted',
                    `A new incident report has been submitted by ${senderName} (${locals.user.email}).\n\nReport:\n${message.trim()}`,
                    `<p>A new incident report has been submitted by <strong>${senderName}</strong> (${locals.user.email}).</p>
                     <div style="background:#f4f4f5;padding:12px;border-radius:6px;margin:12px 0;">
                       <p style="margin:0;white-space:pre-wrap;">${message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                     </div>
                     <p>Please log in to the Safety & Security portal to review.</p>`
                );
            } catch (emailErr) {
                console.error('Failed to send email to security admin:', emailErr);
            }
        }

        return json({ message: 'Incident report submitted successfully' });
    } catch (error) {
        console.error('Error creating incident report:', error);
        return json({ error: 'Failed to submit incident report' }, { status: 500 });
    }
};
