import { invalidateAll } from '$app/navigation';
import { supabaseClient } from '$lib/supabaseClient';

export interface LiveSyncOptions {
    channelName: string;
    tables: string[];
    intervalMs?: number;
    onSync?: () => void;
}

/**
 * Pure Realtime live sync utility:
 * 1. Supabase Realtime WebSocket push on database changes (INSERT/UPDATE/DELETE)
 * 2. Instant tab visibility / focus sync (refreshes when returning to the tab)
 * 3. Optional polling heartbeat (disabled by default, only runs if intervalMs > 0 is provided)
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

    // 2. Background polling heartbeat timer (only runs if intervalMs > 0 is explicitly specified)
    let timer: ReturnType<typeof setInterval> | null = null;
    if (intervalMs && intervalMs > 0) {
        timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                triggerSync();
            }
        }, intervalMs);
    }

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
        if (timer) {
            clearInterval(timer);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        }
        supabaseClient.removeChannel(channel);
    };
}
