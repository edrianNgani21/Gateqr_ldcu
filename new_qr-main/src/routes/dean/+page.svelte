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
  const tabs = ["validation", "rejected", "history"];

  let searchQuery = $state("");
  let roleFilter = $state("all"); // 'all', 'student', 'faculty', 'staff'
  let vehicleTypeFilter = $state("all"); // 'all', '2-Wheeler / Motorcycle', '4-Wheeler / Car'
  let selectedCampus = $state("all");

  // Pure realtime WebSocket sync for Dean portal without background polling
  $effect(() => {
    return startLiveSync({
      channelName: "dean-applications-realtime",
      tables: ["registration", "department"]
    });
  });

  $effect(() => {
    document.cookie = `dean_active_tab=${tab}; path=/dean; max-age=31536000; SameSite=Lax`;
  });

  function getAppsForTab(t: string) {
    if (t === "validation") return apps.filter((a: any) => ['dept_val', 'pending'].includes((a.status || '').toLowerCase()));
    if (t === "rejected") return apps.filter((a: any) => ['rejected', 'revoked'].includes((a.status || '').toLowerCase()));
    return apps.filter((a: any) => !['dept_val', 'pending', 'rejected', 'revoked'].includes((a.status || '').toLowerCase()));
  }

  let displayedApps = $derived.by(() => {
    let filtered = getAppsForTab(tab);

    if (roleFilter !== "all") {
      filtered = filtered.filter((a) => {
        const r = (a.role || "").toLowerCase().trim();
        if (roleFilter === "student") return r === "student";
        if (roleFilter === "faculty") return r === "faculty";
        if (roleFilter === "staff") return r === "staff" || r === "employee";
        return r === roleFilter.toLowerCase();
      });
    }

    if (vehicleTypeFilter !== "all") {
      filtered = filtered.filter((a) => {
        const rawType = (a.vehicle_type || a.vehicle_information?.type || "").toLowerCase();
        if (vehicleTypeFilter === "2-Wheeler / Motorcycle" || vehicleTypeFilter === "2-wheeler") {
          return rawType.includes("2") || rawType.includes("motor") || rawType.includes("bike");
        }
        if (vehicleTypeFilter === "4-Wheeler / Car" || vehicleTypeFilter === "4-wheeler") {
          return rawType.includes("4") || rawType.includes("car");
        }
        return rawType === vehicleTypeFilter.toLowerCase();
      });
    }

    if (selectedCampus !== "all") {
      filtered = filtered.filter((a) => {
        const c = (a.campus || "").toLowerCase().trim();
        return c === selectedCampus.toLowerCase().trim();
      });
    }

    if (searchQuery && searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((a) => {
        const searchTarget = [
          a.first_name,
          a.last_name,
          `${a.first_name || ""} ${a.last_name || ""}`,
          a.student_id,
          a.id_no,
          a.user_email,
          a.email,
          a.mobile,
          a.contact_number,
          a.department_name,
          a.campus,
          a.role,
          a.vehicle_plate,
          a.vehicle_make,
          a.vehicle_color,
          a.vehicle_type,
          a.vehicle_information?.plate_number,
          a.vehicle_information?.brand,
          a.vehicle_information?.color,
          a.vehicle_information?.type,
          a.qr_unique_code,
          a.registration_id,
          a.id
        ].filter(Boolean).map(String).join(" ").toLowerCase();

        return terms.every((term) => searchTarget.includes(term));
      });
    }

    return filtered;
  });

  // Reject / Revoke Reason Modal State
  let reasonModalOpen = $state(false);
  let reasonAction = $state<{ id: number; action: string; applicantName?: string; resolve?: () => void } | null>(null);
  let reasonText = $state("");
  let reasonError = $state("");
  let reasonLoading = $state(false);

  async function handleAction(registration_id: number, action: string) {
    if (action === "reject" || action === "revoke") {
      const app = apps.find((a) => (a.registration_id || a.id) === registration_id);
      const applicantName = app ? `${app.first_name || ""} ${app.last_name || ""}`.trim() : "";
      return new Promise<void>((resolve) => {
        reasonAction = { id: registration_id, action, applicantName, resolve };
        reasonText = "";
        reasonError = "";
        reasonModalOpen = true;
      });
    }

    await submitDeanAction(registration_id, action, "");
  }

  async function submitDeanAction(registration_id: number, action: string, reason: string = "") {
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

  async function submitReasonAction() {
    if (!reasonText.trim()) {
      reasonError = `Please provide a reason to ${reasonAction?.action || "proceed"}.`;
      return;
    }
    if (!reasonAction) return;

    reasonLoading = true;
    try {
      await submitDeanAction(reasonAction.id, reasonAction.action, reasonText.trim());
      const act = reasonAction;
      reasonModalOpen = false;
      reasonAction = null;
      reasonText = "";
      reasonError = "";
      act.resolve?.();
    } catch (e) {
      reasonError = "Action failed. Please try again.";
    } finally {
      reasonLoading = false;
    }
  }

  function cancelReasonAction() {
    if (reasonLoading) return;
    reasonModalOpen = false;
    reasonAction?.resolve?.();
    reasonAction = null;
    reasonText = "";
    reasonError = "";
  }

  let pendingCount = $derived(apps.filter((a) => a.status === "dept_val").length);
  let rejectedCount = $derived(apps.filter((a) => a.status === "rejected").length);
  let historyCount = $derived(apps.filter((a) => a.status !== "dept_val" && a.status !== "rejected").length);
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

    <div class="filters">
      <select bind:value={roleFilter} class="filter-select">
        <option value="all">All Roles</option>
        <option value="student">Student</option>
        <option value="faculty">Faculty</option>
        <option value="staff">Staff</option>
      </select>
      <select bind:value={vehicleTypeFilter} class="filter-select">
        <option value="all">All Vehicles</option>
        <option value="2-Wheeler / Motorcycle">2-Wheelers</option>
        <option value="4-Wheeler / Car">4-Wheelers</option>
      </select>
      <select bind:value={selectedCampus} class="filter-select">
        <option value="all">All Campuses</option>
        <option value="Liceo Main">Liceo Main</option>
        <option value="RNP">RNP</option>
        <option value="PASEO">PASEO</option>
      </select>
    </div>
  </div>

  <div class="cards-list">
    {#each displayedApps as app}
      <ApplicationCard
        showDocs={true}
        showQR={true}
        data={{
          id: app.id || '-',
          name: `${app.first_name || ''} ${app.last_name || ''}`.trim() || "-",
          role: app.role,
          campus: app.campus || "-",
          'year level': app.year_level || '-',
          Email: app.user_email || app.email || "-",
          Contact: app.mobile || "-",
          'Id number': app.student_id || app.id_no || "-",
          Department: app.department_name || "-",
          vehicle: app.vehicle_make || "-",
          'vehicle type': app.vehicle_type || "-",
          color: app.vehicle_color || "-",
          plate: app.vehicle_plate || "-",
          owner: app.is_owner ? 'Yes' : 'No',
          status: app.status,
          rejection_reason: app.invalid_reason || null,
          qr_code: app.qr_code,
          qr_unique_code: app.qr_unique_code,
          documents: {
            id: app.doc_id,
            enrollment: app.doc_load,
            or: app.doc_or,
            cr: app.doc_cr,
            license: app.doc_license,
            letter: app.doc_letter
          }
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

  {#if reasonModalOpen && reasonAction}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-overlay"
      onclick={() => { if (!reasonLoading) cancelReasonAction(); }}
      onkeydown={(e) => { if (e.key === 'Escape' && !reasonLoading) cancelReasonAction(); }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-content reason-modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="reason-modal-header">
          <div class="reason-badge-icon" class:is-revoke={reasonAction.action === 'revoke'}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              {#if reasonAction.action === 'revoke'}
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              {:else}
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              {/if}
            </svg>
          </div>
          <div class="reason-header-text">
            <h3 class="reason-title">
              {reasonAction.action === 'revoke' ? 'Revoke Application / Sticker' : 'Reject Application'}
            </h3>
            {#if reasonAction.applicantName}
              <span class="reason-applicant-badge">{reasonAction.applicantName}</span>
            {/if}
          </div>
          <button
            type="button"
            class="reason-close-btn"
            onclick={cancelReasonAction}
            disabled={reasonLoading}
            aria-label="Close"
          >✕</button>
        </div>

        <p class="reason-subtitle">
          {reasonAction.action === 'revoke'
            ? 'Provide an official explanation for revoking this application. This reason will be logged and visible in application records.'
            : 'Specify why this application is being rejected. This explanation will be displayed directly to the applicant on their status dashboard.'}
        </p>

        <!-- Quick Reason Presets -->
        <div class="reason-presets-section">
          <span class="presets-label">QUICK TEMPLATES</span>
          <div class="presets-chips">
            {#if reasonAction.action === 'revoke'}
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Expired Registration / Semester Renewal Required'}>Expired Registration</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Unauthorized Vehicle / Transfer Violation'}>Transfer Violation</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Department Disciplinary / Safety Sanction'}>Department Sanction</button>
            {:else}
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Incomplete or unreadable documents uploaded'}>Incomplete Docs</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Expired Official Receipt (OR) or Certificate of Registration (CR)'}>Expired OR/CR</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Vehicle information does not match supporting credentials'}>Unmatched Info</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Discrepancy with college department enrollment records'}>Enrollment Mismatch</button>
            {/if}
          </div>
        </div>

        <div class="reason-input-group">
          <label class="reason-input-label" for="reason-textarea">
            Reason / Evaluation Remarks <span class="req">*</span>
          </label>
          <textarea
            id="reason-textarea"
            class="reason-textarea"
            bind:value={reasonText}
            placeholder={reasonAction.action === 'revoke' ? 'State the specific reason for revoking this application...' : 'State the specific reason for rejecting this application...'}
            disabled={reasonLoading}
            rows="3"
            oninput={() => { if (reasonError) reasonError = ''; }}
          ></textarea>
        </div>

        {#if reasonError}
          <div class="reason-error-alert">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{reasonError}</span>
          </div>
        {/if}

        <div class="modal-actions reason-modal-actions">
          <button type="button" class="btn-cancel" onclick={cancelReasonAction} disabled={reasonLoading}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-confirm-reason"
            class:is-revoke={reasonAction.action === 'revoke'}
            onclick={submitReasonAction}
            disabled={reasonLoading}
          >
            {#if reasonLoading}
              <svg class="modal-spinner" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
              </svg>
              <span>Submitting…</span>
            {:else}
              <span>{reasonAction.action === 'revoke' ? 'Confirm Revocation' : 'Confirm Rejection'}</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
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

  /* ── Reason Modal (Reject / Revoke) ────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    box-sizing: border-box;
  }

  .modal-content {
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.4);
  }

  .reason-modal-card {
    background: #ffffff;
    max-width: 500px;
    width: 92%;
    border-radius: 18px;
    padding: 1.75rem;
    box-shadow:
      0 20px 50px -10px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    position: relative;
    box-sizing: border-box;
    animation: modal-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modal-pop {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .reason-modal-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    position: relative;
  }

  .reason-badge-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: #fee2e2;
    color: #dc2626;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid #fecaca;
  }

  .reason-badge-icon.is-revoke {
    background: #fef3c7;
    color: #b45309;
    border-color: #fde68a;
  }

  .reason-header-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .reason-title {
    margin: 0 !important;
    font-size: 1.15rem !important;
    font-weight: 800 !important;
    color: #0f172a !important;
    letter-spacing: -0.01em;
  }

  .reason-applicant-badge {
    font-size: 0.78rem;
    font-weight: 700;
    color: #8b1a2a;
    background: rgba(139, 26, 42, 0.08);
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    display: inline-block;
    align-self: flex-start;
  }

  .reason-close-btn {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #f1f5f9;
    border: none;
    color: #64748b;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.18s;
  }

  .reason-close-btn:hover:not(:disabled) {
    background: #e2e8f0;
    color: #0f172a;
  }

  .reason-subtitle {
    margin: 0 !important;
    font-size: 0.85rem !important;
    color: #475569 !important;
    line-height: 1.5;
  }

  .reason-presets-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .presets-label {
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #94a3b8;
    text-transform: uppercase;
  }

  .presets-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .preset-chip {
    padding: 0.35rem 0.65rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    color: #475569;
    cursor: pointer;
    transition: all 0.18s;
    font-family: inherit;
  }

  .preset-chip:hover {
    background: #fff1f2;
    border-color: #fecdd3;
    color: #9f1239;
    transform: translateY(-1px);
  }

  .reason-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .reason-input-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #334155;
  }

  .reason-input-label .req {
    color: #dc2626;
  }

  .reason-textarea {
    width: 100%;
    padding: 0.75rem 0.9rem;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.9rem;
    color: #0f172a;
    background: #ffffff;
    resize: vertical;
    min-height: 90px;
    box-sizing: border-box;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .reason-textarea:focus {
    outline: none;
    border-color: #8b1a2a;
    box-shadow: 0 0 0 3px rgba(139, 26, 42, 0.12);
  }

  .reason-error-alert {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .reason-modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.65rem;
    margin-top: 0.35rem;
  }

  .btn-cancel {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.625rem 1.25rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1.5px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    font-weight: 600;
    font-family: inherit;
    font-size: 0.875rem;
    transition: all 0.15s;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
  }

  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-confirm-reason {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.35rem;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
    color: #ffffff;
    font-size: 0.88rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(220, 38, 38, 0.3);
    transition: all 0.2s;
    font-family: inherit;
  }

  .btn-confirm-reason:hover:not(:disabled) {
    background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(220, 38, 38, 0.4);
  }

  .btn-confirm-reason.is-revoke {
    background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
    box-shadow: 0 4px 14px rgba(217, 119, 6, 0.3);
  }

  .btn-confirm-reason.is-revoke:hover:not(:disabled) {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    box-shadow: 0 6px 18px rgba(217, 119, 6, 0.4);
  }

  .btn-confirm-reason:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .modal-spinner {
    width: 14px;
    height: 14px;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
