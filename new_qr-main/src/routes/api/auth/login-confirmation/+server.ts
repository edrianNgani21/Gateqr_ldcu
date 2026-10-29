import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { PENDING_COOKIE, hashToken, issueSession, trustDevice } from '$lib/server/loginConfirmation';

// Polled by the login screen while it waits for the admin to answer the confirmation email.
// Once approved, this browser receives the session and is remembered for 30 days.
export const GET: RequestHandler = async ({ cookies }) => {
    const browserToken = cookies.get(PENDING_COOKIE);
    if (!browserToken) {
        return json({ status: 'none' });
    }

    const { data: row, error } = await supabase
        .from('login_confirmation')
        .select('login_confirmation_id, user_id, status, session_role, redirect_url, expires_at')
        .eq('browser_token_hash', hashToken(browserToken))
        .maybeSingle();

    if (error || !row) {
        cookies.delete(PENDING_COOKIE, { path: '/' });
        return json({ status: 'none' });
    }

    if (row.status === 'pending') {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
            cookies.delete(PENDING_COOKIE, { path: '/' });
            return json({ status: 'expired' });
        }
        return json({ status: 'pending', expires_at: row.expires_at });
    }

    if (row.status === 'denied') {
        cookies.delete(PENDING_COOKIE, { path: '/' });
        return json({ status: 'denied' });
    }

    if (row.status === 'approved') {
        // One-time hand-off: mark used before creating the session so a replay can't reuse it
        const { data: claimed } = await supabase
            .from('login_confirmation')
            .update({ status: 'used' })
            .eq('login_confirmation_id', row.login_confirmation_id)
            .eq('status', 'approved')
            .select('login_confirmation_id')
            .maybeSingle();
        if (!claimed) {
            cookies.delete(PENDING_COOKIE, { path: '/' });
            return json({ status: 'none' });
        }

        const { data: user } = await supabase
            .from('users')
            .select('user_id, email, user_type, department_id, is_active')
            .eq('user_id', row.user_id)
            .maybeSingle();
        if (!user || user.is_active === false) {
            cookies.delete(PENDING_COOKIE, { path: '/' });
            return json({ status: 'denied' });
        }

        issueSession(cookies, {
            user_id: user.user_id,
            email: user.email,
            role: row.session_role,
            user_type: user.user_type,
            department_id: user.department_id || null
        });
        trustDevice(cookies, user.user_id);
        cookies.delete(PENDING_COOKIE, { path: '/' });
        return json({ status: 'approved', redirectUrl: row.redirect_url });
    }

    cookies.delete(PENDING_COOKIE, { path: '/' });
    return json({ status: 'none' });
};
