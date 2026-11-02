import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { verifyOtp } from '$lib/server/otp';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, cookies }) => {
    try {
        const body = await request.json();
        const rawEmail = body.email;
        const otp = body.otp;

        if (!rawEmail || !otp) {
            return json({ error: 'Email and 6-digit verification code are required' }, { status: 400 });
        }

        const email = rawEmail.trim().toLowerCase();

        // 1. Verify OTP code
        const verifyResult = verifyOtp(email, otp);
        if (!verifyResult.valid) {
            return json({ error: verifyResult.reason || 'Invalid verification code' }, { status: 400 });
        }

        // 2. Fetch or create applicant in the database
        const { data: userList, error: queryError } = await supabase
            .from('users')
            .select('user_id, email, account_role, account_type, department_id, is_active')
            .ilike('email', email)
            .limit(1);

        if (queryError) {
            console.error('[Verify] Database error querying user:', queryError);
            return json({ error: 'We could not check your account because the database did not respond. Please try again in a moment.' }, { status: 500 });
        }

        let user = userList && userList.length > 0 ? userList[0] : null;

        if (user) {
            if (user.is_active === false) {
                return json({ error: 'Account is deactivated. Please contact OSA administration.' }, { status: 403 });
            }
        } else {
            // Create new applicant account
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert({
                    email,
                    account_role: 'applicant',
                    account_type: 'student',
                    is_active: true
                })
                .select('user_id, email, account_role, account_type, department_id, is_active')
                .single();

            if (createError || !newUser) {
                console.error('[Verify] Failed to create user:', createError);
                return json({ error: 'Your code was accepted, but your applicant profile could not be created. Please try again in a moment.' }, { status: 500 });
            }

            user = newUser;
        }

        // 3. Check for existing vehicle sticker application
        const { data: regList } = await supabase
            .from('sticker_application')
            .select('registration_id, status').neq('status', 'deleted')
            .eq('user_id', user.user_id)
            .order('created_at', { ascending: false })
            .limit(1);

        const hasExistingApplication = regList && regList.length > 0;
        const redirectUrl = hasExistingApplication ? '/status' : '/';

        // 4. Issue JWT session token
        const token = jwt.sign(
            {
                email: user.email,
                role: 'applicant',
                account_role: 'Applicants',
                department_id: null,
                user_id: user.user_id
            },
            env.JWT_SECRET as string,
            { expiresIn: '7d' }
        );

        // 5. Set session cookie
        cookies.set('gateqr_session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        console.log(`[Verify] OTP successfully verified for ${user.email} -> ${redirectUrl}`);

        return json({
            success: true,
            message: 'Email verified successfully',
            role: 'applicant',
            redirectUrl,
            hasExistingApplication
        });
    } catch (error) {
        console.error('[Verify Error]:', error);
        return json({ error: 'Your code could not be verified because the server ran into a problem. Please try again in a moment.' }, { status: 500 });
    }
};
