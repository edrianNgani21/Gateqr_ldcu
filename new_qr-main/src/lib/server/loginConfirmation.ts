import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabase } from './supabase';
import { sendEmailAsync } from './email';

// Admin password logins on an unrecognised browser must be confirmed from the admin's email
// ("Yes, this is me" / "This is not me") before a session is created.

export const CONFIRM_TTL_MS = 10 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
const TRUSTED_DAYS = 30;
export const PENDING_COOKIE = 'gateqr_pending_login';
const TRUSTED_COOKIE = 'gateqr_trusted_device';

const isProd = process.env.NODE_ENV === 'production';

export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}

export interface SessionInfo {
    user_id: number;
    email: string;
    role: string;
    user_type: string;
    department_id: number | null;
}

export function issueSession(cookies: Cookies, info: SessionInfo) {
    const token = jwt.sign(
        {
            email: info.email,
            role: info.role,
            user_type: info.user_type,
            department_id: info.department_id || null,
            user_id: info.user_id
        },
        env.JWT_SECRET as string,
        { expiresIn: '7d' }
    );
    cookies.set('gateqr_session', token, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
    });
}

/** True when this browser confirmed a login for this user within the last 30 days. */
export function isTrustedDevice(cookies: Cookies, userId: number): boolean {
    const raw = cookies.get(TRUSTED_COOKIE);
    if (!raw) return false;
    try {
        const payload = jwt.verify(raw, env.JWT_SECRET as string) as { purpose?: string; uid?: number };
        return payload.purpose === 'trusted_device' && payload.uid === userId;
    } catch {
        return false;
    }
}

export function trustDevice(cookies: Cookies, userId: number) {
    const token = jwt.sign({ purpose: 'trusted_device', uid: userId }, env.JWT_SECRET as string, { expiresIn: `${TRUSTED_DAYS}d` });
    cookies.set(TRUSTED_COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * TRUSTED_DAYS
    });
}

function describeDevice(userAgent: string | null): string {
    const ua = userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a web browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iPhone / iPad' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown device';
    return `${browser} on ${os}`;
}

export function formatManila(iso: string | Date): string {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

/**
 * Create a pending confirmation, remember it in this browser (httpOnly cookie) and email the
 * admin the "Yes, this is me" / "This is not me" buttons.
 */
export async function startLoginConfirmation(opts: {
    cookies: Cookies;
    origin: string;
    user: { user_id: number; email: string };
    role: string;
    redirectUrl: string;
    ip: string | null;
    userAgent: string | null;
}): Promise<{ expiresAt: string }> {
    const emailToken = newToken();
    const browserToken = newToken();
    const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();

    const { error } = await supabase.from('login_confirmation').insert({
        user_id: opts.user.user_id,
        email_token_hash: hashToken(emailToken),
        browser_token_hash: hashToken(browserToken),
        session_role: opts.role,
        redirect_url: opts.redirectUrl,
        ip_address: opts.ip,
        user_agent: opts.userAgent?.slice(0, 400) ?? null,
        expires_at: expiresAt
    });
    if (error) throw error;

    opts.cookies.set(PENDING_COOKIE, browserToken, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: Math.floor(CONFIRM_TTL_MS / 1000)
    });

    const base = (env.PUBLIC_APP_URL || opts.origin).replace(/\/+$/, '');
    const yesUrl = `${base}/auth/confirm-login?token=${emailToken}&choice=yes`;
    const noUrl = `${base}/auth/confirm-login?token=${emailToken}&choice=no`;
    const when = formatManila(new Date());
    const device = describeDevice(opts.userAgent);

    const subject = 'Confirm your GateQR sign-in';
    const text = `Someone just entered the correct password for your GateQR admin account (${opts.user.email}).\n\nWhen: ${when}\nDevice: ${device}${opts.ip ? `\nIP address: ${opts.ip}` : ''}\n\nIf this was you, confirm here (link expires in 10 minutes): ${yesUrl}\n\nIf this was NOT you, block it here: ${noUrl}\nThe account will be locked for 15 minutes and OSA will be alerted. Please change your password.`;
    const html = `
      <p style="margin:0 0 12px;">Someone just entered the correct password for your GateQR admin account. To finish signing in, please confirm it was you.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748B;width:120px;">Account</td><td style="padding:6px 0;font-weight:700;color:#6B1D2F;">${opts.user.email}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">When</td><td style="padding:6px 0;color:#334155;">${when}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Device</td><td style="padding:6px 0;color:#334155;">${device}</td></tr>
        ${opts.ip ? `<tr><td style="padding:6px 0;color:#64748B;">IP address</td><td style="padding:6px 0;color:#334155;">${opts.ip}</td></tr>` : ''}
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 14px;">
        <tr>
          <td style="padding:0 6px 8px 0;width:50%;">
            <a href="${yesUrl}" style="display:block;text-align:center;background-color:#16A34A;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:13px 10px;border-radius:10px;">Yes, this is me</a>
          </td>
          <td style="padding:0 0 8px 6px;width:50%;">
            <a href="${noUrl}" style="display:block;text-align:center;background-color:#FFFFFF;color:#DC2626;text-decoration:none;font-size:15px;font-weight:700;padding:12px 10px;border-radius:10px;border:1.5px solid #DC2626;">This is not me</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px;font-size:13px;color:#64748B;">This request expires in <strong>10 minutes</strong>. Once confirmed, this browser will not ask again for 30 days.</p>
      <p style="margin:0;font-size:13px;color:#991B1B;">Didn't try to sign in? Choose <strong>This is not me</strong>: we'll cancel the sign-in, lock the account for 15 minutes and alert OSA. Then change your password.</p>`;

    sendEmailAsync(opts.user.email, subject, text, html);
    return { expiresAt };
}

/** "This is not me": lock the account and tell the OSA admins. */
export async function handleDeniedLogin(row: { user_id: number; ip_address: string | null; user_agent: string | null; created_at: string }) {
    const lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
    const { data: account } = await supabase
        .from('users')
        .update({ login_locked_until: lockedUntil })
        .eq('user_id', row.user_id)
        .select('email')
        .maybeSingle();

    const email = account?.email || `user #${row.user_id}`;
    const message = `Blocked sign-in attempt on admin account ${email} at ${formatManila(row.created_at)} (${describeDevice(row.user_agent)}${row.ip_address ? `, IP ${row.ip_address}` : ''}). The account owner chose "This is not me"; the account is locked until ${formatManila(lockedUntil)}.`;

    const { data: osaAdmins } = await supabase.from('users').select('user_id, email').eq('user_type', 'osa');
    for (const admin of osaAdmins || []) {
        await supabase.from('notification').insert({
            user_id: admin.user_id,
            activity: message,
            message,
            notification_type: 'admin_login_denied',
            action_type: 'login_denied',
            target_entity_type: 'users',
            target_entity_id: row.user_id,
            is_read: false
        });
        if (admin.email) {
            sendEmailAsync(
                admin.email,
                'Security alert: blocked admin sign-in - Liceo GateQR',
                message,
                `<p style="margin:0 0 12px;">A sign-in to an admin account was <strong>blocked by its owner</strong>.</p><p style="margin:0 0 12px;">${message}</p><p style="margin:0;">Please check with the account owner and make sure they change their password.</p>`
            );
        }
    }
    return lockedUntil;
}
