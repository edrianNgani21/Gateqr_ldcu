import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

/**
 * Admin Google sign-in.
 * The browser completes Google OAuth through Supabase Auth and sends us the resulting
 * access token. We verify it with Supabase, match the verified email against the
 * existing `users` table (the admin allowlist), link `auth_user_id`, and issue the
 * same `gateqr_session` cookie the password login uses.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
    try {
        const { access_token } = await request.json();

        if (!access_token || typeof access_token !== 'string') {
            return json({ error: 'Missing Google session token' }, { status: 400 });
        }

        // Verify the token with Supabase (never trust client-provided email)
        const { data: authData, error: authError } = await supabase.auth.getUser(access_token);
        const authUser = authData?.user;

        if (authError || !authUser || !authUser.email) {
            return json({ error: 'Google sign-in could not be verified. Please try again.' }, { status: 401 });
        }

        const email = authUser.email.trim().toLowerCase();

        const { data: userList, error: queryError } = await supabase
            .from('users')
            .select('user_id, email, user_type, identification, department_id, is_active, auth_user_id')
            .ilike('email', email)
            .limit(1);

        if (queryError) {
            console.error('[Google Login] Database query error:', queryError);
            return json({ error: 'Database error occurred. Please try again.' }, { status: 500 });
        }

        const user = userList && userList.length > 0 ? userList[0] : null;

        if (!user) {
            return json({ error: 'This Google account is not registered as an administrator.' }, { status: 403 });
        }

        if (user.is_active === false) {
            return json({ error: 'Account is deactivated. Please contact OSA administration.' }, { status: 403 });
        }

        // Map user_type and identification to system role (same rules as password login)
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
        }

        // Admin login only: applicants must use the applicant flow
        if (role === 'applicant') {
            return json({ error: 'This Google account is not registered as an administrator.' }, { status: 403 });
        }

        // Link the Google identity to the user row (one-time), or reject a mismatch
        if (!user.auth_user_id) {
            const { error: linkError } = await supabase
                .from('users')
                .update({ auth_user_id: authUser.id })
                .eq('user_id', user.user_id);
            if (linkError) {
                console.error('[Google Login] Failed to link auth_user_id:', linkError);
                return json({ error: 'Could not link your Google account. Please contact OSA administration.' }, { status: 500 });
            }
        } else if (user.auth_user_id !== authUser.id) {
            return json({ error: 'This account is linked to a different Google identity.' }, { status: 403 });
        }

        const token = jwt.sign(
            {
                email: user.email,
                role,
                user_type: user.user_type,
                department_id: user.department_id || null,
                user_id: user.user_id
            },
            env.JWT_SECRET as string,
            { expiresIn: '7d' }
        );

        cookies.set('gateqr_session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7
        });

        console.log(`[Google Login] Successful login for ${user.email} (Role: ${role})`);

        return json({
            message: 'Login successful',
            role,
            user_type: user.user_type,
            redirectUrl
        });
    } catch (error) {
        console.error('[Google Login Error]:', error);
        return json({ error: 'An unexpected error occurred during Google sign-in' }, { status: 500 });
    }
};
