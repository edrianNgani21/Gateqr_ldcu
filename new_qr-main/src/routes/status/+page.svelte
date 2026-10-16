<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import ApplicationCard from '$lib/components/ApplicationCard.svelte';
    import { invalidateAll } from '$app/navigation';
    import { startLiveSync } from '$lib/utils/liveSync';
    import type { PageData } from './$types';

    let { data }: { data: PageData } = $props();

    // Pure realtime WebSocket sync for applicant status updates without background polling
    $effect(() => {
        return startLiveSync({
            channelName: 'applicant-status-realtime',
            tables: ['registration', 'modification_request']
        });
    });

    async function handleLogout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    }

    // Convert to any[] to avoid TypeScript strict property checks
    let app = $derived((data.application as any) || null);
    let changeRequest = $derived((data.changeRequest as any) || null);
    let skipDean = $derived(app ? ['visitor', 'concessionaire'].includes(app.role) : false);

    // Vehicle change modal state
    let changeModalOpen = $state(false);
    let changeReason = $state('');
    let newMake = $state('');
    let newPlate = $state('');
    let newColor = $state('');
    let newType = $state('4-wheeler');
    let newIsOwner = $state('yes');

    let changeFiles = $state({
        or: null as File | null,
        cr: null as File | null,
        license: null as File | null,
        letter: null as File | null
    });

    let changeLoading = $state(false);
    let changeError = $state('');

    function handleFileChange(key: keyof typeof changeFiles, e: Event) {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const f = input.files[0];
            const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
            if (!isPdf) {
                alert('Only PDF files are allowed.');
                input.value = '';
                return;
            }
            changeFiles[key] = f;
        } else {
            changeFiles[key] = null;
        }
    }

    async function submitChangeRequest() {
        if (!changeReason.trim()) {
            changeError = 'Please provide the reason why you need to change registration details.';
            return;
        }
        if (!newMake.trim() || !newPlate.trim()) {
            changeError = 'Please provide the new vehicle make and plate number.';
            return;
        }

        changeLoading = true;
        changeError = '';

        try {
            const formData = new FormData();
            formData.append('reason', changeReason.trim());
            formData.append('vehicle_make', newMake.trim());
            formData.append('vehicle_plate', newPlate.trim());
            formData.append('vehicle_color', newColor.trim() || 'Not Specified');
            formData.append('vehicle_type', newType);
            formData.append('is_owner', newIsOwner);
            if (app?.id) formData.append('registration_id', String(app.id));

            if (changeFiles.or) formData.append('doc_or', changeFiles.or);
            if (changeFiles.cr) formData.append('doc_cr', changeFiles.cr);
            if (changeFiles.license) formData.append('doc_license', changeFiles.license);
            if (changeFiles.letter) formData.append('doc_letter', changeFiles.letter);

            const res = await fetch('/api/change-vehicle/request', {
                method: 'POST',
                body: formData
            });

            const resData = await res.json();
            if (!res.ok) {
                changeError = resData.error || 'Failed to submit change request.';
            } else {
                alert('Your request to change registration details has been submitted to OSA for review!');
                changeModalOpen = false;
                changeReason = '';
                newMake = '';
                newPlate = '';
                newColor = '';
                await invalidateAll();
            }
        } catch (e: any) {
            changeError = e.message || 'Network error.';
        } finally {
            changeLoading = false;
        }
    }

    // Helpers to determine step states
    function stepStatus(app: any, stepNum: number) {
        if (!app) return 'pending';
        const s = (app.status || '').toLowerCase();
        
        if (s === 'rejected' || s === 'revoked') return 'rejected';
        
        if (stepNum === 1) { // College Head Approval
            if (['visitor', 'concessionaire'].includes(app.role)) return 'done';
            if (['dept_validated', 'osa_val', 'osa_validated', 'security_checked', 'sticker_released', 'sticker_installed', 'approved', 'distributed', 'completed', 'expired'].includes(s) || app.dept_val_at) return 'done';
            if (s === 'dept_val' || s === 'pending') return 'active';
            return 'pending';
        }

        if (stepNum === 2) { // OSA Review and Schedule
            if (['osa_validated', 'security_checked', 'sticker_released', 'sticker_installed', 'approved', 'distributed', 'completed', 'expired'].includes(s) || app.osa_val_at || app.schedule || app.dist_sched) return 'done';
            if (s === 'dept_validated' || s === 'osa_val' || (['visitor', 'concessionaire'].includes(app.role) && s === 'pending')) return 'active';
            return 'pending';
        }

        if (stepNum === 3) { // OSA Checked Hardcopies
            if (app.osa_dist_at || ['distributed', 'security_checked', 'sticker_released', 'sticker_installed', 'approved', 'completed', 'expired'].includes(s)) return 'done'; 
            if (['osa_validated'].includes(s)) return 'active'; 
            return 'pending';
        }

        if (stepNum === 4) { // Security Check Hardcopies
            if (app.security_check_at || app.security_checked_at || ['security_checked', 'sticker_released', 'sticker_installed', 'completed', 'approved', 'expired'].includes(s)) return 'done'; 
            if (s === 'distributed' || app.osa_dist_at) return 'active';
            return 'pending';
        }

        if (stepNum === 5) { // OSA Release Sticker
            if (app.sticker_released_at || ['sticker_released', 'sticker_installed', 'completed', 'approved'].includes(s)) return 'done';
            if (s === 'security_checked' || app.security_check_at || app.security_checked_at) return 'active';
            return 'pending';
        }

        if (stepNum === 6) { // Security Installed Sticker
            if (app.sticker_installed_at || ['sticker_installed', 'approved'].includes(s)) return 'done';
            if (s === 'sticker_released' || s === 'completed' || app.sticker_released_at) return 'active';
            return 'pending';
        }

        return 'pending';
    }
</script>

<svelte:head>
  <title>Application Status — GateQR</title>
  <meta name="description" content="Track the status of your vehicle sticker application at Liceo de Cagayan University." />
</svelte:head>

<AppShell userRole="applicant" userEmail={data.userEmail} showSidebar={false}>
  <!-- Welcome Banner matching Dashboard Aesthetic -->
  <div class="welcome-banner">
    <div class="wb-content">
      <h1 class="wb-title">Welcome to GateQR!</h1>
      <p class="wb-sub">Track your vehicle sticker application status in real-time.</p>
    </div>
    <div class="wb-icon-shield">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
  </div>

  {#if app}
    {#if app.status === 'rejected' || app.status === 'revoked'}
      <div class="alert-box alert-error">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <p class="alert-title">Application {app.status}</p>
          <p class="alert-desc">{app.invalid_reason || 'No reason provided.'}</p>
        </div>
      </div>
      <a href="/" class="btn-reapply">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Submit New Application
      </a>
    {:else if app.status === 'expired' || (app.expires_at && new Date(app.expires_at).getTime() < Date.now())}
      <div class="alert-box alert-warning">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div>
          <p class="alert-title">Sticker Expired</p>
          <p class="alert-desc">Your parking sticker has expired{app.expires_at ? ` on ${new Date(app.expires_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` : ''}. Please renew your registration for the new School Year.</p>
        </div>
      </div>

      {#if data.applicationOpen === false}
        <div class="alert-box alert-closed" style="margin-top: 1rem; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 1rem; display: flex; align-items: flex-start; gap: 0.75rem;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#be123c" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <div>
            <p style="font-weight: 600; color: #9f1239; margin: 0 0 0.25rem 0; font-size: 0.95rem;">Applications are Currently Closed</p>
            <p style="color: #be123c; margin: 0; font-size: 0.85rem; line-height: 1.4;">The Office of Student Affairs (OSA) has temporarily closed vehicle registrations and renewals. Please check back later or contact OSA.</p>
          </div>
        </div>
      {:else}
        <a href="/?renew=true" class="btn-renew" style="display: inline-flex; align-items: center; gap: 0.5rem; background: #7A1734; color: white; padding: 0.75rem 1.25rem; border-radius: 8px; font-weight: 600; font-size: 0.9rem; text-decoration: none; margin-top: 1rem; transition: background 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Renew Registration
        </a>
      {/if}
    {:else}
      <!-- Progress Steps -->
      <div class="progress-steps">
        {#if !skipDean}
        <div class="progress-step" class:step-done={stepStatus(app, 1) === 'done'} class:step-active={stepStatus(app, 1) === 'active'} class:step-pending={stepStatus(app, 1) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 1) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              1
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step 1 — Department Head or Dean Approval</span>
            <span class="ps-desc">Wait for your Department Head or Dean to approve your Parking Agreement Form.</span>
          </div>
        </div>

        <div class="ps-connector"></div>
        {/if}

        <div class="progress-step" class:step-done={stepStatus(app, 2) === 'done'} class:step-active={stepStatus(app, 2) === 'active'} class:step-pending={stepStatus(app, 2) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 2) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              {skipDean ? 1 : 2}
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step {skipDean ? 1 : 2} — OSA Application Review</span>
            <span class="ps-desc">Wait for the Office of Student Affairs (OSA) to review your application details and schedule your office visit.</span>
            {#if app.dist_sched || app.schedule}
              <div class="sched-pill" class:sched-overdue={!app.osa_dist_at && new Date(app.dist_sched || app.schedule) < new Date()}>
                Schedule: {new Date(app.dist_sched || app.schedule).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'})}
                {#if !app.osa_dist_at && new Date(app.dist_sched || app.schedule) < new Date()}
                  <span style="color: #dc2626; font-weight: bold; margin-left: 0.5rem;">(OVERDUE)</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <div class="ps-connector"></div>

        <div class="progress-step" class:step-done={stepStatus(app, 3) === 'done'} class:step-active={stepStatus(app, 3) === 'active'} class:step-pending={stepStatus(app, 3) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 3) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              {skipDean ? 2 : 3}
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step {skipDean ? 2 : 3} — OSA Document Verification</span>
            <span class="ps-desc">Visit the OSA Office and present your physical documents for verification against the information and files you submitted online.</span>
            {#if app.osa_dist_at}
              <div class="sched-pill sched-done">Checked by OSA: {new Date(app.osa_dist_at).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'})}</div>
            {/if}
          </div>
        </div>

        <div class="ps-connector"></div>

        <div class="progress-step" class:step-done={stepStatus(app, 4) === 'done'} class:step-active={stepStatus(app, 4) === 'active'} class:step-pending={stepStatus(app, 4) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 4) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              {skipDean ? 3 : 4}
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step {skipDean ? 3 : 4} — Safety and Security Verification</span>
            <span class="ps-desc">Visit the Safety and Security Office to have your physical documents inspected and verified.</span>
            {#if app.security_checked_at}
              <div class="sched-pill sched-done">Checked by Security: {new Date(app.security_checked_at).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'})}</div>
            {/if}
          </div>
        </div>

        <div class="ps-connector"></div>

        <div class="progress-step" class:step-done={stepStatus(app, 5) === 'done'} class:step-active={stepStatus(app, 5) === 'active'} class:step-pending={stepStatus(app, 5) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 5) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              {skipDean ? 4 : 5}
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step {skipDean ? 4 : 5} — Final Review and Sticker Release</span>
            <span class="ps-desc">Return to the OSA Office for a review of the verification marks from Safety and Security. Settle the required payment at the Registrar's Office and claim your vehicle sticker.</span>
            {#if app.sticker_released_at}
              <div class="sched-pill sched-done">Released by OSA: {new Date(app.sticker_released_at).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'})}</div>
            {/if}
          </div>
        </div>

        <div class="ps-connector"></div>

        <div class="progress-step" class:step-done={stepStatus(app, 6) === 'done'} class:step-active={stepStatus(app, 6) === 'active'} class:step-pending={stepStatus(app, 6) === 'pending'}>
          <div class="ps-icon">
            {#if stepStatus(app, 6) === 'done'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            {/if}
          </div>
          <div class="ps-info">
            <span class="ps-label">Step {skipDean ? 5 : 6} — Vehicle Sticker Installation (Mandatory)</span>
            <span class="ps-desc">Proceed to the Safety and Security Office to have your vehicle sticker installed. This step is mandatory to complete your vehicle registration process.</span>
            {#if app.sticker_installed_at}
              <div class="sched-pill sched-done">Installed: {new Date(app.sticker_installed_at).toLocaleString('en-US', {dateStyle: 'medium', timeStyle: 'short'})} — Registration Completed</div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <ApplicationCard 
      data={{
      id: app.id || '-',
      name: `${app.first_name} ${app.last_name}`,
      role: app.role,
      email: data.userEmail,
      department: app.department_name || '-',
      'dept. email': app.department_email || '-',
      campus: app.campus || '-',
      'year level': app.role === 'student' ? (app.year_level || '-') : undefined,
      vehicle: app.vehicle_make,
      color: app.vehicle_color,
      plate: app.vehicle_plate,
      owner: app.is_owner ? 'Yes' : 'No',
      status: app.status,
      crd: app.created_at,
      sgn: app.dept_val_at,
      apv: app.osa_val_at,
      sch: app.dist_sched,
      exp: app.expires_at,
      dlv: app.osa_dist_at,
      rejection_reason: app.invalid_reason || null,
      documents: {
        id: app.doc_id,
        enrollment: app.doc_load,
        or: app.doc_or,
        cr: app.doc_cr,
        license: app.doc_license,
        letter: app.doc_letter
      }
    }}
    showQR={false}
    tab="status"
    showDocs={true}>
    </ApplicationCard>

    <!-- ── Vehicle Change Request Section ── -->
    {#if app && (['completed', 'approved', 'sticker_installed', 'Sticker_Installed'].includes(app.status) || app.sticker_installed_at || changeRequest)}
      <div class="change-request-section">
        {#if changeRequest && ['pending', 'Pending'].includes(changeRequest.status)}
          <div class="cr-status-box cr-status-pending">
            <div class="crs-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="crs-content">
              <strong>Pending Request to Change Registration Details</strong>
              <p>Your request to change registration details to <em>{changeRequest.new_vehicle?.brand || ''} ({changeRequest.new_vehicle?.plate_number || ''})</em> is currently under review by OSA.</p>
              <div class="crs-reason">Reason: "{changeRequest.reason}"</div>
            </div>
          </div>
        {:else if changeRequest && ['approved', 'Approved', 'in_progress'].includes(changeRequest.status)}
          <div class="cr-status-box cr-status-approved">
            <div class="crs-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div class="crs-content">
              <strong>Request to Change Vehicle Accepted!</strong>
              {#if app.status === 'approved' && app.sticker_released_at}
                <p>Your request to change vehicle has been finalized and your new vehicle is now officially registered.</p>
              {:else if app.dist_sched || app.schedule}
                <p>Your request has been accepted! Please visit the OSA Office on <strong>{new Date(app.dist_sched || app.schedule).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</strong> to comply with your hard copy requirements for your new vehicle.</p>
                <div class="crs-sched">Scheduled Visit for Hardcopy Compliance: <strong>{new Date(app.dist_sched || app.schedule).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</strong></div>
              {:else}
                <p>Your request has been accepted! Please visit the OSA Office at your scheduled date and time to comply with your hard copy requirements for your new vehicle.</p>
              {/if}
            </div>
          </div>
        {:else}
          <div class="cr-action-bar">
            <div class="cr-action-info">
              <h4>Need to change your registration details?</h4>
              <p>Submit a request with your new vehicle details and reason to update your registration.</p>
            </div>
            <button class="btn-change-vehicle" onclick={() => { changeModalOpen = true; changeError = ''; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
              Request to Change Registration Details
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- ── Request to Change Vehicle Modal ── -->
    {#if changeModalOpen}
      <div class="modal-backdrop" onclick={() => { if (!changeLoading) changeModalOpen = false; }}>
        <div class="modal-card" onclick={(e) => e.stopPropagation()}>
          <div class="mc-header">
            <div class="mc-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
            </div>
            <div>
              <h3>Request to Change Registration Details</h3>
              <p>Submit your reason and new vehicle details for OSA evaluation.</p>
            </div>
            <button class="mc-close" onclick={() => { if (!changeLoading) changeModalOpen = false; }}>✕</button>
          </div>

          <div class="mc-body">
            {#if changeError}
              <div class="modal-alert-error">{changeError}</div>
            {/if}

            <div class="form-group">
              <label for="change-reason">Reason to Change Registration Details <span class="required">*</span></label>
              <textarea 
                id="change-reason"
                rows="3" 
                placeholder="Explain why you need to change your vehicle information (e.g. Sold previous car, bought new vehicle, replacement)..."
                bind:value={changeReason}
                class="form-input"
              ></textarea>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label for="veh-make">New Make / Brand <span class="required">*</span></label>
                <input id="veh-make" type="text" placeholder="e.g. Toyota Vios, Honda Beat" bind:value={newMake} class="form-input" />
              </div>

              <div class="form-group">
                <label for="veh-plate">New Plate Number <span class="required">*</span></label>
                <input id="veh-plate" type="text" placeholder="e.g. ABC 1234 / 123ABC" bind:value={newPlate} class="form-input" />
              </div>

              <div class="form-group">
                <label for="veh-color">Color</label>
                <input id="veh-color" type="text" placeholder="e.g. Black, White, Red" bind:value={newColor} class="form-input" />
              </div>

              <div class="form-group">
                <label for="veh-type">Vehicle Type</label>
                <select id="veh-type" bind:value={newType} class="form-input">
                  <option value="4-Wheeler / Car">4-Wheeler</option>
                  <option value="2-Wheeler / Motorcycle">2-Wheeler</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="veh-owner">Are you the registered owner of this vehicle?</label>
              <select id="veh-owner" bind:value={newIsOwner} class="form-input">
                <option value="yes">Yes, I am the owner</option>
                <option value="no">No, authorized by owner</option>
              </select>
            </div>

            <div class="upload-section">
              <span class="upload-title">New Vehicle Documents (PDF format):</span>
              <div class="form-grid">
                <div class="form-group">
                  <label for="doc-or">Official Receipt (OR)</label>
                  <input id="doc-or" type="file" accept=".pdf" onchange={(e) => handleFileChange('or', e)} class="file-input" />
                </div>
                <div class="form-group">
                  <label for="doc-cr">Cert. of Registration (CR)</label>
                  <input id="doc-cr" type="file" accept=".pdf" onchange={(e) => handleFileChange('cr', e)} class="file-input" />
                </div>
              </div>
            </div>
          </div>

          <div class="mc-footer">
            <button class="btn-cancel" onclick={() => changeModalOpen = false} disabled={changeLoading}>
              Cancel
            </button>
            <button class="btn-submit-change" onclick={submitChangeRequest} disabled={changeLoading}>
              {#if changeLoading}
                Submitting Request...
              {:else}
                Submit Registration Change Request
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="no-app">
      <p>You have not submitted a vehicle application yet.</p>
      <a href="/" class="btn-apply">Submit Application</a>
    </div>
  {/if}

  <p class="form-footer">
    Issues? Contact <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>
  </p>
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

  .wb-logout {
    background: #6b1a2a;
  }

  .wb-logout:hover {
    background: #5a1624;
  }

  .wb-action:hover {
    background: #551320;
    box-shadow: 0 4px 12px rgba(107,26,42,0.35);
  }

  .wb-action-alert {
    animation: pulse-alert 2s ease-in-out infinite;
  }

  @keyframes pulse-alert {
    0%, 100% { box-shadow: 0 2px 8px rgba(220,38,38,0.3); }
    50% { box-shadow: 0 2px 16px rgba(220,38,38,0.6); }
  }

  .wb-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 9px;
    height: 9px;
    background: #ef4444;
    border-radius: 50%;
    border: 1.5px solid var(--surface);
    animation: badge-pulse 1.5s ease-in-out infinite;
  }

  @keyframes badge-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.2); opacity: 0.8; }
  }

  .progress-steps {
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1rem 1.25rem;
    box-shadow: var(--shadow-sm);
  }

  .progress-step {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
  }

  .ps-connector {
    width: 2px;
    height: 24px;
    background: var(--border-light);
    margin-left: 17px;
    margin: 4px 0 4px 17px;
  }

  .ps-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    transition: all 0.2s;
  }

  .step-done .ps-icon {
    background: var(--maroon);
    border-color: var(--maroon);
    color: #fff;
    box-shadow: 0 2px 8px rgba(107,26,42,0.25);
  }

  .ps-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-top: 0.5rem;
  }

  .ps-label {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--maroon);
    line-height: 1.3;
  }

  .step-pending .ps-label { color: var(--text-muted); }

  .ps-desc {
    font-size: 0.825rem;
    font-weight: 400;
    color: var(--text-primary);
    line-height: 1.45;
  }

  .step-pending .ps-desc { color: var(--text-muted); }

  .sched-pill {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--maroon);
    background: var(--maroon-muted);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    display: inline-block;
  }

  .sched-pill.sched-overdue {
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fca5a5;
  }

  .sched-pill.sched-done {
    color: #047857;
    background: #ecfdf5;
  }

  .form-footer {
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .footer-link:hover { text-decoration: underline; }

  .no-app {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }

  .btn-apply {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--maroon);
    color: white;
    border-radius: var(--radius-sm);
    text-decoration: none;
    font-weight: 600;
  }

  .alert-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
  }

  .alert-error {
    background: #fef2f2;
    border: 1.5px solid #fca5a5;
    color: #b91c1c;
    margin-bottom: 0.75rem;
  }

  .alert-warning {
    background: #fffbeb;
    border: 1.5px solid #fde68a;
    color: #b45309;
    margin-bottom: 0.75rem;
  }

  .btn-reapply {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1.25rem;
    background: var(--maroon);
    color: white;
    border-radius: var(--radius-sm);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.85rem;
    box-shadow: 0 4px 12px rgba(107,26,42,0.3);
    transition: background 0.15s, transform 0.15s;
  }

  .btn-reapply:hover {
    background: var(--maroon-light);
    transform: translateY(-1px);
  }

  .alert-title {
    font-weight: 700;
    margin: 0 0 0.2rem;
    text-transform: capitalize;
  }
  
  .alert-desc {
    font-size: 0.85rem;
    margin: 0;
  }

  /* ─── Vehicle Change Request Section ─────────────────────────────────── */
  .change-request-section {
    margin-top: 1.25rem;
    width: 100%;
  }

  .cr-action-bar {
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.08), rgba(128, 0, 0, 0.04));
    border: 1.5px solid #d4af37;
    border-radius: var(--radius-sm, 8px);
    padding: 1.25rem 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .cr-action-info h4 {
    margin: 0 0 0.25rem 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--maroon, #800000);
  }

  .cr-action-info p {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary, #4b5563);
  }

  .btn-change-vehicle {
    padding: 0.65rem 1.25rem;
    background: var(--maroon, #800000);
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: background 0.2s, transform 0.15s;
    box-shadow: 0 2px 8px rgba(128, 0, 0, 0.2);
  }

  .btn-change-vehicle:hover {
    background: #600000;
    transform: translateY(-1px);
  }

  .cr-status-box {
    border-radius: var(--radius-sm, 8px);
    padding: 1.25rem 1.5rem;
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .cr-status-pending {
    background: #fffbeb;
    border: 1.5px solid #fde68a;
    color: #92400e;
  }

  .cr-status-approved {
    background: #f0fdf4;
    border: 1.5px solid #86efac;
    color: #166534;
  }

  .crs-content strong {
    display: block;
    font-size: 0.95rem;
    margin-bottom: 0.25rem;
  }

  .crs-content p {
    margin: 0 0 0.4rem 0;
    font-size: 0.85rem;
  }

  .crs-reason {
    font-size: 0.85rem;
    font-style: italic;
    color: #78350f;
  }

  .crs-sched {
    font-size: 0.85rem;
    color: #15803d;
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
    max-width: min(600px, 95vw);
    max-height: 90vh;
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
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
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

  .form-input {
    padding: 0.65rem 0.85rem;
    border: 1.5px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .form-input:focus {
    border-color: var(--maroon, #800000);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 480px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
  }

  .upload-section {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .upload-title {
    font-size: 0.825rem;
    font-weight: 700;
    color: #374151;
  }

  .file-input {
    font-size: 0.8rem;
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
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-submit-change {
    padding: 0.6rem 1.25rem;
    border: none;
    background: var(--maroon, #800000);
    color: #ffffff;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-submit-change:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
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
    .cr-action-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 0.85rem;
      padding: 1rem;
    }
    .btn-change-vehicle {
      width: 100%;
      justify-content: center;
    }
    .sched-pill {
      word-break: break-word;
      max-width: 100%;
    }
    .modal-card {
      width: 95vw;
      max-width: 95vw;
      border-radius: 12px;
    }
    .mc-header, .mc-body {
      padding: 1rem;
    }
    .mc-footer {
      flex-direction: column;
      padding: 0.85rem 1rem;
    }
    .btn-cancel, .btn-submit-change {
      width: 100%;
      text-align: center;
      justify-content: center;
    }
  }

  @media (max-width: 480px) {
    .welcome-banner {
      padding: 1rem;
    }
    .wb-title {
      font-size: 1.15rem;
    }
    .wb-sub {
      font-size: 0.78rem;
    }
    .progress-steps {
      padding: 0.85rem 0.75rem;
    }
    .ps-info {
      padding-top: 0.25rem;
    }
    .ps-label {
      font-size: 0.8rem;
    }
    .ps-desc {
      font-size: 0.78rem;
    }
  }
</style>