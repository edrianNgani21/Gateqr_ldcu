import { supabase } from '$lib/server/supabase';

export interface FormStatusResult {
    open: boolean;
    updatedByEmail?: string | null;
    updatedAt?: string | null;
}

/** Returns whether applicants may currently access/submit the application form. Defaults to open. */
export async function isApplicationFormOpen(): Promise<boolean> {
    try {
        const status = await getApplicationFormStatus();
        return status.open;
    } catch {
        return true;
    }
}

/** Gets the detailed application form status including who updated it last. */
export async function getApplicationFormStatus(): Promise<FormStatusResult> {
    try {
        const { data, error } = await supabase
            .from('application_form_settings')
            .select('*')
            .order('application_form_settings_id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !data) return { open: true };

        // Handle standard schema: status = 'open' | 'closed'
        if (data.status !== undefined && data.status !== null) {
            return {
                open: (data.status || '').toLowerCase() !== 'closed',
                updatedByEmail: data.updated_by || null,
                updatedAt: data.updated_at || null
            };
        }

        // Fallback for key-value schema: value = 'true' | 'false'
        if (data.value !== undefined && data.value !== null) {
            return {
                open: data.value !== 'false',
                updatedByEmail: data.updated_by_email || data.updated_by || null,
                updatedAt: data.updated_at || null
            };
        }

        return { open: true };
    } catch {
        return { open: true };
    }
}

/** Opens or closes the application form, recording the user ID and email of the admin who performed the change. */
export async function setApplicationFormOpen(open: boolean, userId?: number, userEmail?: string): Promise<FormStatusResult> {
    const updatedAt = new Date().toISOString();
    const statusVal = open ? 'open' : 'closed';
    const emailVal = userEmail || 'System';

    // Check existing record in application_form_settings
    const { data: existing, error: fetchErr } = await supabase
        .from('application_form_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

    if (fetchErr) {
        console.error('[ApplicationForm] fetch error:', fetchErr);
    }

    if (existing && existing.application_form_settings_id !== undefined) {
        // Update standard database schema
        const { error: updateErr } = await supabase
            .from('application_form_settings')
            .update({
                status: statusVal,
                updated_by: emailVal,
                updated_at: updatedAt,
                user_id: userId || null
            })
            .eq('application_form_settings_id', existing.application_form_settings_id);

        if (updateErr) {
            console.error('[ApplicationForm] update error:', updateErr);
            throw updateErr;
        }
    } else if (existing && (existing as any).key !== undefined) {
        // Update key-value schema
        const { error: upsertErr } = await supabase
            .from('application_form_settings')
            .upsert({
                key: 'application_form_open',
                value: open ? 'true' : 'false',
                updated_by: userId,
                updated_by_email: emailVal,
                updated_at: updatedAt
            }, { onConflict: 'key' });

        if (upsertErr) throw upsertErr;
    } else {
        // Insert new initial row into standard schema
        const { error: insertErr } = await supabase
            .from('application_form_settings')
            .insert({
                status: statusVal,
                updated_by: emailVal,
                updated_at: updatedAt,
                user_id: userId || null
            });

        if (insertErr) {
            // Fallback key-value insert if standard table doesn't match
            const { error: fallbackErr } = await supabase
                .from('application_form_settings')
                .insert({
                    key: 'application_form_open',
                    value: open ? 'true' : 'false',
                    updated_by: userId,
                    updated_by_email: emailVal,
                    updated_at: updatedAt
                });
            if (fallbackErr) throw fallbackErr;
        }
    }

    return {
        open,
        updatedByEmail: emailVal,
        updatedAt
    };
}
