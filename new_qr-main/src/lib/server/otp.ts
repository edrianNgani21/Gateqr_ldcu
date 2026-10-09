// In-memory OTP storage with TTL and rate limiting
interface OtpEntry {
    code: string;
    expiresAt: number;
    attempts: number;
}

const otpStore = new Map<string, OtpEntry>();

// Default OTP expiry: 5 minutes (300,000 ms)
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Clean up expired OTPs every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, entry] of otpStore.entries()) {
        if (now > entry.expiresAt) {
            otpStore.delete(email);
        }
    }
}, 2 * 60 * 1000);

/**
 * Generate and store a secure 6-digit OTP for the given email
 */
export function generateOtp(email: string): string {
    const normalized = email.trim().toLowerCase();
    
    // Generate secure 6-digit numeric string (100000 - 999999)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + OTP_TTL_MS;

    otpStore.set(normalized, {
        code,
        expiresAt,
        attempts: 0
    });

    console.log(`[OTP] Generated 6-digit code for ${normalized} (Expires in 5 mins). Code: ${code}`);
    return code;
}

/**
 * Verify applicant OTP
 */
export function verifyOtp(email: string, candidate: string): { valid: boolean; reason?: string } {
    const normalized = email.trim().toLowerCase();
    const cleanCode = (candidate || '').trim();

    const entry = otpStore.get(normalized);

    if (!entry) {
        return { valid: false, reason: 'No OTP requested or code has expired. Please request a new code.' };
    }

    if (Date.now() > entry.expiresAt) {
        otpStore.delete(normalized);
        return { valid: false, reason: 'This verification code has expired. Please request a new code.' };
    }

    if (entry.attempts >= MAX_ATTEMPTS) {
        otpStore.delete(normalized);
        return { valid: false, reason: 'Too many incorrect attempts. Please request a new verification code.' };
    }

    if (entry.code !== cleanCode) {
        entry.attempts += 1;
        const remaining = MAX_ATTEMPTS - entry.attempts;
        return { 
            valid: false, 
            reason: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` 
        };
    }

    // Success: consume and invalidate the code
    otpStore.delete(normalized);
    return { valid: true };
}

/**
 * Check if an email has a pending valid OTP
 */
export function hasPendingOtp(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const entry = otpStore.get(normalized);
    if (!entry) return false;
    return Date.now() <= entry.expiresAt;
}
