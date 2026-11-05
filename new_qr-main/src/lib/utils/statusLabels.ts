export type StatusTone = 'success' | 'warning' | 'danger' | 'default';

export interface StatusPill {
    label: string;
    tone: StatusTone;
}

/** VPS and concessionnaire applications skip the Security document review: OSA checks the hardcopies and sends them straight to payment. */
export function skipsSecurityReview(role: string | null | undefined): boolean {
    return ['vps', 'concessionnaire'].includes((role || '').toLowerCase().trim());
}

// Roles that go through Department Head approval of the Agreement Form to Park.
// Administrator and VPS (and visitors) are excluded. 'employee' is stored as 'staff';
// concessionaire is stored as 'concessionnaire' in registration_role_enum.
const DEPARTMENT_APPROVAL_ROLES = ['student', 'faculty', 'staff', 'supplier', 'concessionnaire', 'concessionaire', 'employee'];

export function requiresDepartmentApproval(role: string | null | undefined): boolean {
    return DEPARTMENT_APPROVAL_ROLES.includes((role || '').toLowerCase().trim());
}

export const OSA_ACCEPT_BLOCKED_MESSAGE =
    'This application cannot be accepted yet. It needs Department Head approval or a signed Agreement Form to Park.';

/** OSA may accept a pending application only after Department Head approval or an uploaded signed form. */
export function isOsaAcceptBlocked(app: {
    status?: string | null;
    role?: string | null;
    dept_approved_at?: string | null;
    signed_agreement_form?: string | null;
}): boolean {
    return (
        (app.status || '').toLowerCase().trim() === 'pending' &&
        requiresDepartmentApproval(app.role) &&
        !app.dept_approved_at &&
        !app.signed_agreement_form
    );
}

/**
 * Workflow status pills shown on an application card, based on which dashboard tab it is in.
 *
 * OSA  Screening of Applications : PENDING DPT APRVL (+ SIGNED FORM UPLOADED) -> DPT APPROVE
 * OSA  Submission of Hardcopies  : PENDING
 * SEC  Document Review           : OSA CHECKED
 * OSA  Releasing of Stickers     : CHECKED BY SECURITY + PAID  (VPS, concessionnaire: CHECKED + PAID)
 *
 * Returns null when the tab has no workflow-specific label, so the caller falls back to the raw status.
 */
export function getWorkflowStatusPills(tab: string, status: string | null | undefined, role?: string | null, hasSignedAgreement = false): StatusPill[] | null {
    const s = (status || '').toLowerCase().trim();
    const t = (tab || '').toLowerCase().trim();

    if (['rejected', 'revoked', 'expired'].includes(s)) return null;

    if (t === 'validation') {
        if (s === 'pending') {
            const pills: StatusPill[] = [{ label: 'PENDING DPT APRVL', tone: 'warning' }];
            if (hasSignedAgreement) pills.push({ label: 'SIGNED FORM UPLOADED', tone: 'success' });
            return pills;
        }
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
