import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

// Change Email: a link sent to the CURRENT email approves the change (no database table needed).
export const EMAIL_CHANGE_PURPOSE = 'email_change';
export const EMAIL_CHANGE_TTL_MINUTES = 30;

export interface EmailChangeRequest {
    uid: number;
    old_email: string;
    new_email: string;
}

/** The request inside a confirmation link, or an error message when it is invalid or expired. */
export function readEmailChangeToken(token: string | null): { request?: EmailChangeRequest; error?: string } {
    if (!token) return { error: 'This confirmation link is incomplete.' };
    try {
        const payload = jwt.verify(token, env.JWT_SECRET as string) as any;
        if (payload?.purpose !== EMAIL_CHANGE_PURPOSE || !payload.uid || !payload.old_email || !payload.new_email) {
            return { error: 'This confirmation link is not valid.' };
        }
        return { request: { uid: payload.uid, old_email: payload.old_email, new_email: payload.new_email } };
    } catch (err: any) {
        if (err?.name === 'TokenExpiredError') {
            return { error: `This confirmation link expired (links last ${EMAIL_CHANGE_TTL_MINUTES} minutes). Request the change again from Settings.` };
        }
        return { error: 'This confirmation link is not valid.' };
    }
}
