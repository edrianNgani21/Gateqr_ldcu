import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { sendEmail } from '$lib/server/email';

export const POST: RequestHandler = async ({ request }) => {
    try {
        const body = await request.json();
        const rawEmail = body.email;

        if (!rawEmail || typeof rawEmail !== 'string') {
            return json({ error: 'Email is required' }, { status: 400 });
        }

        const email = rawEmail.trim().toLowerCase();

        // Fast random 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Run user lookup and old OTP cleanup concurrently in parallel
        const [userRes, _cleanupRes] = await Promise.all([
            supabase
                .from('user')
                .select('user_id, user_type')
                .ilike('email', email)
                .order('user_id', { ascending: true })
                .limit(1),
            supabase
                .from('otp_codes')
                .delete()
                .ilike('email', email)
        ]);

        let userId = userRes?.data && userRes.data.length > 0 ? userRes.data[0].user_id : null;

        if (!userId) {
            // Create user if doesn't exist yet
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

        // Store OTP in database quickly
        const { error: otpError } = await supabase
            .from('otp_codes')
            .insert({
                user_id: userId,
                email,
                otp,
                expires_at: expiresAt.toISOString()
            });

        if (otpError) {
            console.error('[OTP] Database insertion error:', otpError);
            throw otpError;
        }

        // Send email with OSA sender concurrently in background without blocking
        sendEmail(
            email,
            'Your GateQR Login OTP Code',
            `Your login code is: ${otp}. It will expire in 10 minutes.`,
            `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                <div style="text-align: center; margin-bottom: 20px;">
                    <h2 style="color: #7f1d1d; margin: 0; font-size: 22px;">Liceo GateQR</h2>
                    <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Office of Student Affairs (OSA)</p>
                </div>
                <div style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; border: 1px dashed #cbd5e1; margin-bottom: 20px;">
                    <p style="font-size: 14px; color: #475569; margin: 0 0 10px 0;">Your One-Time Password (OTP) is:</p>
                    <div style="font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #7f1d1d; font-family: monospace;">${otp}</div>
                    <p style="font-size: 12px; color: #94a3b8; margin: 12px 0 0 0;">This code is valid for 10 minutes. Do not share it with anyone.</p>
                </div>
                <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0; line-height: 1.4;">
                    Liceo de Cagayan University &bull; Office of Student Affairs<br>
                    <a href="mailto:aluban98304@liceo.edu.ph" style="color: #7f1d1d; text-decoration: none;">aluban98304@liceo.edu.ph</a>
                </p>
            </div>`,
            `"Liceo OSA - GateQR" <aluban98304@liceo.edu.ph>`
        ).catch(err => console.error('[Email Error]:', err));

        console.log(`[OTP] Sent for ${email}: ${otp}`);

        // Return immediately
        return json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Login error:', error);
        return json({ error: 'Failed to process login request' }, { status: 500 });
    }
};
