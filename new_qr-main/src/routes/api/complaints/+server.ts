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
                .from('complaint')
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
                .from('complaint')
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
        return json({ error: 'Unauthorized. Only users can send complaints.' }, { status: 403 });
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

        const { error: insertError } = await supabase
            .from('complaint')
            .insert({
                user_id: userData.user_id,
                message: message.trim()
            });

        if (insertError) throw insertError;

        // Notify security
        await sendEmail(
            env.SECURITY_EMAIL as string,
            'New Complaint Received',
            `A new complaint has been submitted by ${locals.user.email}.\n\nMessage: ${message.trim()}`,
            `<p>A new complaint has been submitted by <strong>${locals.user.email}</strong>.</p>
             <p><strong>Message:</strong><br/>${message.trim().replace(/\\n/g, '<br>')}</p>
             <p>Please log in to the dashboard to review.</p>`
        );

        return json({ message: 'Complaint submitted successfully' });
    } catch (error) {
        console.error('Error creating complaint:', error);
        return json({ error: 'Failed to submit complaint' }, { status: 500 });
    }
};
