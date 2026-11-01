<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import { page } from '$app/stores';
    import { askConfirm } from '$lib/utils/dialog';
    import { startLiveSync } from '$lib/utils/liveSync';

    let { data } = $props();

    // Pure realtime WebSocket sync for automatic instant updates without background polling
    $effect(() => {
        return startLiveSync({
            channelName: 'osa-dashboard-realtime',
            tables: ['sticker_application', 'department', 'profile_update_request', 'recycle_bin']
        });
    });

    const navLinks = [
        { label: 'Add Admin', href: '/osa/admin' },
        { label: 'Departments', href: '/osa/departments' }
    ];

    // ── OSA Stats ────────────────────────────────────────────────────────────────
    let statsData = $derived((data.stats as any) || { 
        totalApplications: 0, 
        pendingValidation: 0, 
        pendingDistribution: 0, 
        completedToday: 0, 
        rejectedToday: 0, 
        totalDepartments: 0 
    });
    let statusBreakdown = $derived((data.statusBreakdown as Record<string, number>) || {
        pending: 0, dept_val: 0, osa_val: 0, distributed: 0, completed: 0, rejected: 0, revoked: 0
    });

    const groupedStatus = $derived.by(() => {
        const raw = statusBreakdown || {};
        let pending = 0;
        let completed = 0;
        let rejected = 0;

        for (const [stKey, countVal] of Object.entries(raw)) {
            const k = stKey.toLowerCase();
            const count = Number(countVal) || 0;
            if (['completed', 'approved', 'sticker_installed'].includes(k)) {
                completed += count;
            } else if (['rejected', 'revoked'].includes(k)) {
                rejected += count;
            } else {
                pending += count;
            }
        }

        const total = pending + completed + rejected;
        const pendingPct = total > 0 ? (pending / total) * 100 : 0;
        const completedPct = total > 0 ? (completed / total) * 100 : 0;
        const rejectedPct = total > 0 ? (rejected / total) * 100 : 0;

        return {
            pending,
            completed,
            rejected,
            total,
            pendingPct,
            completedPct,
            rejectedPct,
            pendingPctFormatted: pendingPct % 1 === 0 ? pendingPct.toFixed(0) : pendingPct.toFixed(1),
            completedPctFormatted: completedPct % 1 === 0 ? completedPct.toFixed(0) : completedPct.toFixed(1),
            rejectedPctFormatted: rejectedPct % 1 === 0 ? rejectedPct.toFixed(0) : rejectedPct.toFixed(1)
        };
    });
    let recentApplications = $derived(data.recentApplications || []);


    // Recent Activity: the stage each application is at, in plain words
    function getStageLabel(app: any): { label: string; tone: string } {
        const s = (app.status || '').toLowerCase();
        if (['pending', 'dept_val', 'dept_validated', 'osa_val'].includes(s)) return { label: 'Screening', tone: 'pending' };
        if (s === 'osa_validated' || (s === 'distributed' && !app.hardcopy_received_at)) return { label: 'Hardcopy Submission', tone: 'pending' };
        if (s === 'distributed') return { label: 'Security Review', tone: 'review' };
        if (s === 'security_checked') return { label: 'For Payment', tone: 'review' };
        if (s === 'receipt_submitted') return { label: 'For Release', tone: 'review' };
        if (['completed', 'approved', 'sticker_installed', 'sticker_released'].includes(s)) return { label: 'Registered', tone: 'completed' };
        if (s === 'rejected') return { label: 'Rejected', tone: 'rejected' };
        if (s === 'revoked') return { label: 'Revoked', tone: 'revoked' };
        if (s === 'expired') return { label: 'Expired', tone: 'revoked' };
        return { label: app.status || 'Unknown', tone: 'pending' };
    }

    // Where each Recent Activity row opens (the matching OSA Applications tab)
    function getAppHref(app: any): string {
        const s = (app.status || '').toLowerCase();
        if (['pending', 'dept_val', 'dept_validated', 'osa_val'].includes(s)) return '/osa?tab=validation';
        if (['distributed', 'osa_validated'].includes(s) && !app.hardcopy_received_at) return '/osa?tab=distribution';
        if (s === 'receipt_submitted') return '/osa?tab=release';
        if (['completed', 'approved'].includes(s)) return '/osa?tab=registered';
        if (['rejected', 'revoked'].includes(s)) return '/osa?tab=rejected';
        return '/osa';
    }

    function applicantName(app: any): string {
        const name = `${app.first_name || ''} ${app.last_name || ''}`.trim();
        return name || app.user?.email || 'Applicant';
    }

    function timeAgo(value: string | null | undefined): string {
        if (!value) return '';
        const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // Needs-action tiles: each opens the page where that work is done
    let actionCounts = $derived((data.actionCounts as any) || { screening: 0, hardcopy: 0, release: 0, profileUpdates: 0, recentlyDeleted: 0 });
    let actionTiles = $derived([
        { label: 'Screening', count: actionCounts.screening, href: '/osa?tab=validation', color: '#D4A62A' },
        { label: 'Hardcopy submission', count: actionCounts.hardcopy, href: '/osa?tab=distribution', color: '#3B82F6' },
        { label: 'Ready for release', count: actionCounts.release, href: '/osa?tab=release', color: '#10B981' },
        { label: 'Profile updates', count: actionCounts.profileUpdates, href: '/osa/change-requests', color: '#8B5CF6' },
        { label: 'Recently deleted', count: actionCounts.recentlyDeleted, href: '/osa/recently-deleted', color: '#EF4444' }
    ]);

    // Ring chart segments (circumference of r=54 is 339.29)
    const RING = 2 * Math.PI * 54;
    let ringSegments = $derived.by(() => {
        const parts = [
            { label: 'Pending', count: groupedStatus.pending, color: '#F59E0B' },
            { label: 'Completed', count: groupedStatus.completed, color: '#10B981' },
            { label: 'Rejected', count: groupedStatus.rejected, color: '#EF4444' }
        ];
        let offset = 0;
        return parts.map((part) => {
            const length = groupedStatus.total > 0 ? (part.count / groupedStatus.total) * RING : 0;
            const seg = { ...part, length, offset };
            offset += length;
            return seg;
        });
    });

    let firstName = $derived(String(($page.data as any)?.userName || '').trim().split(/\s+/)[0] || 'Admin');

    // ── Application form open/close control ─────────────────────────────────────
    let formOpen = $state<boolean>(data.applicationOpen !== false);
    let lastUpdatedByEmail = $state<string | null>(data.formStatus?.updatedByEmail || null);
    let formSaving = $state(false);
    let formError = $state('');

    async function setFormOpen(open: boolean) {
        if (formSaving) return;
        if (!open) {
            const ok = await askConfirm('Applicants will not be able to open or submit the application form until you open it again.', {
                title: 'Close the application form?',
                confirmLabel: 'Close form',
                danger: true
            });
            if (!ok) return;
        }
        formSaving = true;
        formError = '';
        try {
            const res = await fetch('/api/osa/application-form', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ open })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to update');
            formOpen = result.open;
            if (result.updatedByEmail) {
                lastUpdatedByEmail = result.updatedByEmail;
            }
        } catch (e: any) {
            formError = e.message || 'Failed to update';
        } finally {
            formSaving = false;
        }
    }
</script>

<AppShell userEmail={data.userEmail} showSidebar={true}>
    <div class="dashboard-container">
        <!-- Header: greeting plus the application form switch -->
        <div class="welcome-banner">
            <div class="wb-content">
                <h1 class="wb-title">Welcome back, {firstName}!</h1>
                <p class="wb-sub">Office of Student Affairs dashboard</p>
            </div>
            <div class="form-switch" class:is-closed={!formOpen}>
                <span class="form-status-dot"></span>
                <span class="form-switch-label">Application form: <strong>{formOpen ? 'Open' : 'Closed'}</strong></span>
                <button class="form-toggle-btn" class:close={formOpen} onclick={() => setFormOpen(!formOpen)} disabled={formSaving}>
                    {#if formSaving}Saving…{:else}{formOpen ? 'Close' : 'Open'}{/if}
                </button>
            </div>
        </div>
        {#if formError}<p class="form-control-error">{formError}</p>{/if}

        <!-- Needs action -->
        <div class="action-tiles">
            {#each actionTiles as tile (tile.label)}
                <a class="action-tile" href={tile.href} style="--tile-color: {tile.color};">
                    <span class="action-count">{tile.count}</span>
                    <span class="action-label">{tile.label}</span>
                </a>
            {/each}
        </div>

        <div class="dashboard-grid">
            <!-- Application Status -->
            <div class="breakdown-section">
                <div class="section-header">
                    <h2>Application Status</h2>
                </div>
                <div class="diagram-container">
                    <div class="donut-chart-box">
                        <svg class="donut-svg" viewBox="0 0 140 140">
                            <circle cx="70" cy="70" r="54" fill="none" stroke="#f1f5f9" stroke-width="12" />
                            {#each ringSegments as seg (seg.label)}
                                {#if seg.length > 0}
                                    <circle
                                        cx="70"
                                        cy="70"
                                        r="54"
                                        fill="none"
                                        stroke={seg.color}
                                        stroke-width="12"
                                        stroke-dasharray="{seg.length} {RING}"
                                        stroke-dashoffset={-seg.offset}
                                        class="donut-segment"
                                    />
                                {/if}
                            {/each}
                        </svg>
                        <div class="donut-center-text">
                            <span class="donut-total">{groupedStatus.total}</span>
                            <span class="donut-sub">Total</span>
                        </div>
                    </div>
                    <ul class="status-legend">
                        {#each ringSegments as seg (seg.label)}
                            <li>
                                <span class="legend-dot" style="background: {seg.color};"></span>
                                <span class="legend-name">{seg.label}</span>
                                <strong class="legend-num">{seg.count}</strong>
                            </li>
                        {/each}
                    </ul>
                </div>
            </div>

            <!-- Recent Activity -->
            <div class="recent-section">
                <div class="section-header">
                    <h2>Recent Activity</h2>
                </div>
                {#if recentApplications.length > 0}
                    <div class="recent-list">
                        {#each recentApplications as app}
                            {@const stage = getStageLabel(app)}
                            <a class="recent-item" href={getAppHref(app)}>
                                <div class="recent-info">
                                    <div class="recent-name">{applicantName(app)}</div>
                                    <div class="recent-dept">
                                        {app.department?.department_name || 'No Department'}
                                        {#if app.created_at}<span class="recent-time"> · {timeAgo(app.created_at)}</span>{/if}
                                    </div>
                                </div>
                                <div class="recent-status status-{stage.tone}">
                                    {stage.label}
                                </div>
                            </a>
                        {/each}
                    </div>
                {:else}
                    <div class="no-data">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="12" y1="18" x2="12" y2="12"/>
                            <line x1="9" y1="15" x2="15" y2="15"/>
                        </svg>
                        <p>No recent applications</p>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</AppShell>

<style>
    .dashboard-container {
        padding: var(--space-xl);
        max-width: 1400px;
        margin: 0 auto;
    }

    /* Welcome Banner matching Dashboard aesthetic */
    .welcome-banner {
        background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
        border-radius: 18px;
        padding: 1.1rem 1.5rem;
        color: #ffffff;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 10px 25px -5px rgba(122, 23, 52, 0.35);
        border: 1px solid rgba(233, 194, 94, 0.25);
        margin-bottom: 1rem;
        position: relative;
        overflow: hidden;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .wb-content {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        z-index: 1;
    }

    .wb-title {
        font-size: 1.5rem;
        font-weight: 800;
        color: #E9C25E;
        margin: 0;
        letter-spacing: -0.01em;
    }

    .wb-sub {
        font-size: 0.9rem;
        color: #F5D5DE;
        margin: 0;
        font-weight: 500;
    }

    .form-switch {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.45rem 0.5rem 0.45rem 0.9rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
    }

    .form-switch-label {
        font-size: 0.85rem;
        color: #F5D5DE;
    }

    .form-switch-label strong {
        color: #ffffff;
    }

    .form-status-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #D4A62A;
        box-shadow: 0 0 0 4px rgba(212, 166, 42, 0.2);
        flex-shrink: 0;
    }

    .is-closed .form-status-dot {
        background: #DC2626;
        box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.2);
    }

    .form-control-error {
        font-size: 0.8rem;
        color: #B91C1C;
        margin-top: 2px;
    }

    .form-toggle-btn {
        padding: 0.4rem 1rem;
        border-radius: 999px !important;
        border: none;
        border-radius: var(--radius-md);
        font-size: 0.85rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        color: #3D0818;
        background: linear-gradient(135deg, #F0CF72, #D4A62A);
        white-space: nowrap;
        transition: opacity 0.2s, transform 0.2s;
    }

    .form-toggle-btn.close {
        background: #DC2626;
    }

    .form-toggle-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        opacity: 0.92;
    }

    .form-toggle-btn:disabled {
        opacity: 0.6;
        cursor: wait;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
    }

    .stat-card {
        background: #ffffff;
        border-radius: 16px;
        padding: 1.5rem;
        display: flex;
        align-items: center;
        gap: 1.25rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
        border: 1px solid rgba(0,0,0,0.02);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
    }

    .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
    }

    .stat-left {
        flex-shrink: 0;
    }

    .stat-icon-circle {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .stat-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .stat-value {
        font-size: 1.5rem;
        font-weight: 800;
        color: #1a202c;
        line-height: 1.1;
        margin-bottom: 6px;
        font-family: 'Inter', sans-serif;
    }

    .stat-label {
        font-size: 0.8rem;
        font-weight: 500;
        color: #718096;
    }

    .stat-more {
        position: absolute;
        top: 1rem;
        right: 1rem;
        cursor: pointer;
        opacity: 0.7;
    }

    .stat-more:hover {
        opacity: 1;
    }

    .action-tiles {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.75rem;
        margin-bottom: 1rem;
    }

    .action-tile {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.85rem 1rem;
        background: #ffffff;
        border-radius: 14px;
        border-left: 4px solid var(--tile-color);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
        text-decoration: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .action-tile:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.06);
    }

    .action-count {
        font-size: 1.5rem;
        font-weight: 800;
        color: #1e293b;
        line-height: 1.1;
    }

    .action-label {
        font-size: 0.78rem;
        font-weight: 600;
        color: #64748b;
    }

    .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-lg);
    }

    .breakdown-section,
    .recent-section {
        background: #ffffff;
        border: 1px solid rgba(0,0,0,0.02);
        border-radius: 16px;
        padding: 1.75rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
    }

    /* Status card fills the height set by Recent Activity, with the ring centred */
    .breakdown-section {
        display: flex;
        flex-direction: column;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    }

    .section-header h2 {
        font-size: 1.15rem;
        font-weight: 700;
        color: #1a202c;
        margin: 0;
    }

    .diagram-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2.5rem;
        padding: 0.5rem 0 1rem;
    }

    @media (max-width: 640px) {
        .diagram-container {
            flex-direction: column;
            gap: 1.25rem;
        }

        .donut-chart-box {
            width: min(60%, 200px);
        }

        .status-legend {
            width: 100%;
            max-width: none;
        }
    }

    .donut-chart-box {
        position: relative;
        width: clamp(150px, 40%, 230px);
        aspect-ratio: 1;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .donut-svg {
        width: 100%;
        height: 100%;
        overflow: visible;
        transform: rotate(-90deg);
    }

    .donut-segment {
        transition: stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1), stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .donut-center-text {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        pointer-events: none;
    }

    .donut-total {
        font-size: 2.4rem;
        font-weight: 800;
        color: #1e293b;
        line-height: 1.1;
    }

    .donut-sub {
        font-size: 0.78rem;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .status-legend {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1;
        max-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .status-legend li {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.55rem 0;
        border-bottom: 1px solid #f1f5f9;
        font-size: 1rem;
        color: #475569;
    }

    .legend-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .status-legend li:last-child {
        border-bottom: none;
    }

    .legend-num {
        margin-left: auto;
        font-size: 1.15rem;
        color: #1e293b;
    }

    .recent-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
    }

    .recent-item {
        text-decoration: none;
        color: inherit;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 0;
        background: #ffffff;
        border-bottom: 1px solid #f1f5f9;
        transition: all 0.2s;
    }

    .recent-item:last-child {
        border-bottom: none;
    }

    .recent-item:hover {
        background: #f8fafc;
        transform: translateX(4px);
        padding-left: 0.5rem;
        padding-right: 0.5rem;
        border-radius: 8px;
    }

    .recent-info {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
    }

    .recent-name {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .recent-time {
        color: #94a3b8;
    }

    .recent-dept {
        font-size: 0.75rem;
        color: var(--text-muted);
    }

    .recent-status {
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .recent-status.status-pending {
        background: #FFFBEB;
        color: #B45309;
        border: 1px solid #FDE68A;
    }

    .recent-status.status-review {
        background: #EFF6FF;
        color: #1D4ED8;
        border: 1px solid #BFDBFE;
    }

    .recent-status.status-completed {
        background: #D1FAE5;
        color: #047857;
        border: 1px solid #6EE7B7;
    }

    .recent-status.status-rejected {
        background: #FEF2F2;
        color: #B91C1C;
        border: 1px solid #FCA5A5;
    }

    .recent-status.status-revoked {
        background: #FFF7ED;
        color: #C2410C;
        border: 1px solid #FED7AA;
    }

    .no-data {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-2xl);
        color: var(--text-muted);
        gap: var(--space-md);
    }

    .no-data svg {
        color: var(--border);
    }

    .no-data p {
        font-size: 0.9rem;
        font-weight: 500;
        margin: 0;
    }

    @media (max-width: 1024px) {
        .dashboard-container {
            padding: 1rem;
        }

        .dashboard-grid {
            grid-template-columns: 1fr;
        }

        .action-tiles {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .stats-grid {
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
    }

    @media (max-width: 768px) {
        .dashboard-container {
            padding: 0.75rem 0.5rem;
            gap: 1rem;
        }

        .welcome-banner {
            padding: 1.25rem 1.25rem;
            border-radius: 14px;
        }

        .wb-title {
            font-size: 1.25rem;
        }

        .form-switch {
            width: 100%;
            justify-content: space-between;
            box-sizing: border-box;
        }

        .action-tiles {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .wb-sub {
            font-size: 0.825rem;
        }

        .form-toggle-btn {
            width: 100%;
            text-align: center;
            justify-content: center;
        }

        .stats-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
        }

        .stat-card {
            padding: 1.25rem;
        }
    }

    @media (max-width: 480px) {
        .dashboard-container {
            padding: 0.5rem 0.25rem;
        }

        .stat-icon-circle {
            width: 46px;
            height: 46px;
        }

        .stat-value {
            font-size: 1.35rem;
        }

        .breakdown-section, .recent-section {
            padding: 1rem 0.85rem;
            border-radius: 12px;
        }

        .recent-item {
            padding: 0.75rem 0;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.4rem;
        }

        .recent-status {
            align-self: flex-start;
        }
    }
</style>