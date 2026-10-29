import { supabase } from './supabase';

export interface ActiveBlock {
    blocked_until: string;
    reason: string;
    block_by: string;
}

/** Gate blocks (3rd violation level) still in force, keyed by registration_id. */
export async function getActiveBlocks(): Promise<Map<number, ActiveBlock>> {
    const map = new Map<number, ActiveBlock>();
    const { data, error } = await supabase
        .from('blocklist')
        .select('registration_id, blocked_until, reason, block_by')
        .eq('violation_level', 'gate_block')
        .gt('blocked_until', new Date().toISOString())
        .order('blocked_until', { ascending: false });
    if (error) {
        console.error('[Blocks] Failed to load active gate blocks:', error);
        return map;
    }
    for (const row of data || []) {
        // Keep the longest-running block per registration
        if (row.registration_id && !map.has(row.registration_id)) {
            map.set(row.registration_id, { blocked_until: row.blocked_until, reason: row.reason, block_by: row.block_by });
        }
    }
    return map;
}
