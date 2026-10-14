<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { startLiveSync } from "$lib/utils/liveSync";

  let { data } = $props();
  let apps = $derived((data.applications as any[]) || []);

  let tab = $state("agreement");
  const tabs = ["agreement"];
  const tabLabels: Record<string, string> = {
    agreement: "Agreement Form to Park"
  };

  let searchQuery = $state("");
  let approvingId = $state<number | null>(null);

  // Pure realtime WebSocket sync for Dean portal without background polling
  $effect(() => {
    return startLiveSync({
      channelName: "dean-applications-realtime",
      tables: ["registration", "department"]
    });
  });

  // Only applications that are on the screening of applications tab
  let screeningApps = $derived.by(() => {
    return apps.filter((a: any) => ['dept_val', 'pending'].includes((a.status || '').toLowerCase()));
  });

  let screeningCount = $derived(screeningApps.length);

  let displayedApps = $derived.by(() => {
    let filtered = screeningApps;

    if (searchQuery && searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((a) => {
        const searchTarget = [
          a.first_name,
          a.last_name,
          `${a.first_name || ""} ${a.last_name || ""}`,
          a.user_email,
          a.email,
          a.user?.email,
          a.department_name,
          a.department?.department_name,
          a.department?.department,
          data.departmentName
        ].filter(Boolean).map(String).join(" ").toLowerCase();

        return terms.every((term) => searchTarget.includes(term));
      });
    }

    return filtered;
  });

  async function approveApp(registration_id: number) {
    if (approvingId !== null) return;
    approvingId = registration_id;
    try {
      const res = await fetch("/api/dean/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id, action: "accept", reason: "" }),
      });

      if (res.ok) {
        await invalidateAll();
      } else {
        const err = await res.json();
        alert(err.error || "Action failed");
      }
    } catch (e) {
      alert("Network error");
    } finally {
      approvingId = null;
    }
  }
</script>

<svelte:head>
  <title>{data.departmentType === 'administrative' ? 'Administrative Department Review' : 'Dean Review'} — GateQR</title>
  <meta
    name="description"
    content="Review and approve vehicle sticker applications for your department."
  />
</svelte:head>

<AppShell userEmail={data.userEmail} userRole={data.departmentType === 'administrative' ? 'administrative' : 'dean'} showSidebar={false}>
  <!-- Welcome Banner matching Dashboard Aesthetic -->
  <div class="welcome-banner">
    <div class="wb-content">
      <div class="wb-badge">
        {data.departmentType === 'administrative' ? 'ADMINISTRATIVE DEPARTMENT REVIEW PORTAL' : 'DEAN REVIEW PORTAL'} &bull; {data.departmentName || (data.departmentType === 'administrative' ? 'ADMINISTRATIVE DEPARTMENT' : 'ACADEMIC DEPARTMENT')}
      </div>
      <h1 class="wb-title">{data.departmentType === 'administrative' ? 'Welcome back, Department Head!' : 'Welcome back, Dean!'}</h1>
      <p class="wb-sub">Review and verify department vehicle registration applications{data.departmentName ? ` for ${data.departmentName}` : ''} today.</p>
    </div>
    <div class="wb-icon-shield">
      <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
        <path d="M6 12v5c3 3 9 3 12 0v-5"/>
      </svg>
    </div>
  </div>

  <!-- Single Tab: Agreement Form to Park -->
  <div class="tabs-wrapper">
    <TabBar {tabs} active={tab} labels={tabLabels} counts={[screeningCount]} onchange={(t) => (tab = t)} />
  </div>

  <!-- Search Toolbar (Campus, Vehicle Types, and Roles removed) -->
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
        placeholder="Search applicant name, email, or department…"
        bind:value={searchQuery}
        class="search-input"
      />
      {#if searchQuery}
        <button
          class="search-clear"
          onclick={() => {
            searchQuery = "";
          }}
          aria-label="Clear search"
        >×</button>
      {/if}
    </div>
  </div>

  <!-- Cards List showing only name, email, department, and Approve button -->
  <div class="cards-list">
    {#each displayedApps as app (app.id || app.registration_id)}
      {@const appId = app.registration_id || app.id}
      {@const applicantName = `${app.first_name || ''} ${app.last_name || ''}`.trim() || 'Unnamed Applicant'}
      {@const applicantEmail = app.user_email || app.email || app.user?.email || 'No email provided'}
      {@const deptName = app.department_name || app.department?.department_name || app.department?.department || data.departmentName || 'Department'}
      {@const isApproving = approvingId === appId}

      <div class="dean-app-card">
        <div class="card-left-section">
          <div class="applicant-avatar" aria-hidden="true">
            {applicantName.charAt(0).toUpperCase()}
          </div>
          <div class="applicant-info">
            <div class="applicant-name-row">
              <h3 class="applicant-name">{applicantName}</h3>
              <span class="agreement-badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                Agreement Form to Park
              </span>
            </div>
            <div class="applicant-meta-grid">
              <div class="meta-field">
                <span class="meta-label">Email:</span>
                <span class="meta-value">{applicantEmail}</span>
              </div>
              <div class="meta-field">
                <span class="meta-label">Department:</span>
                <span class="meta-value">{deptName}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card-action-section">
          <button
            type="button"
            class="btn-dean-approve"
            disabled={isApproving || approvingId !== null}
            onclick={() => approveApp(appId)}
          >
            {#if isApproving}
              <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
              </svg>
              <span>Approving…</span>
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Approve</span>
            {/if}
          </button>
        </div>
      </div>
    {:else}
      <div class="empty-state-box">
        <div class="empty-icon-circle">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <path d="M9 13l2 2 4-4"/>
          </svg>
        </div>
        <h3>{searchQuery ? 'No matching applicants found' : 'No pending agreement forms to park'}</h3>
        <p>
          {#if searchQuery}
            No applicant matches "{searchQuery}". Try searching by another name, email, or department.
          {:else}
            All department applications have been reviewed. New applicant submissions will appear here automatically.
          {/if}
        </p>
        {#if searchQuery}
          <button class="btn-clear-empty" onclick={() => searchQuery = ""}>Clear Search</button>
        {/if}
      </div>
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

  .wb-badge {
    display: inline-block;
    align-self: flex-start;
    padding: 0.25rem 0.65rem;
    background: rgba(233, 194, 94, 0.2);
    border: 1px solid rgba(233, 194, 94, 0.4);
    border-radius: 20px;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #E9C25E;
    text-transform: uppercase;
    margin-bottom: 0.15rem;
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

  .tabs-wrapper {
    margin-bottom: 1rem;
  }

  /* Search Controls Row */
  .controls-row {
    padding: 0.85rem 1rem;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #ffffff;
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }

  .search-wrap {
    position: relative;
    flex: 1;
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
    height: 42px;
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
    border-color: #8B1A3C;
    box-shadow: 0 0 0 2px rgba(139, 26, 60, 0.12);
  }

  .search-clear {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 1.15rem;
    line-height: 1;
    padding: 0;
  }

  .search-clear:hover {
    color: var(--text-primary);
  }

  /* Cards List */
  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Dean Application Card */
  .dean-app-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 1.25rem 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
    transition: all 0.2s ease;
  }

  .dean-app-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }

  .card-left-section {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex: 1;
    min-width: 0;
  }

  .applicant-avatar {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: rgba(139, 26, 60, 0.08);
    color: #8B1A3C;
    font-size: 1.25rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid rgba(139, 26, 60, 0.15);
  }

  .applicant-info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    flex: 1;
  }

  .applicant-name-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .applicant-name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.01em;
  }

  .agreement-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0.2rem 0.65rem;
    background: #fdf2f4;
    border: 1px solid rgba(139, 26, 60, 0.25);
    border-radius: 20px;
    font-size: 0.725rem;
    font-weight: 700;
    color: #8B1A3C;
    letter-spacing: 0.02em;
  }

  .agreement-badge svg {
    color: #8B1A3C;
    flex-shrink: 0;
  }

  .applicant-meta-grid {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .meta-field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
  }

  .meta-label {
    color: #64748b;
    font-weight: 600;
  }

  .meta-value {
    color: #1e293b;
    font-weight: 500;
  }

  /* Approve Button */
  .card-action-section {
    flex-shrink: 0;
  }

  .btn-dean-approve {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0.65rem 1.35rem;
    background: linear-gradient(135deg, #059669 0%, #047857 100%);
    color: #ffffff;
    font-size: 0.875rem;
    font-weight: 700;
    font-family: inherit;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(5, 150, 105, 0.25);
    transition: all 0.18s ease;
  }

  .btn-dean-approve:hover:not(:disabled) {
    background: linear-gradient(135deg, #047857 0%, #065f46 100%);
    box-shadow: 0 6px 14px rgba(5, 150, 105, 0.35);
    transform: translateY(-1px);
  }

  .btn-dean-approve:disabled {
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    animation: btn-spin 0.8s linear infinite;
  }

  @keyframes btn-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Empty State Box */
  .empty-state-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 3.5rem 1.5rem;
    background: #ffffff;
    border-radius: 16px;
    border: 1px dashed #cbd5e1;
    gap: 0.75rem;
  }

  .empty-icon-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #f8fafc;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0.25rem;
  }

  .empty-state-box h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: #1e293b;
  }

  .empty-state-box p {
    margin: 0;
    font-size: 0.875rem;
    color: #64748b;
    max-width: 480px;
    line-height: 1.5;
  }

  .btn-clear-empty {
    margin-top: 0.5rem;
    padding: 0.5rem 1.25rem;
    background: #8B1A3C;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 0.825rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-clear-empty:hover {
    background: #701530;
  }

  /* Responsive Adjustments */
  @media (max-width: 768px) {
    .welcome-banner {
      padding: 1.25rem 1.5rem;
    }
    .wb-title {
      font-size: 1.25rem;
    }
    .wb-icon-shield {
      display: none;
    }
    .dean-app-card {
      flex-direction: column;
      align-items: stretch;
      gap: 1.25rem;
    }
    .card-action-section {
      width: 100%;
    }
    .btn-dean-approve {
      width: 100%;
      justify-content: center;
    }
    .applicant-meta-grid {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
    }
  }

  @media (max-width: 480px) {
    .welcome-banner {
      padding: 1rem;
    }
    .applicant-avatar {
      display: none;
    }
  }
</style>
