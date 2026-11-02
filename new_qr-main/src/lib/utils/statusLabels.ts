export type StatusTone = 'success' | 'warning' | 'danger' | 'default';

export interface StatusPill {
    label: string;
    tone: StatusTone;
}

/** VPS and concessionnaire applications skip the Security document review: OSA checks the hardcopies and sends them straight to payment. */
export function skipsSecurityReview(role: string | null | undefined): boolean {
    return ['vps', 'concessionnaire'].includes((role || '').toLowerCase().trim());
}

/**
 * Workflow status pills shown on an application card, based on which dashboard tab it is in.
 *
 * OSA  Screening of Applications : PENDING DPT APRVL -> DPT APPROVE
 * OSA  Submission of Hardcopies  : PENDING
 * SEC  Document Review           : OSA CHECKED
 * OSA  Releasing of Stickers     : CHECKED BY SECURITY + PAID  (VPS, concessionnaire: CHECKED + PAID)
 *
 * Returns null when the tab has no workflow-specific label, so the caller falls back to the raw status.
 */
export function getWorkflowStatusPills(tab: string, status: string | null | undefined, role?: string | null): StatusPill[] | null {
    const s = (status || '').toLowerCase().trim();
    const t = (tab || '').toLowerCase().trim();

    if (['rejected', 'revoked', 'expired'].includes(s)) return null;

    if (t === 'validation') {
        if (s === 'pending') return [{ label: 'PENDING DPT APRVL', tone: 'warning' }];
        if (['dept_validated', 'dept_val', 'osa_val'].includes(s)) return [{ label: 'DPT APPROVE', tone: 'success' }];
        return null;
    }

    if (t === 'distribution' || t === 'overdue') {
        return [{ label: 'PENDING', tone: 'warning' }];
    }

    if (t === 'document review') {
        return [{ label: 'OSA CHECKED', tone: 'success' }];
    }

    if (t === 'release') {
        return [
            { label: skipsSecurityReview(role) ? 'CHECKED' : 'CHECKED BY SECURITY', tone: 'success' },
            { label: 'PAID', tone: 'success' }
        ];
    }

    return null;
}
