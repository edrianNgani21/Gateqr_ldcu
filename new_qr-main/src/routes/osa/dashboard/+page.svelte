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
            tables: ['registration', 'department', 'change_vehicle_request']
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
    let recentApplications = $derived(data.recentApplications || []);

    const statCards = $derived([
        {
            label: 'Total Applications',
            value: statsData.totalApplications,
            desc: 'Accept and Schedule Application tab',
            icon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>`,
            color: 'var(--maroon)',
            bg: 'var(--maroon-muted)',
            border: 'var(--maroon-tint)'
        },
        {
            label: 'Pending Application',
            value: statsData.pendingValidation,
            desc: 'Hardcopy Compliance and Document Review',
            icon: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
            color: 'var(--gold)',
            bg: 'var(--gold-muted)',
            border: 'var(--gold-shimmer)'
        },
        {
            label: 'Pending Application for Sticker Release',
            value: statsData.pendingDistribution,
            desc: 'Applications ready for Sticker Release',
            icon: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
            color: 'var(--gold)',
            bg: 'var(--gold-muted)',
            border: 'var(--gold-shimmer)'
        },
        {
            label: 'Completed',
            value: statsData.completedToday,
            desc: 'Total registered vehicles',
            icon: `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
            color: 'var(--maroon)',
            bg: 'var(--maroon-muted)',
            border: 'var(--maroon-tint)'
        }
    ]);

    const statusLabels: Record<string, string> = {
        pending: 'Pending',
        dept_val: 'Dept Validated',
        osa_val: 'OSA Validated',
        distributed: 'Distributed',
        completed: 'Completed',
        rejected: 'Rejected',
        revoked: 'Revoked'
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
        
        <!-- Stats Grid -->
        <div class="stats-grid">
            {#each statCards as card}
                <div class="stat-card">
                    <div class="stat-left">
                        <div class="stat-icon-circle" style="color: {card.color}; background: {card.bg};">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                {@html card.icon}
                            </svg>
                        </div>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">{card.value}</div>
                        <div class="stat-label">{card.label}</div>
                    </div>
                    <div class="stat-more">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cbd5e0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                        </svg>
                    </div>
                </div>
            {/each}
        </div>

        <div class="dashboard-grid">
            <!-- Application Status Breakdown -->
            <div class="breakdown-section">
                <div class="section-header">
                    <h2>Application Status</h2>
                    <span class="section-badge">Overview</span>
                </div>
                <div class="breakdown-grid">
                    {#each Object.entries(statusBreakdown) as [status, count]}
                        <div class="breakdown-item">
                            <div class="breakdown-label">{statusLabels[status] || status}</div>
                            <div class="breakdown-bar">
                                <div class="breakdown-fill" style="width: {((count as number) / (maxStatusCount as number)) * 100}%"></div>
                            </div>
                            <div class="breakdown-value">{count}</div>
                        </div>
                    {/each}
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

    .section-badge {
        font-size: 0.8rem;
        color: #718096;
        cursor: pointer;
    }

    .section-badge::after {
        content: ' ▾';
        font-size: 0.7rem;
        vertical-align: middle;
    }

    .breakdown-grid {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
    }

    .breakdown-item {
        display: flex;
        align-items: center;
        gap: var(--space-md);
    }

    .breakdown-label {
        min-width: 120px;
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--text-secondary);
    }

    .breakdown-bar {
        flex: 1;
        height: 6px;
        background: #f1f5f9;
        border-radius: 6px;
        overflow: hidden;
        position: relative;
    }

    .breakdown-fill {
        height: 100%;
        background: var(--gradient-maroon);
        border-radius: 6px;
        transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
    }

    .breakdown-fill::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    }

    .breakdown-value {
        min-width: 30px;
        text-align: right;
        font-size: 0.85rem;
        font-weight: 700;
        color: #1a202c;
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