<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import { invalidateAll } from "$app/navigation";
  import { startLiveSync } from "$lib/utils/liveSync";

  let { data } = $props();
  let applicationsState = $state<any[]>(data.applications || []);
  $effect(() => {
    applicationsState = data.applications || [];
  });
  let apps = $derived(applicationsState);

  let searchQuery = $state("");
  let approvingId = $state<number | null>(null);

  // Pure realtime WebSocket sync for Administrative Department portal without background polling
  $effect(() => {
    return startLiveSync({
      channelName: "administrative-applications-realtime",
      tables: ["registration", "department"]
    });
  });

  let pendingApps = $derived(apps.filter((a: any) => ['dept_val', 'pending'].includes((a.status || '').toLowerCase())));
  let currentTabApps = $derived(pendingApps);

  let displayedApps = $derived.by(() => {
    let filtered = currentTabApps;

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
          a.department?.administrative_department,
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
    const previous = applicationsState;
    applicationsState = applicationsState.map((a: any) =>
      a.registration_id === registration_id || a.id === registration_id
        ? {
            ...a,
            status: "dept_validated",
            dept_val_at: new Date().toISOString()
          }
        : a
    );
    try {
      let res = await fetch("/api/administrative/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id, action: "accept", reason: "" }),
      });

      if (!res.ok) {
        res = await fetch("/api/dean/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registration_id, action: "accept", reason: "" }),
        });
      }

      if (res.ok) {
        invalidateAll();
      } else {
        applicationsState = previous;
        const err = await res.json();
        alert(err.error || "Action failed");
      }
    } catch (e) {
      applicationsState = previous;
      alert("Network error");
    } finally {
      approvingId = null;
    }
  }
</script>

<svelte:head>
  <title>Administrative Department Review — GateQR</title>
  <meta
    name="description"
    content="Review and approve vehicle sticker applications for your administrative department."
  />
</svelte:head>

<AppShell userEmail={data.userEmail} userRole="administrative" showSidebar={true}>
  <!-- Welcome Banner matching Dashboard Aesthetic -->
  <div class="welcome-banner">
    <div class="wb-content">
      <div class="wb-badge">
        ADMINISTRATIVE DEPARTMENT REVIEW PORTAL &bull; {data.departmentName || 'ADMINISTRATIVE DEPARTMENT'}
      </div>
      <h1 class="wb-title">Welcome back, Department Head!</h1>
      <p class="wb-sub">Review and verify department vehicle registration applications{data.departmentName ? ` for ${data.departmentName}` : ''} today.</p>
    </div>
    <div class="wb-icon-shield">
      <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
        <path d="M6 12v5c3 3 9 3 12 0v-5"/>
      </svg>
    </div>
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
      {@const deptName = app.department_name || app.department?.administrative_department || app.department?.department_name || app.department?.department || data.departmentName || 'Department'}
      {@const isApproving = approvingId === appId}
      {@const isPending = ['dept_val', 'pending'].includes((app.status || '').toLowerCase())}

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
          {#if isPending}
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
          {:else}
            <span class="badge-status-approved">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {app.status === 'dept_validated' ? 'Validated by Dept' : (app.status === 'approved' ? 'Approved & Registered' : (app.status === 'completed' ? 'Completed' : (app.status === 'rejected' ? 'Rejected' : app.status)))}
            </span>
          {/if}
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
    margin-bottom: 1.25rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .search-wrap {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.85rem;
    color: #94a3b8;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.65rem 2.25rem 0.65rem 2.5rem;
    border: 1.5px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.9rem;
    color: #1e293b;
    background: #f8fafc;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .search-input:focus {
    outline: none;
    border-color: #7A1734;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(122, 23, 52, 0.1);
  }

  .search-clear {
    position: absolute;
    right: 0.75rem;
    background: transparent;
    border: none;
    font-size: 1.25rem;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
    padding: 0.2rem;
  }

  .search-clear:hover {
    color: #1e293b;
  }

  /* Cards List */
  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .dean-app-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 1.15rem 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .dean-app-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }

  .card-left-section {
    display: flex;
    align-items: center;
    gap: 1.15rem;
    min-width: 0;
    flex: 1;
  }

  .applicant-avatar {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
    color: #ffffff;
    font-size: 1.15rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 3px 8px rgba(122, 23, 52, 0.25);
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
    font-size: 1.05rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .agreement-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.55rem;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 6px;
    color: #047857;
    font-size: 0.75rem;
    font-weight: 700;
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
    font-weight: 700;
  }

  .card-action-section {
    flex-shrink: 0;
  }

  .btn-dean-approve {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.35rem;
    border-radius: 9px;
    background: #15803d;
    color: #ffffff;
    border: none;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 6px rgba(21, 128, 61, 0.25);
  }

  .btn-dean-approve:hover:not(:disabled) {
    background: #16a34a;
    box-shadow: 0 4px 12px rgba(21, 128, 61, 0.35);
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
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .badge-status-approved {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0.55rem 1.15rem;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    color: #065f46;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 700;
  }

  /* Empty State Box */
  .empty-state-box {
    background: #ffffff;
    border: 1.5px dashed #cbd5e1;
    border-radius: 14px;
    padding: 3rem 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .empty-icon-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #f1f5f9;
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1rem;
  }

  .empty-state-box h3 {
    font-size: 1.05rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 0.35rem 0;
  }

  .empty-state-box p {
    font-size: 0.875rem;
    color: #64748b;
    max-width: 440px;
    margin: 0;
    line-height: 1.45;
  }

  .btn-clear-empty {
    margin-top: 1rem;
    padding: 0.45rem 1rem;
    border-radius: 7px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    font-size: 0.825rem;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-clear-empty:hover {
    background: #e2e8f0;
  }

  /* Responsive styling */
  @media (max-width: 768px) {
    .welcome-banner {
      padding: 1.25rem 1.25rem;
    }

    .wb-icon-shield {
      display: none;
    }

    .dean-app-card {
      flex-direction: column;
      align-items: stretch;
      gap: 1rem;
      padding: 1rem 1rem;
    }

    .applicant-meta-grid {
      gap: 0.5rem;
      flex-direction: column;
      align-items: flex-start;
    }

    .btn-dean-approve {
      width: 100%;
      justify-content: center;
    }
  }
</style>
