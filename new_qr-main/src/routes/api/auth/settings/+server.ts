import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';
import { EMAIL_CHANGE_PURPOSE, EMAIL_CHANGE_TTL_MINUTES } from '$lib/server/emailChange';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('user_id, email, account_role, account_type, created_at, is_active, google_auth_id')
            .eq('user_id', locals.user.user_id)
            .single();

        if (error || !user) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        return json({
            email: user.email,
            account_role: user.account_role,
            account_type: user.account_type,
            created_at: user.created_at,
            is_active: user.is_active,
            google_linked: Boolean(user.google_auth_id)
        });
    } catch (error) {
        console.error('[Settings GET error]:', error);
        return json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        if (body.action !== 'request_email_change') {
            return json({ error: 'Invalid action specified' }, { status: 400 });
        }

        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('user_id, email')
            .eq('user_id', locals.user.user_id)
            .single();

        if (fetchError || !user) {
            return json({ error: 'User account not found' }, { status: 404 });
        }

        const newEmail = typeof body.new_email === 'string' ? body.new_email.trim().toLowerCase() : '';
        if (!EMAIL_PATTERN.test(newEmail)) {
            return json({ error: 'Please enter a valid email address.' }, { status: 400 });
        }
        if (newEmail === user.email.toLowerCase()) {
            return json({ error: 'That is already your current email.' }, { status: 400 });
        }

        const { data: taken } = await supabase.from('users').select('user_id').ilike('email', newEmail).limit(1);
        if (taken && taken.length > 0) {
            return json({ error: 'That email is already used by another account.' }, { status: 400 });
        }

        // Stateless confirmation: the signed link carries the request and is only valid while the
        // account still has the old email, so it cannot be used twice.
        const token = jwt.sign(
            { purpose: EMAIL_CHANGE_PURPOSE, uid: user.user_id, old_email: user.email, new_email: newEmail },
            env.JWT_SECRET as string,
            { expiresIn: `${EMAIL_CHANGE_TTL_MINUTES}m` }
        );
        const base = (env.PUBLIC_APP_URL || env.ORIGIN || url.origin).replace(/\/+$/, '');
        const link = `${base}/auth/confirm-email-change?token=${encodeURIComponent(token)}`;

        const subject = 'Confirm your GateQR email change';
        const text =
            `A request was made to change the GateQR sign-in email of this account.\n\n` +
            `Current email: ${user.email}\n` +
            `New email: ${newEmail}\n\n` +
            `To approve, open this link within ${EMAIL_CHANGE_TTL_MINUTES} minutes:\n${link}\n\n` +
            `After the change, sign in with the Google account of ${newEmail}. This Google account will no longer work.\n` +
            `If you did not ask for this, ignore this email and your email stays the same.`;
        const html =
            `<p style="margin:0 0 12px;">A request was made to change the GateQR sign-in email of this account.</p>` +
            `<p style="margin:0 0 12px;"><strong>Current email:</strong> ${escapeHtml(user.email)}<br><strong>New email:</strong> ${escapeHtml(newEmail)}</p>` +
            `<p style="margin:0 0 16px;"><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#7A1734;color:#ffffff;font-weight:700;text-decoration:none;">Review and confirm the change</a></p>` +
            `<p style="margin:0 0 12px;">The link expires in ${EMAIL_CHANGE_TTL_MINUTES} minutes. After the change, sign in with the Google account of <strong>${escapeHtml(newEmail)}</strong>; this Google account will no longer work.</p>` +
            `<p style="margin:0;">If you did not ask for this, ignore this email and your email stays the same.</p>`;

        const sent = await sendEmail(user.email, subject, text, html);
        if (sent?.error) {
            return json({ error: 'Could not send the confirmation email. Please try again.' }, { status: 502 });
        }

        return json({ message: `Confirmation sent to ${user.email}. Open it within ${EMAIL_CHANGE_TTL_MINUTES} minutes to finish the change.` });
    } catch (error) {
        console.error('[Settings POST error]:', error);
        return json({ error: 'Failed to process the request' }, { status: 500 });
    }
};
