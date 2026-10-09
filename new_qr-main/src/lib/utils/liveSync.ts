import { invalidateAll } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

export interface LiveSyncOptions {
    channelName: string;
    tables: string[];
    intervalMs?: number;
    onSync?: () => void;
}

/**
 * Universal dual-engine live sync utility:
 * 1. Supabase Realtime WebSocket push
 * 2. Silent background heartbeat auto-refresh (default 5s)
 * 3. Instant tab visibility / focus sync
 */
export function startLiveSync(options: LiveSyncOptions) {
    const { channelName, tables, intervalMs = 5000, onSync } = options;

    let isDestroyed = false;

    const triggerSync = () => {
        if (isDestroyed) return;
        invalidateAll();
        if (onSync) {
            try {
                onSync();
            } catch (err) {
                console.error('[LiveSync] onSync callback error:', err);
            }
        }
    };

    // 1. Realtime WebSocket listener
    let channel = supabaseClient.channel(channelName);
    for (const table of tables) {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
            triggerSync();
        });
    }
    channel.subscribe();

    // 2. Background polling heartbeat timer (only runs when tab is active to preserve resources)
    const timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            triggerSync();
        }
    }, intervalMs);

    // 3. Instant sync when user tabs back or focuses window
    const handleVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            triggerSync();
        }
    };

    const handleFocus = () => {
        triggerSync();
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);
    }

    // Return cleanup function for Svelte $effect teardown
    return () => {
        isDestroyed = true;
        clearInterval(timer);
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        }
        supabaseClient.removeChannel(channel);
    };
}
