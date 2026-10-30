import { env } from '$env/dynamic/private';
import { supabaseAdmin } from './supabase';

// Uploaded files live in a private Supabase Storage bucket. The database keeps their
// public-style URLs; every response the app sends rewrites those into /files/<path>,
// which checks the session and redirects to a short-lived signed URL.

export const FILES_BUCKET = 'gateqr-uploads';
const SIGNED_URL_SECONDS = 60 * 10;
const STAFF_ROLES = ['osa', 'security', 'dean', 'administrative'];

const supabaseUrl = (env.PRIVATE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLIC_PREFIX = `${supabaseUrl}/storage/v1/object/public/${FILES_BUCKET}/`;
const prefixPattern = supabaseUrl ? new RegExp(PUBLIC_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;

/** Replace every storage URL in a text body (HTML or JSON) with the app's /files/ route. */
export function rewriteStorageUrls(body: string): string {
    if (!prefixPattern || !body.includes('/storage/v1/object/public/')) return body;
    return body.replace(prefixPattern, '/files/');
}

/** Absolute app link to a stored file, for emails (the viewer must log in to open it). */
export function toAppFileUrl(storedUrl: string | null | undefined): string | null {
    if (!storedUrl) return null;
    const base = (env.PUBLIC_APP_URL || env.ORIGIN || '').replace(/\/+$/, '');
    const rewritten = rewriteStorageUrls(storedUrl);
    return rewritten.startsWith('/files/') ? `${base}${rewritten}` : storedUrl;
}

/**
 * Staff can open any uploaded file. Applicants can open only files attached to their own
 * registrations (documents, receipt, QR, violation photos).
 */
export async function canAccessFile(user: { role: string; user_id?: number; email: string } | null, path: string): Promise<boolean> {
    if (!user) return false;
    if (STAFF_ROLES.includes(user.role)) return true;
    if (!user.user_id) return false;

    const { data: regs } = await supabaseAdmin
        .from('registration')
        .select('registration_id, doc_id, agreement_form, signed_agreement_form, school_id, enrollment_form, drivers_license, receipt, qr_code, vehicle_information:vehicle_information_id("or", cr, authorization_letter)')
        .eq('user_id', user.user_id);
    if (!regs || regs.length === 0) return false;
    if (JSON.stringify(regs).includes(path)) return true;

    const ids = regs.map((r: any) => r.registration_id);
    const [{ data: violations }, { data: changes }] = await Promise.all([
        supabaseAdmin.from('blocklist').select('evidence_image').in('registration_id', ids),
        supabaseAdmin.from('modification_request').select('proposed_changes').in('registration_id', ids)
    ]);
    return JSON.stringify(violations || []).includes(path) || JSON.stringify(changes || []).includes(path);
}

export async function createSignedFileUrl(path: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin.storage.from(FILES_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
        console.error(`[Files] Could not sign ${path}:`, error);
        return null;
    }
    return data.signedUrl;
}
