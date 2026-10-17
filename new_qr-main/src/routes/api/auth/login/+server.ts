import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, cookies }) => {
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
            .select('user_id, email, user_type, identification, department_id, password_hash, is_active')
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

        // Verify password
        let isPasswordValid = false;

        if (user.password_hash) {
            isPasswordValid = bcrypt.compareSync(password, user.password_hash);
        } else if (email === 'aluban98304@liceo.edu.ph' && password === 'Admin123!') {
            // Bootstrap fallback for default OSA Admin before/during manual migration
            isPasswordValid = true;
            try {
                const newHash = bcrypt.hashSync('Admin123!', 10);
                await supabase
                    .from('users')
                    .update({ password_hash: newHash, user_type: 'osa', identification: 'admin' })
                    .eq('user_id', user.user_id);
            } catch (syncErr) {
                console.warn('[Login] Note: Could not auto-sync password_hash column:', syncErr);
            }
        }

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

        // Generate JWT session token
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

        // Store HttpOnly session cookie
        cookies.set('gateqr_session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
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
