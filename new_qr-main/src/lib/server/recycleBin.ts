import { supabase } from './supabase';
import { sendEmail } from './email';
import { deleteFromStorage } from './storage';

// Recently Deleted: a deleted registration keeps its row (status 'deleted', hidden everywhere) so
// gate_log history keeps working; recycle_bin records who deleted it, when, why and a copy.
// Only the primary OSA administrator may restore or permanently delete.
export const PRIMARY_OSA_EMAIL = 'aluban98304@liceo.edu.ph';

export function isPrimaryOsa(user: { email?: string; role?: string } | null | undefined): boolean {
    return !!user && user.role === 'osa' && (user.email || '').trim().toLowerCase() === PRIMARY_OSA_EMAIL;
}

export function deletedByRoleLabel(role: string | undefined): string {
    if (role === 'security') return 'Security Administrator';
    if (role === 'osa') return 'OSA Administrator';
    return role || 'Administrator';
}

// Statuses that hold the applicant's single active-application slot (see idx_registration_unique_active_*)
const INACTIVE_STATUSES = ['rejected', 'revoked', 'deleted'];

function escapeHtml(value: string): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

async function loadRegistration(registrationId: number) {
    const { data } = await supabase
        .from('sticker_application')
        .select('*, user:user_id(email, user_id), vehicle:vehicle_id(*)')
        .eq('registration_id', registrationId)
        .maybeSingle();
    return data;
}

export interface Actor {
    user_id?: number;
    email?: string;
    role?: string;
}

/** Move a registration to Recently Deleted and email the applicant. */
export async function moveToRecycleBin(registrationId: number, reason: string, actor: Actor, notifyApplicant = true) {
    const reg = await loadRegistration(registrationId);
    if (!reg) throw new Error('Application not found');
    if (reg.status === 'deleted') throw new Error('This application is already in Recently Deleted');

    const roleLabel = deletedByRoleLabel(actor.role);
    const { user, vehicle, ...registrationRow } = reg;
    const { error: binError } = await supabase.from('recycle_bin').insert({
        registration_id: registrationId,
        previous_status: reg.status,
        reason: reason.trim(),
        deleted_by_user_id: actor.user_id ?? null,
        deleted_by_email: actor.email ?? null,
        deleted_by_role: roleLabel,
        snapshot: { registration: registrationRow, vehicle: vehicle, applicant_email: user?.email ?? null }
    });
    if (binError) throw binError;

    const { error: statusError } = await supabase.from('sticker_application').update({ status: 'deleted' }).eq('registration_id', registrationId);
    if (statusError) {
        await supabase.from('recycle_bin').delete().eq('registration_id', registrationId);
        throw statusError;
    }

    if (notifyApplicant && user?.email) {
        const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Applicant';
        const plate = vehicle?.plate_number || 'your vehicle';
        await sendEmail(
            user.email,
            'Your GateQR registration was deleted - Liceo GateQR',
            `Hello ${name},\n\nYour GateQR vehicle registration (Reg. No. ${registrationId}, ${plate}) has been deleted by the ${roleLabel}.\n` +
                `Reason: ${reason.trim()}\n\nYour QR sticker no longer gives access at the campus gates. You may apply for a new sticker at any time.\n` +
                `If you think this is a mistake, please contact the Office of Student Affairs.`,
            `<p style="margin:0 0 12px;">Hello ${escapeHtml(name)},</p>` +
                `<p style="margin:0 0 12px;">Your GateQR vehicle registration (<strong>Reg. No. ${registrationId}</strong>, ${escapeHtml(plate)}) has been <strong>deleted</strong> by the ${escapeHtml(roleLabel)}.</p>` +
                `<p style="margin:0 0 12px;"><strong>Reason:</strong> ${escapeHtml(reason.trim())}</p>` +
                `<p style="margin:0 0 12px;">Your QR sticker no longer gives access at the campus gates. You may apply for a new sticker at any time.</p>` +
                `<p style="margin:0;">If you think this is a mistake, please contact the Office of Student Affairs.</p>`
        );
    }
    return reg;
}

/** Active applications that share the applicant email, plate number or school ID with a deleted one. */
export async function findDuplicates(registrationId: number) {
    const reg = await loadRegistration(registrationId);
    if (!reg) return [];
    const matches = new Map<number, { registration_id: number; status: string; name: string; plate: string; matched: string[] }>();
    const add = (row: any, why: string) => {
        if (!row || row.registration_id === registrationId || INACTIVE_STATUSES.includes(row.status)) return;
        const entry = matches.get(row.registration_id) ?? {
            registration_id: row.registration_id,
            status: row.status,
            name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
            plate: row.vehicle?.plate_number || '-',
            matched: [] as string[]
        };
        if (!entry.matched.includes(why)) entry.matched.push(why);
        matches.set(row.registration_id, entry);
    };
    const cols = 'registration_id, status, first_name, last_name, vehicle:vehicle_id(plate_number)';

    if (reg.user_id) {
        const { data } = await supabase.from('sticker_application').select(cols).eq('user_id', reg.user_id);
        (data || []).forEach((r) => add(r, 'same applicant email'));
    }
    if (reg.school_id) {
        const { data } = await supabase.from('sticker_application').select(cols).ilike('school_id', reg.school_id);
        (data || []).forEach((r) => add(r, 'same school ID'));
    }
    const plate = (reg.vehicle?.plate_number || '').replace(/[\s-]/g, '').toUpperCase();
    if (plate) {
        const { data: vehicles } = await supabase.from('vehicle').select('vehicle_id, plate_number');
        const ids = (vehicles || [])
            .filter((v) => (v.plate_number || '').replace(/[\s-]/g, '').toUpperCase() === plate)
            .map((v) => v.vehicle_id);
        if (ids.length) {
            const { data } = await supabase.from('sticker_application').select(cols).in('vehicle_id', ids);
            (data || []).forEach((r) => add(r, 'same plate number'));
        }
    }
    return [...matches.values()];
}

/**
 * Restore a deleted registration.
 * mode 'restore': only when there is no duplicate.
 * mode 'replace_new': the duplicate application(s) move to Recently Deleted, then this one is restored.
 */
export async function restoreFromRecycleBin(registrationId: number, mode: 'restore' | 'replace_new', actor: Actor) {
    const { data: bin } = await supabase.from('recycle_bin').select('*').eq('registration_id', registrationId).maybeSingle();
    if (!bin) throw new Error('This record is no longer in Recently Deleted');

    const duplicates = await findDuplicates(registrationId);
    if (duplicates.length && mode !== 'replace_new') {
        return { conflict: true, duplicates };
    }
    for (const dup of duplicates) {
        await moveToRecycleBin(dup.registration_id, `Replaced by restored Reg. No. ${registrationId}`, actor, false);
    }

    const { error } = await supabase.from('sticker_application').update({ status: bin.previous_status }).eq('registration_id', registrationId);
    if (error) throw error;
    await supabase.from('recycle_bin').delete().eq('registration_id', registrationId);
    return { conflict: false, replaced: duplicates.map((d) => d.registration_id) };
}

/** Remove a deleted registration for good. Gate history stays: name and plate are copied onto its gate_log rows. */
export async function permanentlyDelete(registrationId: number) {
    const reg = await loadRegistration(registrationId);
    if (!reg || reg.status !== 'deleted') throw new Error('Only records in Recently Deleted can be permanently deleted');

    await supabase
        .from('gate_log')
        .update({
            // Required by vehicle_log_owner_chk once the registration link is cleared
            owner_name_snapshot: `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || `Deleted applicant (Reg. No. ${registrationId})`,
            plate_snapshot: reg.vehicle?.plate_number || null
        })
        .eq('registration_id', registrationId);

    const files = [reg.school_id_file, reg.doc_load, reg.doc_or, reg.doc_cr, reg.doc_license, reg.doc_letter, reg.payment_receipt_file, reg.qr_image]
        .filter((f): f is string => typeof f === 'string' && /^https?:\/\//.test(f));
    for (const file of files) await deleteFromStorage(file);

    await supabase.from('incident_report').delete().eq('registration_id', registrationId);
    // Cascades: recycle_bin, blocklist, profile_update_request. gate_log rows keep their copied name/plate.
    const { error } = await supabase.from('sticker_application').delete().eq('registration_id', registrationId);
    if (error) throw error;

    if (reg.vehicle_id) {
        const { count } = await supabase
            .from('sticker_application')
            .select('registration_id', { count: 'exact', head: true })
            .eq('vehicle_id', reg.vehicle_id);
        if (!count) await supabase.from('vehicle').delete().eq('vehicle_id', reg.vehicle_id);
    }
}
