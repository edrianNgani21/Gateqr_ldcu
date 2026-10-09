import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from '$env/dynamic/private';

// Sender configuration
export const defaultSenderEmail = env.GMAIL_USER || 'eluban32@gmail.com';
export const osaEmail = env.OSA_EMAIL || 'aluban98304@liceo.edu.ph';

// Gmail SMTP Credentials (preferred for sending directly from eluban32@gmail.com)
const gmailUser = env.GMAIL_USER || 'eluban32@gmail.com';
const gmailPass = env.GMAIL_APP_PASSWORD || env.SMTP_PASS || env.GMAIL_PASS || '';

// Resend fallback configuration
const resendApiKey = env.RESEND_API_KEY || env.PRIVATE_RESEND_API_KEY;
export const fromEmail =
    env.RESEND_FROM_EMAIL ||
    env.PRIVATE_RESEND_FROM_EMAIL ||
    `GateQR <${defaultSenderEmail}>`;

// Initialize Nodemailer transporter if Gmail App Password is provided
let transporter: Transporter | null = null;
if (gmailPass) {
    try {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailUser,
                pass: gmailPass
            }
        });
        console.log(`[Email] Nodemailer Gmail SMTP configured with sender: ${gmailUser}`);
    } catch (e) {
        console.error('[Email] Failed to initialize Nodemailer Gmail transporter:', e);
    }
}

// Resend client fallback
const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Universal email sender supporting Gmail SMTP (Nodemailer) and Resend API
 */
export async function sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
    fromOrReplyTo?: string
) {
    try {
        if (!to) {
            console.warn('[Email Warning] No recipient email specified.');
            return { error: 'No recipient specified' };
        }

        const replyTo = fromOrReplyTo || osaEmail;
        const htmlBody = html || `<p>${text.replace(/\n/g, '<br>')}</p>`;

        // 1. Try sending directly through Gmail SMTP if configured
        if (transporter && gmailPass) {
            try {
                const info = await transporter.sendMail({
                    from: `"Liceo GateQR" <${gmailUser}>`,
                    to,
                    replyTo,
                    subject,
                    text,
                    html: htmlBody
                });
                console.log(`[Email] Sent via Gmail SMTP to ${to} (MessageId: ${info.messageId}) from ${gmailUser}`);
                return { data: { id: info.messageId } };
            } catch (smtpErr) {
                console.error(`[Email Error] Gmail SMTP failed for ${to}:`, smtpErr);
                // Fallthrough to Resend or local log
            }
        }

        // 2. Fallback to Resend API
        if (resend) {
            const sender = fromEmail;
            const result = await resend.emails.send({
                from: sender,
                to: [to],
                replyTo: defaultSenderEmail,
                subject,
                text,
                html: htmlBody
            });

            if (result.error) {
                console.error(`[Email Error] Resend error sending to ${to}:`, result.error);
                return { error: result.error };
            }

            console.log(`[Email] Sent via Resend to ${to} (ID: ${result.data?.id}): ${subject}`);
            return { data: result.data };
        }

        // 3. Fallback when credentials are still being configured (Dev/Test mode)
        console.warn(`[Email Notice] Email credentials pending setup. Message intended for: ${to} | Subject: ${subject}`);
        console.log(`[Email Body Preview]:\n${text}`);
        return { data: { id: 'dev-mode-simulated' } };
    } catch (error) {
        console.error(`[Email Error] Failed to send to ${to}:`, error);
        return { error };
    }
}

/**
 * Send branded Liceo de Cagayan University OTP verification email
 */
export async function sendOtpEmail(to: string, otpCode: string) {
    const subject = `Your GateQR Verification Code: ${otpCode}`;
    const text = `Liceo de Cagayan University - GateQR Vehicle Sticker Portal\n\nYour one-time verification code is: ${otpCode}\n\nThis code is valid for 5 minutes. Enter this code on the application verification screen to confirm that your email is active and functional.\n\nIf you did not apply for a vehicle sticker, please disregard this email.\n\nSent by GateQR Admissions / OSA Vehicle Verification (${defaultSenderEmail})`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
        .wrapper { width: 100%; max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%); padding: 32px 24px; text-align: center; color: #ffffff; border-bottom: 4px solid #D4AF37; }
        .univ-title { font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #F3E5AB; margin: 0 0 6px 0; }
        .app-title { font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.02em; }
        .body-content { padding: 36px 32px; text-align: center; }
        .greeting { font-size: 16px; font-weight: 600; color: #334155; margin-bottom: 12px; }
        .desc { font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 28px; }
        .otp-box { background: #FFF9E6; border: 2px dashed #D4AF37; border-radius: 12px; padding: 20px; display: inline-block; min-width: 240px; margin: 0 auto 28px auto; }
        .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6B1D2F; margin: 0; }
        .badge { display: inline-block; background: #FEF3C7; color: #92400E; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 9999px; margin-top: 8px; }
        .expiry-note { font-size: 13px; color: #dc2626; font-weight: 600; margin-bottom: 20px; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; line-height: 1.5; }
        .sender-tag { color: #64748b; font-weight: 600; margin-top: 6px; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <div class="univ-title">Liceo de Cagayan University</div>
          <div class="app-title">GateQR Vehicle Sticker Portal</div>
        </div>
        <div class="body-content">
          <div class="greeting">Verify Your Email Address</div>
          <p class="desc">
            You requested to apply for a campus vehicle sticker. Please use the following one-time verification code to verify that your email is active and working.
          </p>
          <div class="otp-box">
            <div class="otp-code">${otpCode}</div>
            <div class="badge">Valid for 5 Minutes</div>
          </div>
          <div class="expiry-note">Do not share this code with anyone.</div>
          <p class="desc" style="font-size: 12px; margin-bottom: 0;">
            If you did not initiate this request, you can safely ignore this email. No action will be taken.
          </p>
        </div>
        <div class="footer">
          <div>Office of Student Affairs & Safety and Security Department</div>
          <div>Liceo de Cagayan University, Rodelsa Hall, Cagayan de Oro City</div>
          <div class="sender-tag">Email sent from: ${defaultSenderEmail}</div>
        </div>
      </div>
    </body>
    </html>
    `;

    return await sendEmail(to, subject, text, html, defaultSenderEmail);
}
