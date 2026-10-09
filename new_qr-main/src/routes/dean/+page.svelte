<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import ApplicationCard from "$lib/components/ApplicationCard.svelte";
  import ActionBar from "$lib/components/ActionBar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { startLiveSync } from "$lib/utils/liveSync";

  let { data } = $props();
  let apps = $derived((data.applications as any[]) || []);

  let tab = $state("validation");
  const tabs = ["validation", "history"];

  let searchQuery = $state("");

  // Dual-engine live sync for Dean portal (instant automatic updates without page refresh)
  $effect(() => {
    return startLiveSync({
      channelName: "dean-applications-realtime",
      tables: ["registration", "department"],
      intervalMs: 5000
    });
  });

  $effect(() => {
    document.cookie = `dean_active_tab=${tab}; path=/dean; max-age=31536000; SameSite=Lax`;
  });

  let displayedApps = $derived.by(() => {
    let filtered = apps;

    if (tab === "validation")
      filtered = filtered.filter((a) => a.status === "dept_val");
    else filtered = filtered.filter((a) => a.status !== "dept_val");

    if (searchQuery) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((a) => {
        const fullString = Object.values(a)
          .filter((val) => val !== null && val !== undefined)
          .map((val) => String(val).toLowerCase())
          .join(" ");
        return terms.every((term) => fullString.includes(term));
      });
    }

    return filtered;
  });

  async function handleAction(registration_id: number, action: string) {
    let reason: string | null = "";
    if (action === "reject" || action === "revoke") {
      reason = prompt(`Please provide a reason to ${action}:`);
      if (reason === null) return; // cancelled
    }

    try {
      const res = await fetch("/api/dean/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id, action, reason }),
      });

      if (res.ok) {
        await invalidateAll();
      } else {
        const err = await res.json();
        alert(err.error || "Action failed");
      }
    } catch (e) {
      alert("Network error");
    }
  }

  let pendingCount = $derived(apps.filter((a) => a.status === "dept_val").length);
  let historyCount = $derived(apps.filter((a) => a.status !== "dept_val").length);
  let totalCount = $derived(apps.length);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
</script>

<svelte:head>
  <title>Dean Review — GateQR</title>
  <meta
    name="description"
    content="Review and approve vehicle sticker applications for your college department."
  />
</svelte:head>

<AppShell userEmail={data.userEmail} userRole="dean" showSidebar={false}>
  <!-- Welcome Banner matching Dashboard Aesthetic -->
  <div class="welcome-banner">
    <div class="wb-content">
      <h1 class="wb-title">Welcome back, Dean!</h1>
      <p class="wb-sub">Review and verify department vehicle registration applications{data.departmentName ? ` for ${data.departmentName}` : ''} today.</p>
    </div>
    <div class="wb-icon-shield">
      <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
        <path d="M6 12v5c3 3 9 3 12 0v-5"/>
      </svg>
    </div>
  </div>

  <!-- Summary Stats Grid matching Dashboard Aesthetic -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-left">
        <div class="stat-icon-circle maroon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
      </div>
      <div class="stat-content">
        <div class="stat-value">{totalCount}</div>
        <div class="stat-label">TOTAL APPLICATIONS</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-left">
        <div class="stat-icon-circle gold">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
      </div>
      <div class="stat-content">
        <div class="stat-value">{pendingCount}</div>
        <div class="stat-label">PENDING VALIDATION</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-left">
        <div class="stat-icon-circle rose">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
      </div>
      <div class="stat-content">
        <div class="stat-value">{historyCount}</div>
        <div class="stat-label">PROCESSED / HISTORY</div>
      </div>
    </div>
  </div>

  <TabBar {tabs} active={tab} onchange={(t) => (tab = t)} />

  <div class="controls-row">
    <div class="search-wrap">
      <svg
        class="search-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <input
        type="text"
        placeholder="Search name, plate, vehicle…"
        bind:value={searchQuery}
        class="search-input"
      />
      {#if searchQuery}
        <button
          class="search-clear"
          onclick={() => {
            searchQuery = "";
          }}>×</button
        >
      {/if}
    </div>
  </div>

  <div class="cards-list">
    {#each displayedApps as app}
      <ApplicationCard
        showDocs={false}
        showQR={true}
        data={{
          name: `${app.first_name || ''} ${app.last_name || ''}`.trim() || "-",
          Email: app.user_email || app.email || "-",
          'Id number': app.student_id || app.id_no || "-",
          Department: app.department_name || "-",
          status: app.status,
          rejection_reason: app.invalid_reason || null,
          qr_code: app.qr_code,
          qr_unique_code: app.qr_unique_code,
        }}
      >
        {#snippet children()}
          <div class="agreement-notice">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span><strong>Agreement Form To Park:</strong> Verified & Acknowledged by Department</span>
          </div>
          <ActionBar
            {tab}
            status={app.status}
            onaction={(action) => handleAction(app.id, action)}
          />
        {/snippet}
      </ApplicationCard>
    {:else}
      <p class="empty-state">No applications found.</p>
    {/each}
  </div>
</AppShell>

<style>
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

  /* Stats Grid matching Screenshot 1 */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    background: #ffffff;
    border-radius: 16px;
    padding: 1.25rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.04);
    border: 1px solid #edf2f7;
    transition: all 0.2s ease;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.07);
  }

  .stat-icon-circle {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stat-icon-circle.maroon {
    background: #fdf2f4;
    color: #8B1A3C;
  }

  .stat-icon-circle.gold {
    background: #fffbeb;
    color: #D4A62A;
  }

  .stat-icon-circle.rose {
    background: #fff1f2;
    color: #BE123C;
  }

  .stat-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-value {
    font-size: 1.75rem;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
  }

  .stat-label {
    font-size: 0.725rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #64748b;
  }

  .controls-row {
    padding: 1rem;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 12px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }

  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 200px;
    display: flex;
    align-items: center;
  }
  .search-icon {
    position: absolute;
    left: 0.875rem;
    color: var(--text-secondary);
    pointer-events: none;
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    height: 40px;
    padding: 0 2rem 0 2.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #ffffff;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    transition: all 0.2s;
    box-sizing: border-box;
  }
  .search-input:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px rgba(107,26,42,0.1);
  }
  .search-clear {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 1rem;
    line-height: 1;
    padding: 0;
  }
  .search-clear:hover {
    color: var(--text-primary);
  }

  .filters {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  @media (max-width: 640px) {
    .controls-row {
      flex-direction: column;
      align-items: stretch;
    }
    .search-wrap {
      min-width: 0;
    }
    .filters {
      flex-wrap: wrap;
    }
    .filter-select {
      flex: 1;
    }
  }

  .filter-select {
    height: 40px;
    padding: 0 1rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #ffffff;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: all 0.2s;
    box-sizing: border-box;
  }
  .filter-select:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px rgba(107,26,42,0.1);
  }

  .dropdown-wrap {
    position: relative;
  }
  .dropdown-btn {
    min-width: 140px;
    text-align: left;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    padding: 0.5rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 150px;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
    padding: 0.375rem 0.5rem;
    border-radius: 6px;
    transition: background 0.2s;
  }
  .dropdown-item:hover {
    background: #f8fafc;
  }

  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .agreement-notice {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1rem;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    color: #166534;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
  }

  .agreement-notice svg {
    color: #15803d;
    flex-shrink: 0;
  }
</style>
