import { supabase } from './supabase';
import { sendEmail } from './email';

// Roles that go through Department Head approval of the Agreement Form to Park.
// Administrator and VPS (and visitors) are excluded. 'employee' is stored as 'staff';
// concessionaire is stored as 'concessionnaire' in registration_role_enum.
export const AGREEMENT_REMINDER_ROLES = ['student', 'faculty', 'staff', 'supplier', 'concessionnaire', 'concessionaire', 'employee'];

const PENDING_LIMIT_MS = 24 * 60 * 60 * 1000;
// The sweep runs on page visits; skip it if one ran recently on this server instance
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const SUBJECT = 'Agreement Form to Park Pending Department Head Approval - Liceo GateQR';
const TEXT =
    'Your Agreement Form to Park is still pending approval from your Department Head. ' +
    'We recommend that you print a hard copy of the Agreement Form to Park, have it signed by your Department Head, ' +
    'and upload the signed copy on your application status page.';
const HTML =
    '<p>Your <strong>Agreement Form to Park</strong> is still pending approval from your Department Head.</p>' +
    '<p>We recommend that you print a hard copy of the Agreement Form to Park, have it signed by your Department Head, ' +
    'and upload the signed copy on your <strong>application status page</strong>.</p>';

export function isAgreementReminderRole(role: string | null | undefined): boolean {
    return AGREEMENT_REMINDER_ROLES.includes((role || '').toLowerCase().trim());
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
            .from('registration')
            .select('registration_id, role, user:user_id(email)')
            .eq('status', 'pending')
            .is('agreement_reminder_sent_at', null)
            .lte('updated_at', cutoff);

        if (error) throw error;

        let sent = 0;
        for (const row of rows || []) {
            if (!isAgreementReminderRole(row.role)) continue;
            const email = (row.user as any)?.email;
            if (!email) continue;

            const { data: claimed, error: claimError } = await supabase
                .from('registration')
                .update({ agreement_reminder_sent_at: new Date().toISOString() })
                .eq('registration_id', row.registration_id)
                .eq('status', 'pending')
                .is('agreement_reminder_sent_at', null)
                .select('registration_id');

            if (claimError || !claimed || claimed.length === 0) continue;

            await sendEmail(email, SUBJECT, TEXT, HTML);
            sent++;
        }

        if (sent > 0) console.log(`[Agreement Reminder] Sent ${sent} pending Department Head approval reminder(s)`);
        return sent;
    } catch (err) {
        console.error('[Agreement Reminder] Sweep failed:', err);
        return 0;
    }
}
