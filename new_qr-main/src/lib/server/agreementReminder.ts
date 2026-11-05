import { env } from '$env/dynamic/private';
import { AGREEMENT_FORM_URL } from '$lib/documents';
import { requiresDepartmentApproval } from '$lib/utils/statusLabels';
import { supabase } from './supabase';
import { sendEmail } from './email';

const PENDING_LIMIT_MS = 24 * 60 * 60 * 1000;
// The sweep runs on page visits; skip it if one ran recently on this server instance
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const SUBJECT = 'Agreement Form to Park Pending Department Head Approval - Liceo GateQR';

function reminderMessage(): { text: string; html: string } {
    const base = (env.PUBLIC_APP_URL || env.ORIGIN || '').replace(/\/+$/, '');
    const statusUrl = base ? `${base}/status` : '';
    const intro = 'It has been 24 hours and your application is still pending Department Head approval.';
    const followUp = 'You can follow up with your Department Head about your Agreement Form to Park.';

    const text =
        `${intro} ${followUp} You can also print the form (${AGREEMENT_FORM_URL}), have your Department Head sign it, ` +
        `and upload it as a PDF on your application status page${statusUrl ? ` (${statusUrl})` : ''}.`;
    const statusPage = statusUrl
        ? `<a href="${statusUrl}">application status page</a>`
        : '<strong>application status page</strong>';
    const html =
        `<p>${intro}</p><p>${followUp} You can also <a href="${AGREEMENT_FORM_URL}">print the form</a>, ` +
        `have your Department Head sign it, and upload it as a PDF on your ${statusPage}.</p>`;
    return { text, html };
}

export function isAgreementReminderRole(role: string | null | undefined): boolean {
    return requiresDepartmentApproval(role);
}

let lastSweepAt = 0;
let sweepInFlight: Promise<number> | null = null;

/** Run the reminder sweep at most once every few minutes per server instance. */
export function sendAgreementRemindersThrottled(): Promise<number> {
    if (sweepInFlight) return sweepInFlight;
    if (Date.now() - lastSweepAt < SWEEP_INTERVAL_MS) return Promise.resolve(0);
    lastSweepAt = Date.now();
    sweepInFlight = sendAgreementReminders().finally(() => {
        sweepInFlight = null;
    });
    return sweepInFlight;
}

/**
 * Email every applicant whose application has been pending Department Head approval for
 * 24 hours or more. Each application is emailed once: the row is claimed by setting
 * agreement_reminder_sent_at before sending, so concurrent sweeps never double-send.
 * Returns the number of reminders sent.
 */
export async function sendAgreementReminders(): Promise<number> {
    try {
        // updated_at is the submission time for new applications and renewals alike
        // (renewals reuse the row, so created_at would be the original submission)
        const cutoff = new Date(Date.now() - PENDING_LIMIT_MS).toISOString();
        const { data: rows, error } = await supabase
            .from('sticker_application')
            .select('registration_id, role, user:user_id(email)')
            .eq('status', 'pending')
            .is('agreement_reminder_sent_at', null)
            .lte('updated_at', cutoff);

        if (error) throw error;

        const { text, html } = reminderMessage();
        let sent = 0;
        for (const row of rows || []) {
            if (!isAgreementReminderRole(row.role)) continue;
            const email = (row.user as any)?.email;
            if (!email) continue;

            const { data: claimed, error: claimError } = await supabase
                .from('sticker_application')
                .update({ agreement_reminder_sent_at: new Date().toISOString() })
                .eq('registration_id', row.registration_id)
                .eq('status', 'pending')
                .is('agreement_reminder_sent_at', null)
                .select('registration_id');

            if (claimError || !claimed || claimed.length === 0) continue;

            await sendEmail(email, SUBJECT, text, html);
            sent++;
        }

        if (sent > 0) console.log(`[Agreement Reminder] Sent ${sent} pending Department Head approval reminder(s)`);
        return sent;
    } catch (err) {
        console.error('[Agreement Reminder] Sweep failed:', err);
        return 0;
    }
}
