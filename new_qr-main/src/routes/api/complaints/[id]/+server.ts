import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
    if (!locals.user || locals.user.role !== 'security') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { id } = params;
        const { schedule, status, resolved_by } = await request.json();

        // Get the current complaint to check if schedule/status changed
        const { data: complaint, error: queryError } = await supabase
            .from('incident_report')
            .select(`
                *,
                user:user_id(
                    email
                )
            `)
            .eq('complaint_id', id)
            .single();

        if (queryError || !complaint) {
            return json({ error: 'Complaint not found' }, { status: 404 });
        }

        // Update fields if provided
        const updateData: Record<string, any> = {};
        if (schedule !== undefined) updateData.schedule = schedule;
        if (status !== undefined) updateData.status = status;
        if (status === 'resolved') {
            updateData.resolved_at = new Date().toISOString();
            if (resolved_by !== undefined) updateData.resolved_by = resolved_by;
        }

        if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
                .from('incident_report')
                .update(updateData)
                .eq('complaint_id', id);

            if (updateError) throw updateError;
        }

        // Send email if schedule or status changed
        if (schedule && schedule !== complaint.schedule) {
            const formattedDate = new Date(schedule).toLocaleString();
            await sendEmail(
                complaint.user?.email,
                'Complaint Schedule Update',
                `Your complaint has been scheduled for a meeting on ${formattedDate}. Please proceed to the security office.`,
                `<p>Your complaint has been scheduled for a meeting on <strong>${formattedDate}</strong>.</p><p>Please proceed to the security office.</p>`
            );
        }

        if (status === 'resolved' && complaint.status !== 'resolved') {
            await sendEmail(
                complaint.user?.email,
                'Complaint Resolved',
                `Your complaint has been marked as resolved by the security office.`,
                `<p>Your complaint has been marked as resolved by the security office.</p>`
            );
        }

        return json({ message: 'Complaint updated successfully' });
    } catch (error) {
        console.error('Error updating complaint:', error);
        return json({ error: 'Failed to update complaint' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
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
            .eq('complaint_id', id)
            .single();

        if (queryError || !complaint) {
            return json({ error: 'Complaint not found' }, { status: 404 });
        }

        // Security can always delete. User can only delete their own complaints.
        if (locals.user.role !== 'security') {
            if (complaint.user?.email !== locals.user.email) {
                return json({ error: 'Unauthorized' }, { status: 403 });
            }
        }

        const { error: deleteError } = await supabase
            .from('incident_report')
            .delete()
            .eq('complaint_id', id);

        if (deleteError) throw deleteError;

        return json({ message: 'Complaint deleted successfully' });
    } catch (error) {
        console.error('Error deleting complaint:', error);
        return json({ error: 'Failed to delete complaint' }, { status: 500 });
    }
};
