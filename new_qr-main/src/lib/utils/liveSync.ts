import { invalidateAll } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface LiveSyncOptions {
    channelName: string;
    tables: string[];
    onSync?: () => void;
    /** Set to false when onSync decides itself whether to reload (e.g. skip while a form is being edited). */
    invalidate?: boolean;
}

/** Broadcast topic/event fed by the `gateqr_broadcast_change` trigger in supabase-schema-complete.sql */
const SYNC_TOPIC = 'gateqr-sync';
const SYNC_EVENT = 'db_change';

// One shared broadcast subscription for the whole app; pages register listeners on it.
type ChangeListener = (table: string | undefined) => void;
const listeners = new Set<ChangeListener>();
let broadcastChannel: RealtimeChannel | null = null;

function addBroadcastListener(listener: ChangeListener) {
    listeners.add(listener);
    if (!broadcastChannel) {
        broadcastChannel = supabaseClient
            .channel(SYNC_TOPIC)
            .on('broadcast', { event: SYNC_EVENT }, ({ payload }) => {
                for (const l of listeners) l(payload?.table);
            });
        broadcastChannel.subscribe();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && broadcastChannel) {
            supabaseClient.removeChannel(broadcastChannel);
            broadcastChannel = null;
        }
    };
}

/**
 * Realtime-only live sync (no polling, no refresh on focus):
 * 1. Supabase Realtime `postgres_changes` (delivered when RLS lets this client read the table)
 * 2. Supabase Realtime broadcast from the database trigger, which carries only the table name and
 *    operation, so it reaches every dashboard even though the browser client uses the anon key.
 * Bursts of changes (one action touching several tables) are coalesced into a single reload.
 */
export function startLiveSync(options: LiveSyncOptions) {
    const { channelName, tables, onSync, invalidate = true } = options;

    let isDestroyed = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const watched = new Set(tables);

    const triggerSync = () => {
        if (isDestroyed || pending) return;
        pending = setTimeout(() => {
            pending = null;
            if (isDestroyed) return;
            if (invalidate) invalidateAll();
            if (onSync) {
                try {
                    onSync();
                } catch (err) {
                    console.error('[LiveSync] onSync callback error:', err);
                }
            }
        }, 250);
    };

    let channel = supabaseClient.channel(channelName);
    for (const table of tables) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, triggerSync);
    }
    channel.subscribe();

    const removeBroadcastListener = addBroadcastListener((table) => {
        if (!table || watched.has(table)) triggerSync();
    });

    return () => {
        isDestroyed = true;
        if (pending) clearTimeout(pending);
        supabaseClient.removeChannel(channel);
        removeBroadcastListener();
    };
}
