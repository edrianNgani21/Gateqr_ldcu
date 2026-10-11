<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import NavBar from '$lib/components/NavBar.svelte';
  import { invalidateAll } from '$app/navigation';
  import { supabaseClient } from '$lib/supabaseClient';

  let { data } = $props();

  // Realtime subscription for change vehicle requests
  $effect(() => {
    const channel = supabaseClient
      .channel('osa-change-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'change_vehicle_request' }, () => {
        invalidateAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration' }, () => {
        invalidateAll();
      })
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  });

  let requests = $derived((data.requests as any[]) || []);

  let activeFilter = $state<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  let searchQuery = $state('');

  // Selected document preview popup
  let previewDocUrl = $state<string | null>(null);

  // Schedule modal state
  let scheduleModalOpen = $state(false);
  let selectedRequest = $state<any>(null);
  let scheduleDateTime = $state('');
  let schedulingLoading = $state(false);
  let scheduleError = $state('');

  // Reject modal state
  let rejectModalOpen = $state(false);
  let rejectReason = $state('');
  let rejectLoading = $state(false);
  let rejectError = $state('');

  // Stat counts
  let counts = $derived.by(() => {
    const all = requests.length;
    const pending = requests.filter(r => (r.status || '').toLowerCase() === 'pending').length;
    const approved = requests.filter(r => ['approved', 'completed'].includes((r.status || '').toLowerCase())).length;
    const rejected = requests.filter(r => (r.status || '').toLowerCase() === 'rejected').length;
    return { all, pending, approved, rejected };
  });

  // Filtered requests
  let displayedRequests = $derived.by(() => {
    let list = requests;

    if (activeFilter !== 'all') {
      list = list.filter(r => {
        const s = (r.status || '').toLowerCase();
        if (activeFilter === 'pending') return s === 'pending';
        if (activeFilter === 'approved') return s === 'approved' || s === 'completed';
        if (activeFilter === 'rejected') return s === 'rejected';
        return true;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => {
        const name = (r.applicant?.name || '').toLowerCase();
        const email = (r.applicant?.email || '').toLowerCase();
        const oldPlate = (r.current_vehicle?.plate_number || '').toLowerCase();
        const newPlate = (r.new_vehicle?.plate_number || '').toLowerCase();
        const newBrand = (r.new_vehicle?.brand || '').toLowerCase();
        const reason = (r.reason || '').toLowerCase();
        return name.includes(q) || email.includes(q) || oldPlate.includes(q) || newPlate.includes(q) || newBrand.includes(q) || reason.includes(q);
      });
    }

    return list;
  });

  function openScheduleModal(req: any) {
    selectedRequest = req;
    scheduleDateTime = '';
    scheduleError = '';
    scheduleModalOpen = true;
  }

  function closeScheduleModal() {
    if (schedulingLoading) return;
    scheduleModalOpen = false;
    selectedRequest = null;
    scheduleDateTime = '';
    scheduleError = '';
  }

  async function confirmSchedule() {
    if (!scheduleDateTime) {
      scheduleError = 'Please select a date and time for hardcopy compliance.';
      return;
    }

    const selectedDate = new Date(scheduleDateTime);
    if (isNaN(selectedDate.getTime()) || selectedDate <= new Date()) {
      scheduleError = 'Please choose a future date and time.';
      return;
    }

    schedulingLoading = true;
    scheduleError = '';

    try {
      const res = await fetch('/api/change-vehicle/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: selectedRequest.request_id,
          action: 'approve',
          schedule: selectedDate.toISOString()
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        scheduleError = resData.error || 'Failed to accept and schedule request.';
      } else {
        alert('Registration details change request accepted! The application has now moved to the Hardcopy Compliance Schedules in Manage Applications.');
        closeScheduleModal();
        await invalidateAll();
      }
    } catch (e: any) {
      scheduleError = e.message || 'Network error occurred.';
    } finally {
      schedulingLoading = false;
    }
  }

  function openRejectModal(req: any) {
    selectedRequest = req;
    rejectReason = '';
    rejectError = '';
    rejectModalOpen = true;
  }

  function closeRejectModal() {
    if (rejectLoading) return;
    rejectModalOpen = false;
    selectedRequest = null;
    rejectReason = '';
    rejectError = '';
  }

  async function confirmReject() {
    if (!rejectReason.trim()) {
      rejectError = 'Please enter a reason for rejecting this request.';
      return;
    }

    rejectLoading = true;
    rejectError = '';

    try {
      const res = await fetch('/api/change-vehicle/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: selectedRequest.request_id,
          action: 'reject',
          rejection_reason: rejectReason.trim()
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        rejectError = resData.error || 'Failed to reject request.';
      } else {
        alert('Registration details change request rejected.');
        closeRejectModal();
        await invalidateAll();
      }
    } catch (e: any) {
      rejectError = e.message || 'Network error occurred.';
    } finally {
      rejectLoading = false;
    }
  }

  function formatDateTime(str: string | null | undefined): string {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
</script>

<svelte:head>
  <title>Request to Change Registration Details — OSA | GateQR</title>
</svelte:head>

<AppShell userEmail={data.userEmail} showSidebar={true}>
  <NavBar title="Request to Change Registration Details" />

  <div class="page-container">
    <!-- Header banner -->
    <div class="info-header">
      <div class="ih-text">
        <h2>Requests to Change Registration Details</h2>
        <p>Review registered applicants requesting to update their registration and vehicle details. Accepting a request will schedule them for hardcopy compliance and seamlessly move the application into the <strong>Manage Applications</strong> system flow.</p>
      </div>
    </div>

    <!-- Stat cards -->
    <div class="stats-row">
      <div class="stat-card" class:active-card={activeFilter === 'pending'} onclick={() => activeFilter = 'pending'} role="button" tabindex="0">
        <div class="sc-icon pending-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div class="sc-content">
          <div class="sc-count">{counts.pending}</div>
          <div class="sc-label">Pending Requests</div>
        </div>
      </div>

      <div class="stat-card" class:active-card={activeFilter === 'approved'} onclick={() => activeFilter = 'approved'} role="button" tabindex="0">
        <div class="sc-icon approved-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <div class="sc-content">
          <div class="sc-count">{counts.approved}</div>
          <div class="sc-label">Accepted & Scheduled</div>
        </div>
      </div>

      <div class="stat-card" class:active-card={activeFilter === 'rejected'} onclick={() => activeFilter = 'rejected'} role="button" tabindex="0">
        <div class="sc-icon rejected-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <div class="sc-content">
          <div class="sc-count">{counts.rejected}</div>
          <div class="sc-label">Rejected Requests</div>
        </div>
      </div>

      <div class="stat-card" class:active-card={activeFilter === 'all'} onclick={() => activeFilter = 'all'} role="button" tabindex="0">
        <div class="sc-icon all-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
        </div>
        <div class="sc-content">
          <div class="sc-count">{counts.all}</div>
          <div class="sc-label">All Requests</div>
        </div>
      </div>
    </div>

    <!-- Controls section -->
    <div class="controls-bar">
      <!-- Search -->
      <div class="search-box">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input 
          type="text" 
          placeholder="Search by applicant name, plate number, or reason..." 
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="clear-search" onclick={() => searchQuery = ''}>✕</button>
        {/if}
      </div>

      <!-- Filter tabs -->
      <div class="filter-tabs">
        <button class="filter-tab" class:active={activeFilter === 'pending'} onclick={() => activeFilter = 'pending'}>
          Pending ({counts.pending})
        </button>
        <button class="filter-tab" class:active={activeFilter === 'approved'} onclick={() => activeFilter = 'approved'}>
          Accepted ({counts.approved})
        </button>
        <button class="filter-tab" class:active={activeFilter === 'rejected'} onclick={() => activeFilter = 'rejected'}>
          Rejected ({counts.rejected})
        </button>
        <button class="filter-tab" class:active={activeFilter === 'all'} onclick={() => activeFilter = 'all'}>
          All ({counts.all})
        </button>
      </div>
    </div>

    <!-- Requests list -->
    {#if displayedRequests.length === 0}
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
        </svg>
        <h3>No Registration Change Requests Found</h3>
        <p>There are no change requests matching the selected filter.</p>
      </div>
    {:else}
      <div class="requests-grid">
        {#each displayedRequests as req (req.request_id)}
          <div class="request-card" class:is-pending={(req.status || '').toLowerCase() === 'pending'}>
            <!-- Top bar -->
            <div class="rc-header">
              <div class="rc-user-info">
                <div class="rc-avatar">
                  {(req.applicant.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 class="applicant-name">{req.applicant.name}</h3>
                  <div class="applicant-meta">
                    <span class="role-tag">{req.applicant.role}</span>
                    <span class="meta-item">{req.applicant.email}</span>
                    {#if req.applicant.department && req.applicant.department !== '-'}
                      <span class="meta-item">{req.applicant.department}</span>
                    {/if}
                    {#if req.applicant.campus && req.applicant.campus !== '-'}
                      <span class="campus-tag">{req.applicant.campus}</span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="rc-status-box">
                {#if (req.status || '').toLowerCase() === 'pending'}
                  <span class="status-badge badge-pending">Pending Review</span>
                {:else if ['approved', 'completed'].includes((req.status || '').toLowerCase())}
                  <span class="status-badge badge-approved">Accepted & Scheduled</span>
                {:else if (req.status || '').toLowerCase() === 'rejected'}
                  <span class="status-badge badge-rejected">Rejected</span>
                {/if}
                <span class="req-date">Requested: {formatDateTime(req.requested_at)}</span>
              </div>
            </div>

            <!-- Reason Callout -->
            <div class="reason-banner">
              <div class="rb-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>Applicant's Reason for Registration Change:</span>
              </div>
              <div class="rb-content">
                "{req.reason}"
              </div>
            </div>

            <!-- Vehicle comparison grid -->
            <div class="vehicle-comparison">
              <!-- Current Vehicle -->
              <div class="veh-box current-veh">
                <div class="vb-header">
                  <span class="vb-tag old-tag">CURRENT VEHICLE</span>
                  <span class="vb-plate">{req.current_vehicle.plate_number}</span>
                </div>
                <div class="vb-details">
                  <div class="vbd-item">
                    <span class="vbd-label">Make / Model:</span>
                    <span class="vbd-val">{req.current_vehicle.brand}</span>
                  </div>
                  <div class="vbd-item">
                    <span class="vbd-label">Color:</span>
                    <span class="vbd-val">{req.current_vehicle.color}</span>
                  </div>
                  <div class="vbd-item">
                    <span class="vbd-label">Vehicle Type:</span>
                    <span class="vbd-val">{req.current_vehicle.type}</span>
                  </div>
                </div>
              </div>

              <!-- Transition Icon -->
              <div class="comparison-arrow">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>

              <!-- New Vehicle -->
              <div class="veh-box new-veh">
                <div class="vb-header">
                  <span class="vb-tag new-tag">REQUESTED NEW VEHICLE</span>
                  <span class="vb-plate highlight-plate">{req.new_vehicle.plate_number}</span>
                </div>
                <div class="vb-details">
                  <div class="vbd-item">
                    <span class="vbd-label">Make / Model:</span>
                    <span class="vbd-val font-bold">{req.new_vehicle.brand}</span>
                  </div>
                  <div class="vbd-item">
                    <span class="vbd-label">Color:</span>
                    <span class="vbd-val">{req.new_vehicle.color}</span>
                  </div>
                  <div class="vbd-item">
                    <span class="vbd-label">Vehicle Type:</span>
                    <span class="vbd-val">{req.new_vehicle.type}</span>
                  </div>
                  <div class="vbd-item">
                    <span class="vbd-label">Owner:</span>
                    <span class="vbd-val">{req.new_vehicle.is_owner ? 'Yes (Registered Owner)' : 'No (Authorized)'}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Documents section -->
            <div class="documents-section">
              <span class="docs-title">Submitted Documents for New Vehicle:</span>
              <div class="docs-list">
                {#if req.new_vehicle.doc_or}
                  <button class="doc-btn" onclick={() => previewDocUrl = req.new_vehicle.doc_or}>
                    📄 Official Receipt (OR)
                  </button>
                {/if}
                {#if req.new_vehicle.doc_cr}
                  <button class="doc-btn" onclick={() => previewDocUrl = req.new_vehicle.doc_cr}>
                    📄 Cert. of Reg (CR)
                  </button>
                {/if}
                {#if req.new_vehicle.doc_letter}
                  <button class="doc-btn" onclick={() => previewDocUrl = req.new_vehicle.doc_letter}>
                    ✉️ Authorization Letter
                  </button>
                {/if}
                {#if !req.new_vehicle.doc_or && !req.new_vehicle.doc_cr && !req.new_vehicle.doc_letter}
                  <span class="no-docs">No new document uploads provided.</span>
                {/if}
              </div>
            </div>

            <!-- Action buttons -->
            <div class="rc-actions">
              {#if (req.status || '').toLowerCase() === 'pending'}
                <div class="action-buttons">
                  <button class="btn-reject" onclick={() => openRejectModal(req)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Reject Request
                  </button>
                  <button class="btn-accept" onclick={() => openScheduleModal(req)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Accept & Schedule for Hardcopy Compliance
                  </button>
                </div>
              {:else if ['approved', 'completed'].includes((req.status || '').toLowerCase())}
                <div class="approved-notice">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span>
                    Accepted and scheduled for Hardcopy Compliance: <strong>{formatDateTime(req.applicant.dist_sched)}</strong>. This application is active in <strong>Manage Applications</strong>.
                  </span>
                  <a href="/osa" class="btn-view-manage">View in Manage Applications →</a>
                </div>
              {:else if (req.status || '').toLowerCase() === 'rejected'}
                <div class="rejected-notice">
                  <span>This registration details change request was rejected on {formatDateTime(req.processed_at)}.</span>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ── Schedule Modal for Hardcopy Compliance ── -->
  {#if scheduleModalOpen && selectedRequest}
    <div class="modal-backdrop" onclick={closeScheduleModal}>
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="mc-header">
          <div class="mc-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <div>
            <h3>Schedule Hardcopies Compliance</h3>
            <p>Set a date and time for applicant to bring physical documents to OSA.</p>
          </div>
          <button class="mc-close" onclick={closeScheduleModal}>✕</button>
        </div>

        <div class="mc-body">
          <div class="applicant-summary-box">
            <div><strong>Applicant:</strong> {selectedRequest.applicant.name} ({selectedRequest.applicant.email})</div>
            <div><strong>New Vehicle:</strong> {selectedRequest.new_vehicle.brand} — {selectedRequest.new_vehicle.plate_number}</div>
            <div class="summary-reason"><strong>Reason:</strong> "{selectedRequest.reason}"</div>
          </div>

          <div class="workflow-info-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div>
              <strong>System Application Flow:</strong> Upon accepting, this registration will move to the <em>Hardcopy Compliance Schedules</em> tab in <strong>Manage Applications</strong> labeled as <em>"This application is undergo request to change registration details process"</em>. Following hardcopy compliance and Security document review, OSA Sticker Release will directly move it to Registered.
            </div>
          </div>

          {#if scheduleError}
            <div class="modal-alert-error">{scheduleError}</div>
          {/if}

          <div class="form-group">
            <label for="sched-input">Visit Date & Time for Hardcopy Submission <span class="required">*</span></label>
            <input 
              id="sched-input" 
              type="datetime-local" 
              bind:value={scheduleDateTime}
              class="sched-datetime-input"
            />
          </div>
        </div>

        <div class="mc-footer">
          <button class="btn-cancel" onclick={closeScheduleModal} disabled={schedulingLoading}>
            Cancel
          </button>
          <button class="btn-confirm-schedule" onclick={confirmSchedule} disabled={schedulingLoading}>
            {#if schedulingLoading}
              Saving Schedule...
            {:else}
              Confirm & Move to Applications Flow
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Reject Modal ── -->
  {#if rejectModalOpen && selectedRequest}
    <div class="modal-backdrop" onclick={closeRejectModal}>
      <div class="modal-card" onclick={(e) => e.stopPropagation()}>
        <div class="mc-header">
          <div class="mc-icon reject-modal-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div>
            <h3>Reject Registration Change Request</h3>
            <p>Provide a reason for rejecting this request.</p>
          </div>
          <button class="mc-close" onclick={closeRejectModal}>✕</button>
        </div>

        <div class="mc-body">
          {#if rejectError}
            <div class="modal-alert-error">{rejectError}</div>
          {/if}

          <div class="form-group">
            <label for="reject-reason-input">Reason for Rejection <span class="required">*</span></label>
            <textarea 
              id="reject-reason-input"
              rows="4" 
              placeholder="e.g. Incomplete vehicle documentation, invalid plate, or does not qualify..."
              bind:value={rejectReason}
              class="reject-textarea"
            ></textarea>
          </div>
        </div>

        <div class="mc-footer">
          <button class="btn-cancel" onclick={closeRejectModal} disabled={rejectLoading}>
            Cancel
          </button>
          <button class="btn-confirm-reject" onclick={confirmReject} disabled={rejectLoading}>
            {#if rejectLoading}
              Rejecting...
            {:else}
              Confirm Rejection
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Document Preview Popup ── -->
  {#if previewDocUrl}
    <div class="modal-backdrop" onclick={() => previewDocUrl = null}>
      <div class="doc-preview-card" onclick={(e) => e.stopPropagation()}>
        <div class="dpc-header">
          <span>Document Preview</span>
          <div class="dpc-actions">
            <a href={previewDocUrl} target="_blank" rel="noopener noreferrer" class="dpc-open">Open in New Tab ↗</a>
            <button class="mc-close" onclick={() => previewDocUrl = null}>✕</button>
          </div>
        </div>
        <div class="dpc-body">
          {#if previewDocUrl.toLowerCase().endsWith('.pdf')}
            <iframe src={previewDocUrl} title="Document Preview" width="100%" height="550px"></iframe>
          {:else}
            <img src={previewDocUrl} alt="Document Preview" class="doc-preview-img" />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</AppShell>

<style>
  .page-container {
    padding: 1.5rem 2rem;
    max-width: 1300px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .info-header {
    background: linear-gradient(135deg, rgba(128, 0, 0, 0.05), rgba(212, 175, 55, 0.1));
    border: 1px solid rgba(212, 175, 55, 0.25);
    border-radius: var(--radius-md, 10px);
    padding: 1.25rem 1.5rem;
  }

  .info-header h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.35rem;
    color: var(--maroon, #800000);
    font-weight: 700;
  }

  .info-header p {
    margin: 0;
    color: var(--text-secondary, #4b5563);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  /* Stats row */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .stat-card {
    background: var(--surface, #ffffff);
    border: 1.5px solid var(--border, #e5e7eb);
    border-radius: var(--radius-md, 10px);
    padding: 1rem 1.25rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .stat-card:hover {
    border-color: var(--maroon, #800000);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .stat-card.active-card {
    border-color: var(--maroon, #800000);
    background: rgba(128, 0, 0, 0.03);
    box-shadow: 0 0 0 1px var(--maroon, #800000);
  }

  .sc-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pending-icon { background: #fffbeb; color: #b45309; }
  .approved-icon { background: #f0fdf4; color: #15803d; }
  .rejected-icon { background: #fef2f2; color: #b91c1c; }
  .all-icon { background: #eff6ff; color: #1d4ed8; }

  .sc-count {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary, #111827);
    line-height: 1.2;
  }

  .sc-label {
    font-size: 0.8rem;
    color: var(--text-secondary, #6b7280);
    font-weight: 500;
  }

  /* Controls */
  .controls-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    background: var(--surface, #ffffff);
    padding: 0.875rem 1.25rem;
    border-radius: var(--radius-md, 10px);
    border: 1px solid var(--border, #e5e7eb);
  }

  .search-box {
    position: relative;
    flex: 1;
    min-width: 280px;
    display: flex;
    align-items: center;
  }

  .search-box input {
    width: 100%;
    padding: 0.6rem 2rem 0.6rem 2.25rem;
    border: 1.5px solid var(--border, #e5e7eb);
    border-radius: 8px;
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .search-box input:focus {
    border-color: var(--maroon, #800000);
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    color: #9ca3af;
  }

  .clear-search {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: #9ca3af;
  }

  .filter-tabs {
    display: flex;
    gap: 0.5rem;
  }

  .filter-tab {
    padding: 0.5rem 0.875rem;
    border-radius: 6px;
    border: 1px solid var(--border, #e5e7eb);
    background: var(--surface, #ffffff);
    color: var(--text-secondary, #4b5563);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-tab:hover {
    border-color: var(--maroon, #800000);
  }

  .filter-tab.active {
    background: var(--maroon, #800000);
    color: #ffffff;
    border-color: var(--maroon, #800000);
  }

  /* Requests Grid */
  .requests-grid {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .request-card {
    background: var(--surface, #ffffff);
    border: 1.5px solid var(--border, #e5e7eb);
    border-radius: var(--radius-md, 12px);
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .request-card.is-pending {
    border-left: 4px solid #f59e0b;
  }

  .rc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .rc-user-info {
    display: flex;
    gap: 0.875rem;
    align-items: center;
  }

  .rc-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(128, 0, 0, 0.1);
    color: var(--maroon, #800000);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.95rem;
    border: 1.5px solid rgba(128, 0, 0, 0.2);
  }

  .applicant-name {
    margin: 0 0 0.25rem 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary, #111827);
  }

  .applicant-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.8rem;
    color: var(--text-secondary, #6b7280);
  }

  .role-tag {
    background: #e0e7ff;
    color: #3730a3;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.7rem;
  }

  .campus-tag {
    background: #fef3c7;
    color: #92400e;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.7rem;
  }

  .meta-item {
    color: var(--text-secondary, #6b7280);
  }

  .rc-status-box {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .status-badge {
    padding: 0.25rem 0.65rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .badge-pending { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .badge-approved { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
  .badge-rejected { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }

  .req-date {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  /* Reason Banner */
  .reason-banner {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .rb-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: #92400e;
  }

  .rb-content {
    font-size: 0.95rem;
    color: #78350f;
    font-style: italic;
    line-height: 1.4;
    padding-left: 1.6rem;
  }

  /* Vehicle Comparison */
  .vehicle-comparison {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 1rem;
    align-items: center;
  }

  @media (max-width: 768px) {
    .vehicle-comparison {
      grid-template-columns: 1fr;
    }
    .comparison-arrow {
      transform: rotate(90deg);
      margin: 0.5rem auto;
    }
  }

  .veh-box {
    background: #f9fafb;
    border: 1.5px solid var(--border, #e5e7eb);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .veh-box.new-veh {
    background: rgba(212, 175, 55, 0.05);
    border-color: rgba(212, 175, 55, 0.4);
  }

  .vb-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    padding-bottom: 0.5rem;
  }

  .vb-tag {
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .old-tag { color: #6b7280; }
  .new-tag { color: var(--maroon, #800000); }

  .vb-plate {
    font-family: monospace;
    font-weight: 700;
    font-size: 0.9rem;
    background: #ffffff;
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 4px;
  }

  .highlight-plate {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
  }

  .vb-details {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .vbd-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.825rem;
  }

  .vbd-label {
    color: #6b7280;
  }

  .vbd-val {
    font-weight: 600;
    color: var(--text-primary, #111827);
  }

  .comparison-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gold, #d4af37);
  }

  /* Documents */
  .documents-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .docs-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #6b7280;
  }

  .docs-list {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .doc-btn {
    padding: 0.4rem 0.75rem;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #374151;
    cursor: pointer;
    transition: all 0.15s;
  }

  .doc-btn:hover {
    background: #e5e7eb;
    border-color: var(--maroon, #800000);
    color: var(--maroon, #800000);
  }

  .no-docs {
    font-size: 0.8rem;
    color: #9ca3af;
    font-style: italic;
  }

  /* Actions */
  .rc-actions {
    border-top: 1px solid var(--border, #e5e7eb);
    padding-top: 1rem;
  }

  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .btn-reject {
    padding: 0.6rem 1rem;
    border-radius: 8px;
    border: 1.5px solid #ef4444;
    background: transparent;
    color: #ef4444;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.2s;
  }

  .btn-reject:hover {
    background: #fef2f2;
  }

  .btn-accept {
    padding: 0.6rem 1.25rem;
    border-radius: 8px;
    border: none;
    background: var(--maroon, #800000);
    color: #ffffff;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.2s;
  }

  .btn-accept:hover {
    background: #600000;
    box-shadow: 0 4px 10px rgba(128, 0, 0, 0.2);
  }

  .approved-notice {
    background: #f0fdf4;
    border: 1px solid #86efac;
    color: #166534;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }

  .btn-view-manage {
    margin-left: auto;
    font-weight: 700;
    color: var(--maroon, #800000);
    text-decoration: underline;
    font-size: 0.85rem;
  }

  .rejected-notice {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #991b1b;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1.5rem;
    color: #9ca3af;
    background: var(--surface, #ffffff);
    border-radius: 12px;
    border: 1.5px dashed var(--border, #e5e7eb);
  }

  .empty-state h3 {
    margin: 1rem 0 0.5rem 0;
    color: var(--text-primary, #374151);
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 1000;
    backdrop-filter: blur(3px);
  }

  .modal-card {
    background: #ffffff;
    border-radius: 14px;
    width: 100%;
    max-width: 550px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: modalPop 0.2s ease-out;
  }

  @keyframes modalPop {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .mc-header {
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #f3f4f6;
    display: flex;
    align-items: center;
    gap: 0.875rem;
    position: relative;
  }

  .mc-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: rgba(128, 0, 0, 0.1);
    color: var(--maroon, #800000);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reject-modal-icon {
    background: #fee2e2;
    color: #b91c1c;
  }

  .mc-header h3 {
    margin: 0;
    font-size: 1.15rem;
    color: #111827;
  }

  .mc-header p {
    margin: 0.2rem 0 0 0;
    font-size: 0.8rem;
    color: #6b7280;
  }

  .mc-close {
    position: absolute;
    right: 1.25rem;
    top: 1.25rem;
    background: none;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    color: #9ca3af;
  }

  .mc-body {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .applicant-summary-box {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0.875rem 1rem;
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .summary-reason {
    color: #92400e;
    font-style: italic;
  }

  .workflow-info-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1e40af;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.825rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    line-height: 1.4;
  }

  .modal-alert-error {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    padding: 0.65rem 0.875rem;
    border-radius: 6px;
    font-size: 0.825rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-group label {
    font-size: 0.825rem;
    font-weight: 600;
    color: #374151;
  }

  .required { color: #dc2626; }

  .sched-datetime-input {
    padding: 0.75rem;
    border: 1.5px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.95rem;
    outline: none;
  }

  .sched-datetime-input:focus {
    border-color: var(--maroon, #800000);
  }

  .reject-textarea {
    padding: 0.75rem;
    border: 1.5px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.875rem;
    resize: vertical;
    outline: none;
  }

  .reject-textarea:focus {
    border-color: #ef4444;
  }

  .mc-footer {
    padding: 1rem 1.5rem;
    background: #f9fafb;
    border-top: 1px solid #f3f4f6;
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .btn-cancel {
    padding: 0.6rem 1rem;
    border: 1px solid #d1d5db;
    background: #ffffff;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-confirm-schedule {
    padding: 0.6rem 1.25rem;
    border: none;
    background: var(--maroon, #800000);
    color: #ffffff;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-confirm-schedule:disabled, .btn-confirm-reject:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-confirm-reject {
    padding: 0.6rem 1.25rem;
    border: none;
    background: #dc2626;
    color: #ffffff;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  /* Document Preview */
  .doc-preview-card {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 800px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .dpc-header {
    padding: 1rem 1.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #e5e7eb;
    font-weight: 700;
  }

  .dpc-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .dpc-open {
    font-size: 0.825rem;
    color: var(--maroon, #800000);
    text-decoration: underline;
  }

  .dpc-body {
    padding: 1rem;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .doc-preview-img {
    max-width: 100%;
    max-height: 65vh;
    border-radius: 6px;
    object-fit: contain;
  }

  /* ── Responsive Enhancements ── */
  @media (max-width: 768px) {
    .controls-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
      padding: 0.85rem;
    }

    .search-box {
      min-width: 0;
      width: 100%;
    }

    .filter-tabs {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .filter-tab {
      flex: 1;
      text-align: center;
      padding: 0.5rem 0.5rem;
      font-size: 0.75rem;
    }

    .rc-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .rc-status-box {
      align-items: flex-start;
      width: 100%;
    }

    .action-buttons {
      width: 100%;
      flex-direction: column;
    }

    .btn-reject, .btn-accept {
      width: 100%;
      justify-content: center;
    }

    .modal-card, .doc-preview-card {
      width: 95vw;
      max-width: 95vw;
      border-radius: 12px;
    }

    .mc-header, .mc-body, .mc-footer {
      padding: 1rem;
    }
  }

  @media (max-width: 480px) {
    .request-card {
      padding: 1rem 0.75rem;
    }

    .stats-summary-grid {
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }

    .stat-card {
      padding: 0.75rem;
    }

    .sc-count {
      font-size: 1.25rem;
    }
  }
</style>
