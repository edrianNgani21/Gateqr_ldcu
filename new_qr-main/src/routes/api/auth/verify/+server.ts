import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, cookies }) => {
    try {
        const body = await request.json();
        const rawEmail = body.email;
        const rawOtp = body.otp;

        if (!rawEmail || !rawOtp) {
            return json({ error: 'Email and OTP are required' }, { status: 400 });
        }

        const email = String(rawEmail).trim().toLowerCase();
        const otp = String(rawOtp).trim();

        // Verify OTP from Supabase with optimized query
        const { data: otpData, error: otpError } = await supabase
            .from('otp_codes')
            .select('*')
            .ilike('email', email)
            .eq('otp', otp)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        console.log('[OTP] Query result - Error:', otpError, 'Data:', otpData);

        if (otpError || !otpData) {
            console.error('[OTP] Verification failed - OTP not found or expired');
            return json({ error: 'Invalid or expired OTP' }, { status: 401 });
        }

        // Clean up used OTP (and old ones) - fire and forget
        supabase
            .from('otp_codes')
            .delete()
            .eq('email', email)
            .then(({ error }) => {
                if (error) console.error('OTP cleanup error:', error);
            });

        // Get user from Supabase with optimized query
        const { data: userList } = await supabase
            .from('user')
            .select('user_id, user_type, identification, department_id')
            .ilike('email', email)
            .order('user_id', { ascending: true })
            .limit(1);

        const users = userList && userList.length > 0 ? userList[0] : null;

        let userId;
        let userType = 'Applicants';
        let identification = 'Visitor';
        let department_id = null;

        if (users) {
            userId = users.user_id;
            userType = users.user_type || 'Applicants';
            identification = users.identification || 'Visitor';
            department_id = users.department_id || null;
        } else {
            // Create user if doesn't exist
            const { data: newUser, error: createError } = await supabase
                .from('user')
                .insert({
                    email,
                    user_type: 'Applicants',
                    identification: 'Visitor'
                })
                .select('user_id')
                .single();

            if (createError) throw createError;
            userId = newUser.user_id;
        }

        // Map user_type to role for JWT
        let role = 'applicant';

        if (userType === 'Osa') {
            role = 'osa';
        } else if (userType === 'Safety Security') {
            role = 'security';
        } else if (userType === 'dean') {
            role = 'dean';
            // department_id is already fetched from user table
        } else {
            role = 'applicant';
        }

        // Determine redirect URL based on role
        let redirectUrl = '/status';
        if (role === 'osa') {
            redirectUrl = '/osa';
        } else if (role === 'security') {
            redirectUrl = '/security';
        } else if (role === 'dean') {
            redirectUrl = '/dean';
        } else {
            redirectUrl = '/status';
        }

        // Generate JWT with both role and user_type
        const token = jwt.sign(
            { 
                email, 
                role, 
                user_type: userType,
                department_id,
                user_id: userId
            },
            env.JWT_SECRET as string,
            { expiresIn: '7d' } // 7 days
        );

        // Set HttpOnly cookie
        cookies.set('gateqr_session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        return json({ message: 'Verified successfully', role, user_type: userType, redirectUrl });
    } catch (error) {
        console.error('Verify error:', error);
        return json({ error: 'Failed to verify OTP' }, { status: 500 });
    }
};
