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
            .from('user')
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
                    .from('user')
                    .update({ password_hash: newHash, user_type: 'Osa', identification: 'Admin' })
                    .eq('user_id', user.user_id);
            } catch (syncErr) {
                console.warn('[Login] Note: Could not auto-sync password_hash column:', syncErr);
            }
        }

        if (!isPasswordValid) {
            return json({ error: 'Invalid email or password' }, { status: 401 });
        }

        // Map user_type to system role
        let role = 'applicant';
        let redirectUrl = '/status';

        if (user.user_type === 'Osa') {
            role = 'osa';
            redirectUrl = '/osa';
        } else if (user.user_type === 'Safety Security') {
            role = 'security';
            redirectUrl = '/security';
        } else if (user.user_type === 'dean') {
            role = 'dean';
            redirectUrl = '/dean';
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
