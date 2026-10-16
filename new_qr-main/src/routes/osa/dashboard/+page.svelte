<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { invalidateAll } from '$app/navigation';
    import { startLiveSync } from '$lib/utils/liveSync';

    let { data } = $props();

    // Pure realtime WebSocket sync for automatic instant updates without background polling
    $effect(() => {
        return startLiveSync({
            channelName: 'osa-dashboard-realtime',
            tables: ['registration', 'department', 'modification_request']
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


    const statusLabels: Record<string, string> = {
        pending: 'Pending',
        dept_val: 'Dept Validated',
        dept_validated: 'Dept Validated',
        osa_val: 'OSA Validated',
        osa_validated: 'OSA Validated',
        security_checked: 'Security Checked',
        Sticker_Released: 'Sticker Released',
        sticker_released: 'Sticker Released',
        Sticker_Installed: 'Sticker Installed',
        sticker_installed: 'Sticker Installed',
        completed: 'Completed',
        approved: 'Approved',
        rejected: 'Rejected',
        expired: 'Expired',
        revoked: 'Revoked',
        distributed: 'Distributed'
    };

    const maxStatusCount = $derived(Math.max(...Object.values(statusBreakdown), 1));

    // ── Application form open/close control ─────────────────────────────────────
    let formOpen = $state<boolean>(data.applicationOpen !== false);
    let lastUpdatedByEmail = $state<string | null>(data.formStatus?.updatedByEmail || null);
    let formSaving = $state(false);
    let formError = $state('');

    async function setFormOpen(open: boolean) {
        if (formSaving) return;
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
    <NavBar title="Office of Student Affairs Dashboard" />
    
    <div class="dashboard-container">
        <!-- Welcome Banner matching Dashboard Aesthetic -->
        <div class="welcome-banner">
            <div class="wb-content">
                <h1 class="wb-title">Welcome back, Admin!</h1>
                <p class="wb-sub">Here's what's happening with GateQR vehicle sticker operations today.</p>
            </div>
            <div class="wb-icon-shield">
                <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
            </div>
        </div>

        <!-- Application Form Control -->
        <div class="form-control-bar" class:is-closed={!formOpen}>
            <div class="form-control-info">
                <span class="form-status-dot"></span>
                <div>
                    <div class="form-control-title">Application Form: {formOpen ? 'Open' : 'Closed'}</div>
                    <div class="form-control-desc">
                        {formOpen ? 'Applicants can access and submit the application form.' : 'Applicants cannot access the Application form.'}
                    </div>
                    {#if formError}<div class="form-control-error">{formError}</div>{/if}
                </div>
            </div>
            <button class="form-toggle-btn" class:close={formOpen} onclick={() => setFormOpen(!formOpen)} disabled={formSaving}>
                {#if formSaving}Saving…{:else}{formOpen ? 'Close Application' : 'Open Application'}{/if}
            </button>
        </div>
        
        <div class="dashboard-grid">
            <!-- Application Status Breakdown Diagram -->
            <div class="breakdown-section">
                <div class="section-header">
                    <div class="section-title-wrap">
                        <h2>Application Status</h2>
                        <span class="section-total-badge">Total Applications: <strong>{groupedStatus.total}</strong></span>
                    </div>
                </div>

                <div class="diagram-container">
                    <!-- Donut Chart -->
                    <div class="donut-chart-box">
                        <svg class="donut-svg" viewBox="0 0 140 140">
                            <!-- Background Track -->
                            <circle
                                cx="70"
                                cy="70"
                                r="54"
                                fill="none"
                                stroke="#f1f5f9"
                                stroke-width="12"
                            />

                            {#if groupedStatus.total > 0}
                                <!-- Pending Segment (Amber / Gold) -->
                                {#if groupedStatus.pending > 0}
                                    <circle
                                        cx="70"
                                        cy="70"
                                        r="54"
                                        fill="none"
                                        stroke="#f59e0b"
                                        stroke-width="12"
                                        stroke-dasharray="{((groupedStatus.pendingPct / 100) * 339.29)} 339.29"
                                        stroke-dashoffset="0"
                                        class="donut-segment"
                                    />
                                {/if}

                                <!-- Completed Segment (Emerald Green) -->
                                {#if groupedStatus.completed > 0}
                                    <circle
                                        cx="70"
                                        cy="70"
                                        r="54"
                                        fill="none"
                                        stroke="#10b981"
                                        stroke-width="12"
                                        stroke-dasharray="{((groupedStatus.completedPct / 100) * 339.29)} 339.29"
                                        stroke-dashoffset="-{((groupedStatus.pendingPct / 100) * 339.29)}"
                                        class="donut-segment"
                                    />
                                {/if}

                                <!-- Rejected Segment (Rose / Red) -->
                                {#if groupedStatus.rejected > 0}
                                    <circle
                                        cx="70"
                                        cy="70"
                                        r="54"
                                        fill="none"
                                        stroke="#ef4444"
                                        stroke-width="12"
                                        stroke-dasharray="{((groupedStatus.rejectedPct / 100) * 339.29)} 339.29"
                                        stroke-dashoffset="-{(((groupedStatus.pendingPct + groupedStatus.completedPct) / 100) * 339.29)}"
                                        class="donut-segment"
                                    />
                                {/if}
                            {/if}
                        </svg>

                        <div class="donut-center-text">
                            <span class="donut-total">{groupedStatus.total}</span>
                            <span class="donut-sub">Total</span>
                        </div>
                    </div>

                    <!-- Status Items Legend with Percentages -->
                    <div class="status-legend-cards">
                        <!-- Pending -->
                        <div class="legend-card legend-pending">
                            <div class="legend-top">
                                <div class="legend-title-row">
                                    <span class="indicator-dot dot-pending"></span>
                                    <span class="legend-title">Pending</span>
                                </div>
                                <div class="legend-stats">
                                    <span class="legend-pct pct-pending">{groupedStatus.pendingPctFormatted}%</span>
                                    <span class="legend-count">({groupedStatus.pending})</span>
                                </div>
                            </div>
                            <div class="legend-progress-bar">
                                <div class="progress-fill fill-pending" style="width: {groupedStatus.pendingPct}%"></div>
                            </div>
                        </div>

                        <!-- Completed -->
                        <div class="legend-card legend-completed">
                            <div class="legend-top">
                                <div class="legend-title-row">
                                    <span class="indicator-dot dot-completed"></span>
                                    <span class="legend-title">Completed</span>
                                </div>
                                <div class="legend-stats">
                                    <span class="legend-pct pct-completed">{groupedStatus.completedPctFormatted}%</span>
                                    <span class="legend-count">({groupedStatus.completed})</span>
                                </div>
                            </div>
                            <div class="legend-progress-bar">
                                <div class="progress-fill fill-completed" style="width: {groupedStatus.completedPct}%"></div>
                            </div>
                        </div>

                        <!-- Rejected -->
                        <div class="legend-card legend-rejected">
                            <div class="legend-top">
                                <div class="legend-title-row">
                                    <span class="indicator-dot dot-rejected"></span>
                                    <span class="legend-title">Rejected</span>
                                </div>
                                <div class="legend-stats">
                                    <span class="legend-pct pct-rejected">{groupedStatus.rejectedPctFormatted}%</span>
                                    <span class="legend-count">({groupedStatus.rejected})</span>
                                </div>
                            </div>
                            <div class="legend-progress-bar">
                                <div class="progress-fill fill-rejected" style="width: {groupedStatus.rejectedPct}%"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Combined Proportional Ratio Bar at bottom -->
                <div class="stacked-ratio-track" title="Overall Distribution: {groupedStatus.pendingPctFormatted}% Pending | {groupedStatus.completedPctFormatted}% Completed | {groupedStatus.rejectedPctFormatted}% Rejected">
                    {#if groupedStatus.pending > 0}
                        <div class="ratio-segment ratio-pending" style="width: {groupedStatus.pendingPct}%"></div>
                    {/if}
                    {#if groupedStatus.completed > 0}
                        <div class="ratio-segment ratio-completed" style="width: {groupedStatus.completedPct}%"></div>
                    {/if}
                    {#if groupedStatus.rejected > 0}
                        <div class="ratio-segment ratio-rejected" style="width: {groupedStatus.rejectedPct}%"></div>
                    {/if}
                    {#if groupedStatus.total === 0}
                        <div class="ratio-segment ratio-empty" style="width: 100%"></div>
                    {/if}
                </div>
            </div>

            <!-- Recent Applications -->
            <div class="recent-section">
                <div class="section-header">
                    <h2>Recent Activity</h2>
                    <span class="section-badge">Latest</span>
                </div>
                {#if recentApplications.length > 0}
                    <div class="recent-list">
                        {#each recentApplications as app}
                            <div class="recent-item">
                                <div class="recent-info">
                                    <div class="recent-email">{app.user?.email || 'Unknown'}</div>
                                    <div class="recent-dept">{app.department?.department || app.department?.department_name || 'No Department'}</div>
                                </div>
                                <div class="recent-status" class:status-pending={app.status === 'pending'} class:status-dept_val={app.status === 'dept_val'} class:status-osa_val={app.status === 'osa_val'} class:status-distributed={app.status === 'distributed'} class:status-completed={app.status === 'completed'} class:status-rejected={app.status === 'rejected'} class:status-revoked={app.status === 'revoked'}>
                                    {statusLabels[app.status] || app.status}
                                </div>
                            </div>
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
        padding: 1.75rem 2.25rem;
        color: #ffffff;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 10px 25px -5px rgba(122, 23, 52, 0.35);
        border: 1px solid rgba(233, 194, 94, 0.25);
        margin-bottom: 1.5rem;
        position: relative;
        overflow: hidden;
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

    .wb-icon-shield {
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.85;
    }

    /* Application form open/close control */
    .form-control-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        padding: var(--space-md) var(--space-lg);
        margin-bottom: var(--space-lg);
        background: #fffdf5;
        border: 1.5px solid #fde68a;
        border-radius: var(--radius-lg);
    }

    .form-control-bar.is-closed {
        background: #FEF2F2;
        border-color: #FCA5A5;
    }

    .form-control-info {
        display: flex;
        align-items: center;
        gap: var(--space-md);
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

    .form-control-title {
        font-weight: 700;
        font-size: 0.95rem;
        color: var(--text-primary);
    }

    .form-control-desc {
        font-size: 0.8rem;
        color: var(--text-secondary);
    }

    .form-control-error {
        font-size: 0.8rem;
        color: #B91C1C;
        margin-top: 2px;
    }

    .form-toggle-btn {
        padding: 0.6rem 1.25rem;
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

    .section-title-wrap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .section-total-badge {
        font-size: 0.85rem;
        color: #64748b;
        background: #f8fafc;
        padding: 0.35rem 0.85rem;
        border-radius: 999px;
        border: 1px solid #e2e8f0;
    }

    .section-total-badge strong {
        color: #7A1734;
        font-weight: 800;
        margin-left: 0.25rem;
    }

    .diagram-container {
        display: flex;
        align-items: center;
        gap: 1.75rem;
        margin-bottom: 1.25rem;
    }

    @media (max-width: 640px) {
        .diagram-container {
            flex-direction: column;
            text-align: center;
        }
    }

    .donut-chart-box {
        position: relative;
        width: 130px;
        height: 130px;
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
        font-size: 1.5rem;
        font-weight: 800;
        color: #1e293b;
        line-height: 1.1;
    }

    .donut-sub {
        font-size: 0.68rem;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .status-legend-cards {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
    }

    .legend-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 0.65rem 0.85rem;
        transition: all 0.2s ease;
    }

    .legend-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    }

    .legend-card.legend-pending:hover {
        border-color: #fde68a;
        background: #fffdf5;
    }

    .legend-card.legend-completed:hover {
        border-color: #a7f3d0;
        background: #f0fdf4;
    }

    .legend-card.legend-rejected:hover {
        border-color: #fca5a5;
        background: #fef2f2;
    }

    .legend-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.4rem;
    }

    .legend-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .indicator-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .dot-pending {
        background: #f59e0b;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
    }

    .dot-completed {
        background: #10b981;
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .dot-rejected {
        background: #ef4444;
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
    }

    .legend-title {
        font-size: 0.82rem;
        font-weight: 600;
        color: #334155;
    }

    .legend-stats {
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
    }

    .legend-pct {
        font-size: 0.9rem;
        font-weight: 800;
    }

    .pct-pending {
        color: #b45309;
    }

    .pct-completed {
        color: #047857;
    }

    .pct-rejected {
        color: #b91c1c;
    }

    .legend-count {
        font-size: 0.75rem;
        font-weight: 600;
        color: #64748b;
    }

    .legend-progress-bar {
        height: 5px;
        background: #e2e8f0;
        border-radius: 999px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .fill-pending {
        background: linear-gradient(90deg, #f59e0b, #fbbf24);
    }

    .fill-completed {
        background: linear-gradient(90deg, #10b981, #34d399);
    }

    .fill-rejected {
        background: linear-gradient(90deg, #ef4444, #f87171);
    }

    .stacked-ratio-track {
        display: flex;
        height: 7px;
        background: #f1f5f9;
        border-radius: 999px;
        overflow: hidden;
        gap: 2px;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .ratio-segment {
        height: 100%;
        transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .ratio-pending {
        background: #f59e0b;
    }

    .ratio-completed {
        background: #10b981;
    }

    .ratio-rejected {
        background: #ef4444;
    }

    .ratio-empty {
        background: #e2e8f0;
    }

    .recent-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
    }

    .recent-item {
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

    .recent-email {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-primary);
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

    .recent-status.status-dept_val {
        background: #EFF6FF;
        color: #3B82F6;
        border: 1px solid #BFDBFE;
    }

    .recent-status.status-osa_val {
        background: #F3E8FF;
        color: #7C3AED;
        border: 1px solid #DDD6FE;
    }

    .recent-status.status-distributed {
        background: #ECFDF5;
        color: #047857;
        border: 1px solid #A7F3D0;
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

        .wb-sub {
            font-size: 0.825rem;
        }

        .wb-icon-shield {
            display: none;
        }

        .form-control-bar {
            flex-direction: column;
            align-items: stretch;
            gap: 0.75rem;
            padding: 1rem;
        }

        .form-control-info {
            width: 100%;
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