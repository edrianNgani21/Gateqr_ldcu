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
            },
            connectionTimeout: 4000,
            greetingTimeout: 3000,
            socketTimeout: 4000
        });
        console.log(`[Email] Nodemailer Gmail SMTP configured with sender: ${gmailUser}`);
    } catch (e) {
        console.error('[Email] Failed to initialize Nodemailer Gmail transporter:', e);
    }
}

// Resend client fallback
const resend = resendApiKey ? new Resend(resendApiKey) : null;

type EmailTone = 'success' | 'danger' | 'info';

const toneStyles: Record<EmailTone, { accent: string; soft: string; text: string; label: string }> = {
    success: { accent: '#16A34A', soft: '#F0FDF4', text: '#166534', label: 'Update' },
    danger: { accent: '#DC2626', soft: '#FEF2F2', text: '#991B1B', label: 'Action Needed' },
    info: { accent: '#D4AF37', soft: '#FFF9E6', text: '#92400E', label: 'Notice' }
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function detectTone(subject: string): EmailTone {
    const s = subject.toLowerCase();
    if (/(reject|revok|delet|denied|blocked|retract|violation)/.test(s)) return 'danger';
    if (/(approv|accept|complete|restor|unrevok|received|resolved|verified)/.test(s)) return 'success';
    return 'info';
}

/**
 * Wrap a plain HTML fragment in the GateQR maroon & gold email layout.
 * Uses tables and inline styles so it renders consistently in Gmail, Outlook and mobile clients.
 */
export function renderBrandedEmail(subject: string, bodyHtml: string): string {
    const tone = toneStyles[detectTone(subject)];
    const title = escapeHtml(subject.replace(/\s*[-—]\s*Liceo GateQR\s*$/i, ''));
    const preheader = escapeHtml(bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120));
    const portalUrl = env.PUBLIC_APP_URL || env.ORIGIN || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5EFE6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E293B;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5EFE6;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E7DCCB;">
          <tr>
            <td style="background-color:#6B1D2F;background-image:linear-gradient(135deg,#7A1734 0%,#4A121E 100%);padding:28px 28px 24px;text-align:center;border-bottom:4px solid #D4AF37;">
              <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#F3E5AB;margin:0 0 6px;">Liceo de Cagayan University</div>
              <div style="font-size:22px;font-weight:800;color:#FFFFFF;margin:0;letter-spacing:-0.3px;">GateQR Vehicle Sticker Portal</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <span style="display:inline-block;background-color:${tone.soft};color:${tone.text};border:1px solid ${tone.accent};font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;padding:4px 12px;border-radius:999px;">${tone.label}</span>
              <h1 style="font-size:20px;line-height:1.3;font-weight:800;color:#6B1D2F;margin:14px 0 0;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 8px;">
              <div style="border-left:4px solid ${tone.accent};background-color:#FFFDF8;border-radius:8px;padding:16px 18px;font-size:15px;line-height:1.65;color:#334155;">
                ${bodyHtml}
              </div>
            </td>
          </tr>
          ${portalUrl ? `<tr>
            <td align="center" style="padding:18px 28px 6px;">
              <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background-color:#6B1D2F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;padding:12px 26px;border-radius:10px;border:1px solid #D4AF37;">Open GateQR Portal</a>
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:20px 28px 26px;">
              <p style="font-size:12px;line-height:1.6;color:#64748B;margin:0;">This is an automated message from GateQR. For questions, reply to this email or visit the Office of Student Affairs.</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#FAF6EF;border-top:1px solid #E7DCCB;padding:18px 24px;text-align:center;font-size:12px;line-height:1.6;color:#94A3B8;">
              <div style="color:#6B1D2F;font-weight:700;">Office of Student Affairs &amp; Safety and Security Department</div>
              <div>Liceo de Cagayan University, Rodelsa Hall, Cagayan de Oro City</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Universal email sender supporting Gmail SMTP (Nodemailer) and Resend API.
 * HTML fragments are wrapped in the branded GateQR layout; full documents are sent as-is.
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
        const fragment = html || `<p style="margin:0;">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
        const htmlBody = /^\s*<!DOCTYPE/i.test(fragment) ? fragment : renderBrandedEmail(subject, fragment);

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
 * Non-blocking email sender for instant background notification dispatching
 */
export function sendEmailAsync(
    to: string,
    subject: string,
    text: string,
    html?: string,
    fromOrReplyTo?: string
) {
    if (!to) return;
    sendEmail(to, subject, text, html, fromOrReplyTo).catch(err => {
        console.error(`[Background Email Error] Failed to send to ${to}:`, err);
    });
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
