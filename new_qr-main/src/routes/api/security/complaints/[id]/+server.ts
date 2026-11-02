import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized - Security access only' }, { status: 403 });
    }

    try {
        const { id } = params;
        const { schedule, status, resolved_by, send_email } = await request.json();

        // Get the current complaint to check if schedule/status changed
        const { data: complaint, error: queryError } = await supabase
            .from('incident_report')
            .select(`
                *,
                user:user_id(
                    email
                )
            `)
            .eq('incident_report_id', id)
            .single();

        if (queryError || !complaint) {
            return json({ error: 'This incident report could not be found. It may have been deleted. Please refresh the page.' }, { status: 404 });
        }

        // Update fields if provided
        const updateData: Record<string, any> = {};
        if (schedule !== undefined) updateData.scheduled_at = schedule;
        if (status !== undefined) updateData.status = status;
        if (status === 'resolved') {
            updateData.resolved_at = new Date().toISOString();
        }

        if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
                .from('incident_report')
                .update(updateData)
                .eq('incident_report_id', id);

            if (updateError) throw updateError;
        }

        // Send email if schedule or status changed
        if (schedule && schedule !== complaint.scheduled_at && send_email) {
            const formattedDate = new Date(schedule).toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            await sendEmail(
                complaint.user?.email,
                'Complaint Schedule Update',
                `Meeting Scheduled — The security office has scheduled a meeting with you. Please check your complaint details below.`,
                `<p>Meeting Scheduled — The security office has scheduled a meeting with you. Please check your complaint details below.</p>`,
                locals.user.email
            );
        }

        if (status === 'resolved' && complaint.status !== 'resolved') {
            await sendEmail(
                complaint.user?.email,
                'Complaint Resolved',
                `Your complaint has been marked as resolved by the Security office.`,
                `<p>Your complaint has been marked as resolved by the Security office.</p>`
            );
        }

        return json({ message: 'Complaint updated successfully' });
    } catch (error) {
        console.error('Error updating complaint:', error);
        return apiFailure('update the incident report', error);
    }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
    if (!locals.user) {
        return json({ error: 'Your session has expired or you are not signed in. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const { id } = params;

        const { data: complaint, error: queryError } = await supabase
            .from('incident_report')
            .select(`
                *,
                user:user_id(
                    email
                )
            `)
            .eq('incident_report_id', id)
            .single();

        if (queryError || !complaint) {
            return json({ error: 'This incident report could not be found. It may have been deleted. Please refresh the page.' }, { status: 404 });
        }

        // Security can always delete. User can only delete their own complaints.
        if (locals.user.role !== 'security') {
            if (complaint.user?.email !== locals.user.email) {
                return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
            }
        }

        const { error: deleteError } = await supabase
            .from('incident_report')
            .delete()
            .eq('incident_report_id', id);

        if (deleteError) throw deleteError;

        return json({ message: 'Complaint deleted successfully' });
    } catch (error) {
        console.error('Error deleting complaint:', error);
        return apiFailure('delete the incident report', error);
    }
};