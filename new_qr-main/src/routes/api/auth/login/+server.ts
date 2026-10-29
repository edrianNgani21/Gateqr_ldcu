import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';
import { issueSession, isTrustedDevice, startLoginConfirmation, formatManila } from '$lib/server/loginConfirmation';

export const POST: RequestHandler = async ({ request, cookies, url, getClientAddress }) => {
    try {
        const body = await request.json();
        const rawEmail = body.email;
        const rawPassword = body.password;

        if (!rawEmail || typeof rawEmail !== 'string') {
            return json({ error: 'Email address is required' }, { status: 400 });
        }

        if (!rawPassword || typeof rawPassword !== 'string') {
            return json({ error: 'Password is required' }, { status: 400 });
        }

        const email = rawEmail.trim().toLowerCase();
        const password = rawPassword.trim();

        // Fetch user record
        const { data: userList, error: queryError } = await supabase
            .from('users')
            .select('user_id, email, user_type, identification, department_id, password_hash, is_active, login_locked_until')
            .ilike('email', email)
            .limit(1);

        if (queryError) {
            console.error('[Login] Database query error:', queryError);
            return json({ error: 'Database error occurred. Please try again.' }, { status: 500 });
        }

        const user = userList && userList.length > 0 ? userList[0] : null;

        if (!user) {
            return json({ error: 'Invalid email or password' }, { status: 401 });
        }

        if (user.is_active === false) {
            return json({ error: 'Account is deactivated. Please contact OSA administration.' }, { status: 403 });
        }

        // Locked after the owner chose "This is not me" on a sign-in confirmation email
        if (user.login_locked_until && new Date(user.login_locked_until).getTime() > Date.now()) {
            return json({
                error: `This account is temporarily locked after a blocked sign-in attempt. Try again after ${formatManila(user.login_locked_until)}.`
            }, { status: 423 });
        }

        // Verify password
        const isPasswordValid = user.password_hash ? bcrypt.compareSync(password, user.password_hash) : false;

        if (!isPasswordValid) {
            return json({ error: 'Invalid email or password' }, { status: 401 });
        }

        // Map user_type and identification to system role
        let role = 'applicant';
        let redirectUrl = '/status';

        const uType = (user.user_type || '').toLowerCase();
        const ident = (user.identification || '').toLowerCase();

        if (uType === 'osa') {
            role = 'osa';
            redirectUrl = '/osa/dashboard';
        } else if (uType === 'safety_security' || uType === 'safety security' || uType === 'security') {
            role = 'security';
            redirectUrl = '/security/dashboard';
        } else if (uType === 'office head' || uType === 'administrative') {
            role = 'administrative';
            redirectUrl = '/administrative';
        } else if (uType === 'academic head' || uType === 'dean' || ident === 'faculty') {
            // Check if department is administrative
            let isAdministrativeDept = false;
            if (user.department_id) {
                const { data: deptData } = await supabase
                    .from('department')
                    .select('*')
                    .eq('department_id', user.department_id)
                    .maybeSingle();
                if (deptData && (deptData.administrative_department || deptData['Administrative Department'])) {
                    isAdministrativeDept = true;
                }
            }

            if (isAdministrativeDept) {
                role = 'administrative';
                redirectUrl = '/administrative';
            } else {
                role = 'dean';
                redirectUrl = '/dean';
            }
        } else {
            role = 'applicant';
            redirectUrl = '/status';
        }

        // Admins on a browser that hasn't confirmed a sign-in in the last 30 days must confirm by email first
        if (role !== 'applicant' && !isTrustedDevice(cookies, user.user_id)) {
            let ip: string | null = null;
            try { ip = getClientAddress(); } catch { ip = null; }
            const { expiresAt } = await startLoginConfirmation({
                cookies,
                origin: url.origin,
                user: { user_id: user.user_id, email: user.email },
                role,
                redirectUrl,
                ip,
                userAgent: request.headers.get('user-agent')
            });
            console.log(`[Login] Email confirmation required for ${user.email} (Role: ${role})`);
            return json({ requires_confirmation: true, email: user.email, expires_at: expiresAt });
        }

        issueSession(cookies, {
            user_id: user.user_id,
            email: user.email,
            role,
            user_type: user.user_type,
            department_id: user.department_id || null
        });

        console.log(`[Login] Successful login for ${user.email} (Role: ${role})`);

        return json({
            message: 'Login successful',
            role,
            user_type: user.user_type,
            redirectUrl
        });
    } catch (error) {
        console.error('[Login Error]:', error);
        return json({ error: 'An unexpected error occurred during login' }, { status: 500 });
    }
};
