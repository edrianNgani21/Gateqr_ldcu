<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import ApplicationCard from "$lib/components/ApplicationCard.svelte";
  import ActionBar from "$lib/components/ActionBar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { supabaseClient } from "$lib/supabaseClient";

  let { data } = $props();
  let apps = $derived((data.applications as any[]) || []);

  let tab = $state("validation");
  const tabs = ["validation", "history"];

  let searchQuery = $state("");

  // Realtime subscription for Dean portal
  $effect(() => {
    const channel = supabaseClient
      .channel('dean-applications-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration' }, () => {
        invalidateAll();
      })
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
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

<AppShell userEmail={data.userEmail}>
  <div class="page-header">
    <div class="header-content">
      <div>
        <h1>Department Head Portal</h1>
        <p class="page-subtitle">Review and approve vehicle sticker applications</p>
        {#if data.departmentName}
          <p class="department-name">{data.departmentName}</p>
        {/if}
      </div>
      <button class="logout-btn" onclick={handleLogout}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Logout
      </button>
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
  .page-header {
    margin-bottom: 1.5rem;
  }

  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .logout-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--maroon);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    box-shadow: 0 2px 8px rgba(107,26,42,0.25);
  }

  .logout-btn:hover {
    background: #551320;
    box-shadow: 0 4px 12px rgba(107,26,42,0.35);
  }

  .page-subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0.25rem 0 0 0;
    font-weight: 400;
  }

  .department-name {
    font-size: 1.25rem;
    color: var(--maroon);
    margin: 0.5rem 0 0 0;
    font-weight: 700;
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
