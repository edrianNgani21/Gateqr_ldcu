import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { generateOtp } from '$lib/server/otp';
import { sendOtpEmail } from '$lib/server/email';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const body = await request.json();
        const rawEmail = body.email;

        if (!rawEmail || typeof rawEmail !== 'string') {
            return json({ error: 'Valid email address is required' }, { status: 400 });
        }

        const email = rawEmail.trim().toLowerCase();

        // Basic format check
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return json({ error: 'Please enter a valid email address format' }, { status: 400 });
        }

        // Check if user exists and is inactive or an admin/staff account
        const { data: userList, error: queryError } = await supabase
            .from('user')
            .select('user_id, email, user_type, identification, department_id, is_active')
            .ilike('email', email)
            .limit(1);

        if (queryError) {
            console.error('[Register] Database query error:', queryError);
            return json({ error: 'Database error occurred. Please try again.' }, { status: 500 });
        }

        const existingUser = userList && userList.length > 0 ? userList[0] : null;

        if (existingUser) {
            if (existingUser.is_active === false) {
                return json({ error: 'Account is deactivated. Please contact OSA administration.' }, { status: 403 });
            }

            // If an Admin/Dean/Security tries to use the Applicant register form, guide them to Admin Login
            if (existingUser.user_type !== 'Applicants') {
                return json({
                    error: `This email is registered as ${existingUser.user_type}. Please sign in using the Staff/Admin Login tab with your password.`
                }, { status: 400 });
            }
        }

        // Generate 6-digit OTP
        const otpCode = generateOtp(email);

        // Send OTP verification email
        const emailResult = await sendOtpEmail(email, otpCode);
        if (emailResult.error) {
            console.warn('[Register] Warning sending OTP email:', emailResult.error);
        }

        console.log(`[Register] Verification OTP sent for applicant: ${email}`);

        return json({
            success: true,
            requiresOtp: true,
            email,
            message: 'A 6-digit verification code has been sent to your email to verify it is working.'
        });
    } catch (error) {
        console.error('[Register Error]:', error);
        return json({ error: 'An unexpected error occurred during verification' }, { status: 500 });
    }
};
