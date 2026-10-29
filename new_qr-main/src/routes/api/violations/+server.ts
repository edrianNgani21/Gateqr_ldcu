import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { uploadToStorage } from '$lib/server/storage';
import { sendEmailAsync } from '$lib/server/email';
import { toAppFileUrl } from '$lib/server/files';
import { nextViolationLevel, VIOLATION_LEVEL_LABELS, type ViolationLevel } from '$lib/violations';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
// Only registered vehicles can receive a violation
const REGISTERED_STATUSES = ['approved', 'completed'];

function canRecord(role: string | undefined): boolean {
    return role === 'osa' || role === 'security';
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function formatManila(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

async function getViolations(registrationId: number) {
    const { data, error } = await supabase
        .from('blocklist')
        .select('blocklist_id, violation_level, reason, evidence_image, block_by, recorded_at, blocked_until')
        .eq('registration_id', registrationId)
        .order('recorded_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

// History and the level the next violation will be recorded at
export const GET: RequestHandler = async ({ url, locals }) => {
    if (!locals.user || !canRecord(locals.user.role)) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }
    const registrationId = Number(url.searchParams.get('registration_id'));
    if (!Number.isInteger(registrationId) || registrationId <= 0) {
        return json({ error: 'registration_id is required' }, { status: 400 });
    }
    try {
        const history = await getViolations(registrationId);
        return json({ history, next_level: nextViolationLevel(history.length) });
    } catch (error) {
        console.error('Failed to load violations:', error);
        return json({ error: 'Failed to load violation history' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || !canRecord(locals.user.role)) {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const form = await request.formData();
        const registrationId = Number(form.get('registration_id'));
        const reason = String(form.get('reason') || '').trim();
        const blockedUntilRaw = String(form.get('blocked_until') || '').trim();
        const evidence = form.get('evidence');

        if (!Number.isInteger(registrationId) || registrationId <= 0) {
            return json({ error: 'registration_id is required' }, { status: 400 });
        }
        if (!reason) {
            return json({ error: 'Please enter the violation reason.' }, { status: 400 });
        }

        const { data: reg } = await supabase
            .from('registration')
            .select('registration_id, vehicle_information_id, status, first_name, last_name, user:user_id(email, user_id), vehicle_information:vehicle_information_id(plate_number)')
            .eq('registration_id', registrationId)
            .maybeSingle();

        if (!reg) {
            return json({ error: 'Registration not found' }, { status: 404 });
        }
        if (!REGISTERED_STATUSES.includes((reg.status || '').toLowerCase())) {
            return json({ error: 'Violations can only be recorded for registered vehicles.' }, { status: 400 });
        }

        // Level is decided on the server from the existing count, never by the client
        const history = await getViolations(registrationId);
        const level: ViolationLevel = nextViolationLevel(history.length);

        let blockedUntil: string | null = null;
        if (level === 'gate_block') {
            const parsed = blockedUntilRaw ? new Date(blockedUntilRaw) : null;
            if (!parsed || isNaN(parsed.getTime())) {
                return json({ error: 'Please set the date and time the gate block ends.', next_level: level }, { status: 400 });
            }
            if (parsed.getTime() <= Date.now()) {
                return json({ error: 'The block end date and time must be in the future.', next_level: level }, { status: 400 });
            }
            blockedUntil = parsed.toISOString();
        }

        let evidenceUrl: string | null = null;
        if (evidence instanceof File && evidence.size > 0) {
            if (!evidence.type.startsWith('image/')) {
                return json({ error: 'The evidence must be an image file.' }, { status: 400 });
            }
            if (evidence.size > MAX_IMAGE_SIZE) {
                return json({ error: 'The image must be 10MB or smaller.' }, { status: 400 });
            }
            const ext = (evidence.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const path = `violations/violation-${registrationId}-${Date.now()}.${ext}`;
            evidenceUrl = await uploadToStorage(path, Buffer.from(await evidence.arrayBuffer()), evidence.type);
        }

        const blockBy = locals.user.role === 'osa' ? 'osa_admin' : 'security_admin';
        const { data: inserted, error: insertError } = await supabase
            .from('blocklist')
            .insert({
                registration_id: registrationId,
                vehicle_id: reg.vehicle_information_id,
                violation_level: level,
                reason,
                evidence_image: evidenceUrl,
                block_by: blockBy,
                blocked_until: blockedUntil
            })
            .select('blocklist_id, violation_level, reason, evidence_image, block_by, recorded_at, blocked_until')
            .single();

        if (insertError) throw insertError;

        // Notify the applicant by email and in-app notification
        const applicant = reg.user as any;
        const plate = (reg.vehicle_information as any)?.plate_number || 'your vehicle';
        const recordedBy = blockBy === 'osa_admin' ? 'the Office of Student Affairs' : 'Safety and Security';
        const recordedAt = formatManila(inserted.recorded_at);
        const levelLabel = VIOLATION_LEVEL_LABELS[level];

        let subject: string;
        let text: string;
        let html: string;
        const detailsHtml = `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;font-size:14px;">
              <tr><td style="padding:6px 0;color:#64748B;width:140px;">Violation</td><td style="padding:6px 0;font-weight:700;color:#6B1D2F;">${levelLabel}</td></tr>
              <tr><td style="padding:6px 0;color:#64748B;">Vehicle</td><td style="padding:6px 0;font-weight:700;color:#6B1D2F;">${escapeHtml(plate)}</td></tr>
              <tr><td style="padding:6px 0;color:#64748B;">Reason</td><td style="padding:6px 0;color:#334155;">${escapeHtml(reason)}</td></tr>
              <tr><td style="padding:6px 0;color:#64748B;">Recorded</td><td style="padding:6px 0;color:#334155;">${recordedAt} by ${recordedBy}</td></tr>
              ${level === 'gate_block' && blockedUntil ? `<tr><td style="padding:6px 0;color:#64748B;">Blocked until</td><td style="padding:6px 0;font-weight:700;color:#DC2626;">${formatManila(blockedUntil)}</td></tr>` : ''}
            </table>
            ${evidenceUrl ? `<p style="margin:0 0 12px;"><a href="${escapeHtml(toAppFileUrl(evidenceUrl) as string)}" style="color:#6B1D2F;font-weight:700;">View photo evidence</a> (log in to GateQR to open)</p>` : ''}`;

        if (level === 'gate_block') {
            subject = 'Gate Access Blocked - Liceo GateQR';
            text = `Your vehicle (${plate}) has reached the final violation level and is BLOCKED from entering all Liceo campus gates until ${formatManila(blockedUntil as string)}. Reason: ${reason}. Recorded ${recordedAt} by ${recordedBy}.`;
            html = `<p style="margin:0 0 12px;">Your vehicle has reached the <strong>final violation level</strong> and is <strong>blocked from entering all Liceo campus gates</strong> (Main, RNP and Paseo) until the date below.</p>${detailsHtml}<p style="margin:0;">For questions or to appeal, please visit the Office of Student Affairs.</p>`;
        } else {
            const ordinal = level === 'first_warning' ? '1st' : '2nd';
            subject = `Violation Notice: ${ordinal} Warning - Liceo GateQR`;
            text = `A ${ordinal} warning was recorded for your vehicle (${plate}). Reason: ${reason}. Recorded ${recordedAt} by ${recordedBy}. Reaching the 3rd violation will block your vehicle from entering all Liceo campus gates.`;
            html = `<p style="margin:0 0 12px;">A <strong>${ordinal} warning</strong> has been recorded for your registered vehicle.</p>${detailsHtml}<div style="background-color:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px 14px;color:#991B1B;font-size:14px;"><strong>Important:</strong> reaching the <strong>3rd violation</strong> will block your vehicle from entering all Liceo campus gates.</div>`;
        }

        if (applicant?.email) {
            sendEmailAsync(applicant.email, subject, text, html);
        }
        if (applicant?.user_id) {
            await supabase.from('notification').insert({
                user_id: applicant.user_id,
                activity: text,
                message: text,
                notification_type: level === 'gate_block' ? 'gate_blocked' : 'violation_warning',
                actor_id: locals.user.user_id || null,
                action_type: 'record_violation',
                target_entity_type: 'registration',
                target_entity_id: registrationId,
                reference_id: inserted.blocklist_id,
                metadata: { violation_level: level, blocked_until: blockedUntil },
                is_read: false
            });
        }

        return json({ success: true, violation: inserted, next_level: nextViolationLevel(history.length + 1) });
    } catch (error) {
        console.error('Failed to record violation:', error);
        return json({ error: 'Failed to record violation' }, { status: 500 });
    }
};
