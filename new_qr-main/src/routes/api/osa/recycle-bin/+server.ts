import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import {
    PRIMARY_OSA_EMAIL,
    findDuplicates,
    isPrimaryOsa,
    permanentlyDelete,
    restoreFromRecycleBin
} from '$lib/server/recycleBin';

// Recently Deleted: every OSA admin can view; only the primary OSA administrator can restore or purge.
export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data, error } = await supabase
        .from('recycle_bin')
        .select(`
            registration_id, previous_status, reason, deleted_by_role, deleted_by_email, deleted_at, snapshot,
            registration:registration_id(
                first_name, last_name, role, school_id,
                user:user_id(email),
                vehicle_information:vehicle_information_id(plate_number, brand, color, type)
            )
        `)
        .order('deleted_at', { ascending: false });

    if (error) {
        console.error('[Recycle bin] Load failed:', error);
        return json({ error: 'Could not load Recently Deleted.' }, { status: 500 });
    }

    const items = await Promise.all(
        (data || []).map(async (row: any) => {
            const reg = row.registration || row.snapshot?.registration || {};
            const vehicle = row.registration?.vehicle_information || row.snapshot?.vehicle || {};
            return {
                registration_id: row.registration_id,
                name: `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || 'Unknown applicant',
                email: row.registration?.user?.email || row.snapshot?.applicant_email || null,
                role: reg.role || null,
                school_id: reg.school_id || null,
                plate: vehicle.plate_number || null,
                vehicle: [vehicle.brand, vehicle.color].filter(Boolean).join(' · ') || null,
                vehicle_type: vehicle.type || null,
                previous_status: row.previous_status,
                reason: row.reason,
                deleted_by_role: row.deleted_by_role,
                deleted_by_email: row.deleted_by_email,
                deleted_at: row.deleted_at,
                duplicates: await findDuplicates(row.registration_id)
            };
        })
    );

    return json({ canManage: isPrimaryOsa(locals.user), primaryEmail: PRIMARY_OSA_EMAIL, items });
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!isPrimaryOsa(locals.user)) {
        return json({ error: `Only the primary OSA administrator (${PRIMARY_OSA_EMAIL}) can restore or permanently delete records.` }, { status: 403 });
    }

    try {
        const { action, registration_id, mode } = await request.json();
        const id = Number(registration_id);
        if (!id) return json({ error: 'Missing registration number.' }, { status: 400 });

        const actor = { user_id: locals.user!.user_id, email: locals.user!.email, role: locals.user!.role };

        if (action === 'restore') {
            const result = await restoreFromRecycleBin(id, mode === 'replace_new' ? 'replace_new' : 'restore', actor);
            if (result.conflict) {
                return json({ conflict: true, duplicates: result.duplicates }, { status: 409 });
            }
            const replaced = result.replaced || [];
            return json({
                message: replaced.length
                    ? `Reg. No. ${id} was restored. The newer application${replaced.length > 1 ? 's' : ''} (Reg. No. ${replaced.join(', ')}) moved to Recently Deleted.`
                    : `Reg. No. ${id} was restored to its previous status.`
            });
        }

        if (action === 'purge') {
            await permanentlyDelete(id);
            return json({ message: `Reg. No. ${id} was permanently deleted. Its gate history was kept.` });
        }

        return json({ error: 'Invalid action.' }, { status: 400 });
    } catch (err: any) {
        console.error('[Recycle bin] Action failed:', err);
        return json({ error: err?.message || 'The action failed. Please try again.' }, { status: 500 });
    }
};
