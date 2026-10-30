<script lang="ts">
  import { showAlert } from '$lib/utils/dialog';
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
  let showDocPopup = $state<string | null>(null);

  function isValidDoc(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    const t = url.trim().toLowerCase();
    if (['pending_or', 'pending_cr', 'pending_license', 'pending_enrollment', 'n/a', 'pending', 'null', 'undefined', 'not specified', '-', ''].includes(t)) {
      return false;
    }
    if (/^\d{4}-\d+$/.test(t) || /^\d+$/.test(t)) {
      return false;
    }
    return t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:') || t.startsWith('/');
  }

  function isPdf(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    return url.toLowerCase().includes('.pdf');
  }

  function openDoc(url: string | null | undefined) {
    if (url && isValidDoc(url)) {
      showDocPopup = url;
    }
  }

  // Pure realtime WebSocket sync for Dean portal without background polling
  $effect(() => {
    return startLiveSync({
      channelName: "dean-applications-realtime",
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
          a.campus,
          a.role,
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
      const res = await fetch("/api/dean/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id, action: "accept", reason: "" }),
      });

      if (res.ok) {
        invalidateAll();
      } else {
        applicationsState = previous;
        const err = await res.json();
        showAlert(err.error || "Action failed");
      }
    } catch (e) {
      applicationsState = previous;
      showAlert("Network error");
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

<AppShell userEmail={data.userEmail} userRole={data.departmentType === 'administrative' ? 'administrative' : 'dean'} showSidebar={true}>
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

  <!-- Search & Filter Controls Toolbar -->
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
      {@const isPending = ['dept_val', 'pending'].includes((app.status || '').toLowerCase())}
      {@const studentIdDoc = app.doc_id || (typeof app.agreement_form === 'string' && app.agreement_form.startsWith('http') ? app.agreement_form : null) || (typeof app.school_id === 'string' && app.school_id.startsWith('http') ? app.school_id : null)}
      {@const enrollmentDoc = app.enrollment_form || app.doc_load}

      <div class="dean-app-card">
        <div class="card-left-section">
          <div class="applicant-avatar" aria-hidden="true">
            {applicantName.charAt(0).toUpperCase()}
          </div>
          <div class="applicant-info">
            <div class="applicant-name-row">
              <h3 class="applicant-name">{#if appId}<span class="reg-no">Reg. No. {appId}</span> <span class="title-sep" aria-hidden="true">—</span> {/if}{applicantName}</h3>
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
              <div class="meta-field">
                <span class="meta-label">Year Level:</span>
                <span class="meta-value year-level-badge">{app.year_level && app.year_level !== '-' ? app.year_level : 'N/A'}</span>
              </div>
            </div>

            <!-- Documents: Enrollment Form & Student ID -->
            <div class="applicant-docs-row">
              <span class="docs-label">Documents:</span>
              <button
                type="button"
                class="btn-doc-view"
                class:has-doc={isValidDoc(studentIdDoc)}
                disabled={!isValidDoc(studentIdDoc)}
                onclick={() => openDoc(studentIdDoc)}
                title={isValidDoc(studentIdDoc) ? 'View Student ID Document' : 'Student ID Not Uploaded'}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>
                </svg>
                <span>Student ID</span>
              </button>

              <button
                type="button"
                class="btn-doc-view"
                class:has-doc={isValidDoc(enrollmentDoc)}
                disabled={!isValidDoc(enrollmentDoc)}
                onclick={() => openDoc(enrollmentDoc)}
                title={isValidDoc(enrollmentDoc) ? 'View Enrollment Form Document' : 'Enrollment Form Not Uploaded'}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>Enrollment Form</span>
              </button>

              {#if isValidDoc(app.signed_agreement_form)}
                <button
                  type="button"
                  class="btn-doc-view has-doc"
                  onclick={() => openDoc(app.signed_agreement_form)}
                  title="View Signed Agreement Form to Park"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span>Signed Agreement Form</span>
                </button>
              {/if}
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {app.status === 'dept_validated' ? 'Validated by Dean' : (app.status === 'approved' ? 'Approved & Registered' : (app.status === 'completed' ? 'Completed' : (app.status === 'rejected' ? 'Rejected' : app.status)))}
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

{#if showDocPopup}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="doc-modal-overlay" onclick={() => (showDocPopup = null)} role="dialog" aria-modal="true" tabindex="-1">
    <div class="doc-modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="doc-modal-header">
        <h4 class="doc-modal-title">Document Preview</h4>
        <button class="close-modal" aria-label="Close document viewer" onclick={() => (showDocPopup = null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="doc-image-wrap">
        {#if isPdf(showDocPopup)}
          <iframe src={showDocPopup} title="Document Preview" class="doc-preview-frame"></iframe>
          <div class="doc-pdf-fallback">
            <a href={showDocPopup} target="_blank" rel="noopener noreferrer" class="doc-open-link">
              Open original PDF in new tab ↗
            </a>
          </div>
        {:else}
          <img src={showDocPopup} alt="Document Preview" class="doc-preview-img" onerror={(e) => {
            (e.currentTarget as HTMLImageElement).src = '/liceo-logo.png';
          }} />
          <div class="doc-pdf-fallback">
            <a href={showDocPopup} target="_blank" rel="noopener noreferrer" class="doc-open-link">
              Open original document in new tab ↗
            </a>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

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





  @media (max-width: 768px) {
    .controls-row {
      flex-direction: column;
      align-items: stretch;
    }
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

  .reg-no {
    font-size: 0.75rem;
    font-weight: 800;
    color: #6b1a2a;
    background: rgba(107, 26, 42, 0.08);
    border: 1px solid rgba(107, 26, 42, 0.18);
    padding: 0.1rem 0.45rem;
    border-radius: 6px;
    white-space: nowrap;
    vertical-align: middle;
  }

  .title-sep {
    color: #94a3b8;
    font-weight: 400;
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

  .year-level-badge {
    background: #e0f2fe;
    color: #0369a1;
    font-weight: 700;
    padding: 0.15rem 0.55rem;
    border-radius: 6px;
    font-size: 0.8rem;
    border: 1px solid #bae6fd;
    display: inline-block;
  }

  .applicant-docs-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-top: 0.35rem;
    flex-wrap: wrap;
  }

  .docs-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .btn-doc-view {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0.35rem 0.75rem;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    color: #475569;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  .btn-doc-view.has-doc {
    background: #fdf2f4;
    border-color: rgba(139, 26, 60, 0.35);
    color: #8B1A3C;
  }

  .btn-doc-view.has-doc:hover:not(:disabled) {
    background: #8B1A3C;
    border-color: #8B1A3C;
    color: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(139, 26, 60, 0.2);
  }

  .btn-doc-view:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #f1f5f9;
    border-color: #e2e8f0;
    color: #94a3b8;
  }

  /* Document Modal */
  .doc-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .doc-modal-content {
    background: #ffffff;
    border-radius: 14px;
    padding: 1.25rem;
    position: relative;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    max-width: 92vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    animation: slideUp 0.2s ease;
  }

  @keyframes slideUp {
    from { transform: translateY(16px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .doc-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .doc-modal-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: #0f172a;
  }

  .close-modal {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #64748b;
    transition: all 0.15s;
  }

  .close-modal:hover {
    background: #8B1A3C;
    color: #ffffff;
    border-color: #8B1A3C;
  }

  .doc-image-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .doc-preview-img {
    max-width: 88vw;
    max-height: 72vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .doc-preview-frame {
    width: 80vw;
    height: 72vh;
    border: none;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .doc-pdf-fallback {
    text-align: center;
    padding-top: 0.25rem;
  }

  .doc-open-link {
    font-size: 0.82rem;
    font-weight: 600;
    color: #8B1A3C;
    text-decoration: underline;
    transition: color 0.15s;
  }

  .doc-open-link:hover {
    color: #701530;
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
    .btn-doc-view {
      flex: 1 1 calc(50% - 0.5rem);
      justify-content: center;
    }
    .applicant-name-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }
  }

  @media (max-width: 360px) {
    .btn-doc-view {
      flex: 1 1 100%;
      width: 100%;
    }
    .welcome-banner {
      padding: 0.85rem;
    }
  }
</style>
