<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import ApplicationCard from '$lib/components/ApplicationCard.svelte';
    import ActionBar from '$lib/components/ActionBar.svelte';
    import { invalidateAll } from '$app/navigation';
    import { supabaseClient } from '$lib/supabaseClient';

    import { startLiveSync } from '$lib/utils/liveSync';

    import { page } from '$app/stores';

    let { data } = $props();
    let apps = $derived((data.applications as any[]) || []);

    // Pure realtime WebSocket sync for instant updates without background polling
    $effect(() => {
        return startLiveSync({
            channelName: 'osa-applications-realtime',
            tables: ['registration', 'change_vehicle_request', 'department']
        });
    });

    let tab = $state('validation');
    const tabs = ['validation', 'distribution', 'release', 'registered', 'rejected', 'revoked', 'overdue'];
    const tabLabels: Record<string, string> = {
        'validation':   'Accept & Schedule Application',
        'distribution': 'Application Schedules for Hardcopy Compliance',
        'release':      'Sticker Release',
        'registered':   'Registered Vehicle',
        'rejected':     'Rejected Applications',
        'revoked':      'Revoked Application',
        'overdue':      'Overdue Application Schedules'
    };

    function getAppsForTab(t: string) {
        if (t === 'validation') return apps.filter(a => ['pending', 'dept_val', 'dept_validated', 'osa_val'].includes((a.status || '').toLowerCase()));
        if (t === 'distribution') return apps.filter(a => ['distributed', 'osa_validated'].includes((a.status || '').toLowerCase()) && !a.osa_dist_at && (!a.schedule && !a.dist_sched || new Date(a.schedule || a.dist_sched) >= new Date() || a.invalid_reason === 'OVERDUE' || a.rejection_reason === 'OVERDUE'));
        if (t === 'overdue') return apps.filter(a => ['distributed', 'osa_validated'].includes((a.status || '').toLowerCase()) && !a.osa_dist_at && (a.schedule || a.dist_sched) && new Date(a.schedule || a.dist_sched) < new Date() && a.invalid_reason !== 'OVERDUE' && a.rejection_reason !== 'OVERDUE');
        if (t === 'release') return apps.filter(a => (['distributed', 'osa_validated', 'security_checked'].includes((a.status || '').toLowerCase()) && (a.security_check_at || a.security_checked_at) && !a.sticker_released_at) || (a.status || '').toLowerCase() === 'security_checked');
        if (t === 'registered') return apps.filter(a => ['completed', 'approved'].includes((a.status || '').toLowerCase()));
        if (t === 'rejected') return apps.filter(a => (a.status || '').toLowerCase() === 'rejected');
        if (t === 'revoked') return apps.filter(a => (a.status || '').toLowerCase() === 'revoked');
        return [];
    }

    $effect(() => {
        const urlTab = $page.url.searchParams.get('tab');
        if (urlTab && tabs.includes(urlTab)) {
            tab = urlTab;
            selectedDistributionApp = null;
            selectedScheduleDate = null;
        }
    });

    const navLinks = [
        { label: 'Applications', href: '/osa' },
        { label: 'Add Admin', href: '/osa/admin' },
        { label: 'Departments', href: '/osa/departments' }
    ];

    let searchQuery = $state('');
    let roleFilter = $state('all'); // 'all', 'student', 'faculty', 'staff'
    let vehicleTypeFilter = $state('all'); // 'all', '2-Wheeler / Motorcycle', '4-Wheeler / Car'
    let selectedCampus = $state('all');

    // Schedule filter state for distribution tab
    let scheduleDropdownOpen = $state(false);
    let selectedScheduleDate = $state<string | null>(null);
    let schedulePanelOpen = $state(false);

    // Bulk selection state
    let selectedApplicationIds = $state<Set<number>>(new Set());
    let bulkActionModalOpen = $state(false);
    let bulkActionType = $state<'accept' | 'reject' | null>(null);
    let bulkSchedule = $state('');
    let bulkReason = $state('');
    let bulkLoading = $state(false);
    let selectedDistributionApp = $state<any>(null);




    // Bulk selection functions
    function toggleSelection(id: number, selected: boolean) {
        if (selected) {
            selectedApplicationIds = new Set([...selectedApplicationIds, id]);
        } else {
            selectedApplicationIds = new Set([...selectedApplicationIds].filter(x => x !== id));
        }
    }

    function selectAll() {
        const newSet = new Set(selectedApplicationIds);
        displayedApps.forEach(app => newSet.add(app.id));
        selectedApplicationIds = newSet;
    }

    function deselectAll() {
        selectedApplicationIds = new Set();
    }

    function isAllSelected() {
        return displayedApps.length > 0 && displayedApps.every(app => selectedApplicationIds.has(app.id));
    }

    function isSomeSelected() {
        return displayedApps.some(app => selectedApplicationIds.has(app.id));
    }

    async function handleBulkAction(action: 'accept' | 'reject') {
        if (selectedApplicationIds.size === 0) {
            alert('Please select at least one application');
            return;
        }
        bulkActionType = action;
        bulkActionModalOpen = true;
    }

    async function submitBulkAction() {
        if (selectedApplicationIds.size === 0) return;

        bulkLoading = true;
        try {
            const ids = Array.from(selectedApplicationIds);

            let scheduleDateTime = null;
            if (bulkActionType === 'accept' && bulkSchedule) {
                scheduleDateTime = new Date(bulkSchedule).toISOString();
            }

            const res = await fetch('/api/osa/bulk-actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    registration_ids: ids,
                    action: bulkActionType,
                    schedule: bulkActionType === 'accept' ? scheduleDateTime : null,
                    reason: bulkActionType === 'reject' ? bulkReason : null
                })
            });

            if (res.ok) {
                alert(`Successfully ${bulkActionType === 'accept' ? 'accepted' : 'rejected'} ${ids.length} application(s)`);
                selectedApplicationIds.clear();
                bulkActionModalOpen = false;
                bulkSchedule = '';
                bulkReason = '';
                await invalidateAll();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error || 'Failed to process bulk action'}`);
            }
        } catch (error) {
            alert('Network error during bulk action');
        } finally {
            bulkLoading = false;
        }
    }

    function cancelBulkAction() {
        if (bulkLoading) return;
        bulkActionModalOpen = false;
        bulkActionType = null;
        bulkSchedule = '';
        bulkReason = '';
    }

    function clickOutside(node: HTMLElement, callback: () => void) {
        const handleClick = (e: MouseEvent) => {
            if (node && !node.contains(e.target as Node) && !e.defaultPrevented) {
                callback();
            }
        };
        document.addEventListener('click', handleClick, true);
        return {
            destroy() {
                document.removeEventListener('click', handleClick, true);
            }
        };
    }

    $effect(() => {
        document.cookie = `osa_active_tab=${tab}; path=/osa; max-age=31536000; SameSite=Lax`;
    });



    let displayedApps = $derived.by(() => {
        let filtered = getAppsForTab(tab);

        console.log('Filtered apps for tab', tab, ':', filtered.length, 'out of', apps.length);
        console.log('All apps before filtering:', apps.map(a => ({ id: a.id, status: a.status, role: a.role, campus: a.campus })));

        if (roleFilter !== 'all') {
            filtered = filtered.filter(a => {
                const r = (a.role || '').toLowerCase().trim();
                if (roleFilter === 'student') return r === 'student';
                if (roleFilter === 'faculty') return r === 'faculty';
                if (roleFilter === 'staff') return r === 'staff' || r === 'employee';
                return r === roleFilter.toLowerCase();
            });
        }

        if (vehicleTypeFilter !== 'all') {
            filtered = filtered.filter(a => {
                const rawType = (a.vehicle_type || a.vehicle_information?.type || '').toLowerCase();
                if (vehicleTypeFilter === '2-Wheeler / Motorcycle' || vehicleTypeFilter === '2-wheeler') {
                    return rawType.includes('2') || rawType.includes('motor') || rawType.includes('bike');
                }
                if (vehicleTypeFilter === '4-Wheeler / Car' || vehicleTypeFilter === '4-wheeler') {
                    return rawType.includes('4') || rawType.includes('car');
                }
                return rawType === vehicleTypeFilter.toLowerCase();
            });
        }

        if (selectedCampus !== 'all') {
            filtered = filtered.filter(a => {
                const c = (a.campus || '').toLowerCase().trim();
                return c === selectedCampus.toLowerCase().trim();
            });
        }

        if (tab === 'distribution' || tab === 'overdue') {
            if (selectedScheduleDate) {
                filtered = filtered.filter(a => {
                    const sched = a.schedule || a.dist_sched;
                    if (!sched) return false;
                    const appDate = new Date(sched).toDateString();
                    const selectedDate = new Date(selectedScheduleDate as string).toDateString();
                    return appDate === selectedDate;
                });
            } else {
                filtered = [];
            }
        }

        if (searchQuery && searchQuery.trim()) {
            const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
            filtered = filtered.filter(a => {
                const searchTarget = [
                    a.first_name,
                    a.last_name,
                    `${a.first_name || ''} ${a.last_name || ''}`,
                    a.student_id,
                    a.id_no,
                    a.user_email,
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
                ].filter(Boolean).map(String).join(' ').toLowerCase();

                return terms.every(term => searchTarget.includes(term));
            });
        }

        return filtered;
    });

    // Get unique scheduled dates for distribution / overdue tab
    let scheduledDates = $derived.by(() => {
        if (tab !== 'distribution' && tab !== 'overdue') return [];
        const distributionApps = getAppsForTab(tab);
        const uniqueDates = new Set<string>();
        distributionApps.forEach(app => {
            const sched = app.schedule || app.dist_sched;
            if (sched) {
                const date = new Date(sched).toDateString();
                uniqueDates.add(date);
            }
        });
        return Array.from(uniqueDates).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    });

    // Number of applications inside each tab (display only)
    let tabCounts = $derived.by(() => {
        return {
            validation: getAppsForTab('validation').length,
            distribution: getAppsForTab('distribution').length,
            overdue: getAppsForTab('overdue').length,
            release: getAppsForTab('release').length,
            registered: getAppsForTab('registered').length,
            rejected: getAppsForTab('rejected').length,
            revoked: getAppsForTab('revoked').length
        } as Record<string, number>;
    });

    let scheduleModalOpen = $state(false);
    let selectedSchedule = $state('');
    let pendingAction = $state<{ id: number; action: string; resolve: () => void } | null>(null);
    let confirmLoading = $state(false);

    let singleSchedule = $state('');

    // Reject / Revoke Reason Modal State
    let reasonModalOpen = $state(false);
    let reasonAction = $state<{ id: number; action: string; applicantName?: string; resolve: () => void } | null>(null);
    let reasonText = $state('');
    let reasonError = $state('');
    let reasonLoading = $state(false);

    async function handleAction(registration_id: number, action: string) {
        if (action === 'accept' || action === 'reschedule') {
            // Return a promise that stays pending until the modal resolves or is cancelled.
            // This keeps ActionBar's loadingAction active (spinner + disabled) the whole time.
            return new Promise<void>((resolve) => {
                pendingAction = { id: registration_id, action, resolve };
                scheduleModalOpen = true;
            });
        }

        if (action === 'reject' || action === 'revoke') {
            const app = apps.find(a => (a.registration_id || a.id) === registration_id);
            const applicantName = app ? `${app.first_name || ''} ${app.last_name || ''}`.trim() : '';
            return new Promise<void>((resolve) => {
                reasonAction = { id: registration_id, action, applicantName, resolve };
                reasonText = '';
                reasonError = '';
                reasonModalOpen = true;
            });
        }

        let reason: string = '';
        if (action === 'proceed_overdue') {
            if (!confirm(`Are you sure you want to proceed this application directly to Hardcopies Compliance?`)) return;
        } else if (action === 'delete' || action === 'unrevoke') {
            if (!confirm(`Are you sure you want to ${action} this application?`)) return;
        }

        await submitAction(registration_id, action, reason);
    }

    async function submitReasonAction() {
        if (!reasonText.trim()) {
            reasonError = `Please provide a reason to ${reasonAction?.action || 'proceed'}.`;
            return;
        }
        if (!reasonAction) return;

        reasonLoading = true;
        try {
            await submitAction(reasonAction.id, reasonAction.action, reasonText.trim());
            const act = reasonAction;
            reasonModalOpen = false;
            reasonAction = null;
            reasonText = '';
            reasonError = '';
            act.resolve();
        } catch (e) {
            reasonError = 'Action failed. Please try again.';
        } finally {
            reasonLoading = false;
        }
    }

    function cancelReasonAction() {
        if (reasonLoading) return;
        reasonModalOpen = false;
        reasonAction?.resolve();
        reasonAction = null;
        reasonText = '';
        reasonError = '';
    }

    async function submitSchedule() {
        let scheduleDateTime = null;
        if (singleSchedule) {
            scheduleDateTime = new Date(singleSchedule).toISOString();
        }

        if (!scheduleDateTime) {
            alert('Please select a complete schedule');
            return;
        }
        if (pendingAction) {
            confirmLoading = true;
            try {
                await submitAction(pendingAction.id, pendingAction.action, '', scheduleDateTime);
            } finally {
                confirmLoading = false;
                scheduleModalOpen = false;
                pendingAction.resolve(); // release ActionBar's loadingAction
            }
        }
        pendingAction = null;
        selectedSchedule = '';
        singleSchedule = '';
    }

    function cancelSchedule() {
        if (confirmLoading) return;
        scheduleModalOpen = false;
        pendingAction?.resolve(); // release ActionBar so the button re-enables
        pendingAction = null;
        selectedSchedule = '';
        singleSchedule = '';
    }

    async function submitAction(registration_id: number, action: string, reason: string = '', schedule: string = '') {
        try {
            const res = await fetch('/api/osa/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ registration_id, action, reason, schedule })
            });

            if (res.ok) {
                selectedDistributionApp = null;
                await invalidateAll();
            } else {
                const err = await res.json();
                alert(err.error || 'Action failed');
            }
        } catch (e) {
            alert('Network error');
        }
    }
</script>

<svelte:head>
  <title>Applications — OSA | GateQR</title>
  <meta name="description" content="Manage vehicle sticker applications at the Office of Student Affairs." />
</svelte:head>

<AppShell userEmail={data.userEmail} showSidebar={true}>
  <NavBar title={tabLabels[tab] || 'Manage Applications'} />

  <div class="applications-container">

    {#if tab === 'overdue'}
      <div class="overdue-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span><strong>Failed to Appear on Schedule:</strong> These applicants were scheduled to visit OSA for <strong>hardcopy submission</strong> but have <strong>not shown up past their scheduled date</strong>. Use <em>Continue Process</em> if they have since complied, or <em>Reschedule</em> to set them a new visit date.</span>
      </div>
    {/if}

    <div class="filters-section">
      <div class="search-container">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          placeholder="Search by name, plate, vehicle..."
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchQuery}
          <button class="search-clear" title="Clear search" aria-label="Clear search" onclick={() => { searchQuery = ''; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        {/if}
      </div>

      <div class="filter-group">
        <select bind:value={roleFilter} class="filter-btn">
          <option value="all">All Roles</option>
          <option value="student">Student</option>
          <option value="faculty">Faculty</option>
          <option value="staff">Staff</option>
        </select>

        <select bind:value={vehicleTypeFilter} class="filter-btn">
          <option value="all">All Vehicles</option>
          <option value="2-Wheeler / Motorcycle">2-Wheelers</option>
          <option value="4-Wheeler / Car">4-Wheelers</option>
        </select>

        <select bind:value={selectedCampus} class="filter-btn">
          <option value="all">All Campuses</option>
          <option value="Liceo Main">Liceo Main</option>
          <option value="RNP">RNP</option>
          <option value="PASEO">PASEO</option>
        </select>
      </div>
    </div>

    <div class="content-layout">
      {#if (tab === 'distribution' || tab === 'overdue') && selectedDistributionApp}
        {@const app = selectedDistributionApp}
        <div class="full-detail-view">
          <button class="back-btn" onclick={() => selectedDistributionApp = null}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            Back to Schedules
          </button>
          
          <div class="detail-card-wrapper">
            <ApplicationCard
              data={{
              id: app.id || '-',
              name: `${app.first_name} ${app.last_name}`,
              role: app.role,
              campus: app.campus,
              'year level': app.year_level || '-',
              email: app.user_email,
              contact: app.mobile || app.contact_number,
              facebook: app.facebook || '-',
              department: app.department_name || '-',
              'dept. email': app.department_email || '-',
              vehicle: app.vehicle_make,
              color: app.vehicle_color,
              'vehicle type': app.vehicle_type,
              plate: app.vehicle_plate,
              owner: app.is_owner ? 'Yes' : 'No',
              status: app.status,
              crd: app.created_at,
              dpt: app.dept_val_at,
              osa: app.osa_val_at,
              sch: app.dist_sched,
              hdc: app.osa_dist_at,
              sec: app.security_checked_at,
              rel: app.sticker_released_at,
              ins: app.sticker_installed_at,
              exp: app.expires_at,
              change_vehicle_request: app.change_vehicle_request,
              is_change_vehicle: app.is_change_vehicle,
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
            startExpanded={true}
            showQR={true}
            {tab}>
              {#snippet children()}
                <ActionBar {tab} status={app.status} expiresAt={app.expires_at} onaction={(action) => handleAction(app.id, action)} />
              {/snippet}
            </ApplicationCard>
          </div>
        </div>
      {:else}
        {#if tab === 'distribution' || tab === 'overdue'}
          {@const tabApps = getAppsForTab(tab)}
          {@const calDates = scheduledDates}
          <div class="schedule-calendar-panel left-panel">
            <div class="table-header">
              <span class="table-title">📅 {tab === 'overdue' ? 'Missed Schedule Dates' : 'Scheduled Dates'}</span>
              <span class="table-count">{calDates.length}</span>
            </div>
            <div class="calendar-list">
              {#if calDates.length > 0}
                {#each calDates as date}
                  <div 
                    class="calendar-item" 
                    class:selected={selectedScheduleDate === date}
                    role="button"
                    tabindex="0"
                    onclick={() => selectedScheduleDate = selectedScheduleDate === date ? null : date}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedScheduleDate = selectedScheduleDate === date ? null : date; }}
                  >
                    <div class="calendar-icon-box">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      <span class="calendar-day-num">{new Date(date).getDate()}</span>
                    </div>
                    <div class="calendar-info">
                      <div class="calendar-date">
                        {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                      <div class="calendar-full-date">
                        {new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>
                    <span class="date-count-badge">
                      {tabApps.filter(a => (a.schedule || a.dist_sched) && new Date(a.schedule || a.dist_sched).toDateString() === date).length} app(s)
                    </span>
                  </div>
                {/each}
              {:else}
                <div class="calendar-empty">
                  <p>No scheduled dates found</p>
                </div>
              {/if}
            </div>
            {#if selectedScheduleDate}
              <div class="calendar-actions">
                <button class="table-btn" onclick={() => selectedScheduleDate = null}>
                  Clear Date Filter
                </button>
              </div>
            {/if}
          </div>
        {/if}

        <div class="applications-list" class:right-panel={tab === 'distribution' || tab === 'overdue'}>
          {#if (tab === 'distribution' || tab === 'overdue') && !selectedScheduleDate}
            <div class="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <h3>No applications</h3>
              <p>Select a date from the schedule on the left to view applicants.</p>
            </div>
          {:else}
            {#each displayedApps as app}
              {#if tab === 'distribution' || tab === 'overdue'}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="app-clickable-wrapper" onclick={() => selectedDistributionApp = app} style="cursor: pointer;">
                  <div style="pointer-events: none;">
                    <ApplicationCard
                      data={{
                      id: app.id || '-',
                      name: `${app.first_name} ${app.last_name}`,
                      'dean approval': (app.status || '').toLowerCase() === 'pending' ? 'Pending' : 'Approved',
                      role: app.role,
                      campus: app.campus,
                      'year level': app.year_level || '-',
                      email: app.user_email,
                      contact: app.mobile || app.contact_number,
                      facebook: app.facebook || '-',
                      department: app.department_name || '-',
                      'dept. email': app.department_email || '-',
                      vehicle: app.vehicle_make,
                      color: app.vehicle_color,
                      'vehicle type': app.vehicle_type,
                      plate: app.vehicle_plate,
                      owner: app.is_owner ? 'Yes' : 'No',
                      status: app.status,
                      crd: app.created_at,
                      dpt: app.dept_val_at,
                      osa: app.osa_val_at,
                      sch: app.dist_sched,
                      hdc: app.osa_dist_at,
                      sec: app.security_checked_at,
                      rel: app.sticker_released_at,
                      ins: app.sticker_installed_at,
                      exp: app.expires_at,
                      change_vehicle_request: app.change_vehicle_request,
                      is_change_vehicle: app.is_change_vehicle,
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
                    showQR={true}
                    {tab}>
                      {#snippet children()}
                        <div style="pointer-events: auto;">
                          <ActionBar {tab} status={app.status} expiresAt={app.expires_at} onaction={(action) => handleAction(app.id, action)} />
                        </div>
                      {/snippet}
                    </ApplicationCard>
                  </div>
                </div>
              {:else}
                <ApplicationCard
                  data={{
                  id: app.id || '-',
                  name: `${app.first_name} ${app.last_name}`,
                  'dean approval': (app.status || '').toLowerCase() === 'pending' ? 'Pending' : 'Approved',
                  role: app.role,
                  campus: app.campus,
                  'year level': app.year_level || '-',
                  email: app.user_email,
                  contact: app.mobile || app.contact_number,
                  facebook: app.facebook || '-',
                  department: app.department_name || '-',
                  'dept. email': app.department_email || '-',
                  vehicle: app.vehicle_make,
                  color: app.vehicle_color,
                  'vehicle type': app.vehicle_type,
                  plate: app.vehicle_plate,
                  owner: app.is_owner ? 'Yes' : 'No',
                  status: app.status,
                  crd: app.created_at,
                  dpt: app.dept_val_at,
                  osa: app.osa_val_at,
                  sch: app.dist_sched,
                  hdc: app.osa_dist_at,
                  sec: app.security_checked_at,
                  rel: app.sticker_released_at,
                  ins: app.sticker_installed_at,
                  exp: app.expires_at,
                  change_vehicle_request: app.change_vehicle_request,
                  is_change_vehicle: app.is_change_vehicle,
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
                selectable={tab === 'validation'}
                selected={selectedApplicationIds.has(app.id)}
                onselect={(selected) => toggleSelection(app.id, selected)}
                showQR={true}
                {tab}>
                  {#snippet children()}
                    <ActionBar {tab} status={app.status} expiresAt={app.expires_at} onaction={(action) => handleAction(app.id, action)} />
                  {/snippet}
                </ApplicationCard>
              {/if}
            {:else}
              <div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <h3>No applications found</h3>
                <p>There are no applications matching your current filters.</p>
                <button class="clear-filters-btn" onclick={() => { 
                  searchQuery = ''; 
                  roleFilter = 'all';
                  vehicleTypeFilter = 'all';
                  selectedCampus = 'all'; 
                  selectedScheduleDate = null; 
                }}>
                  Clear all filters
                </button>
              </div>
            {/each}
          {/if}
        </div>

        {#if tab === 'validation' && selectedApplicationIds.size > 0}
          <div class="selected-apps-table">
            <div class="table-header">
              <span class="table-title">Selected Applications</span>
              <span class="table-count">{selectedApplicationIds.size}</span>
            </div>
            <table class="mini-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Department</th>
                </tr>
              </thead>
              <tbody>
                {#each displayedApps.filter(app => selectedApplicationIds.has(app.id)) as app}
                  <tr>
                    <td>{app.user_email}</td>
                    <td>{app.department_name}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <div class="table-actions">
              <button class="table-btn table-accept" onclick={() => handleBulkAction('accept')}>
                Accept All
              </button>
              <button class="table-btn table-reject" onclick={() => handleBulkAction('reject')}>
                Reject All
              </button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
</div>

  {#if scheduleModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => { if (!confirmLoading) cancelSchedule(); }} onkeydown={(e) => { if (e.key === 'Escape' && !confirmLoading) cancelSchedule(); }} role="dialog" aria-modal="true" tabindex="-1">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <h3>{pendingAction?.action === 'reschedule' ? 'Reschedule OSA Visit' : 'Accept & Schedule Application'}</h3>
        <p>{pendingAction?.action === 'reschedule' ? 'Set a new OSA visit schedule for hardcopy submission' : 'Set an OSA visit schedule for hardcopy submission'}</p>
        <div class="schedule-form">
          <div class="schedule-row">
            <div class="schedule-field">
              <label class="schedule-label">SET SCHEDULE</label>
              <input type="datetime-local" bind:value={singleSchedule} class="sched-input" disabled={confirmLoading} />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" onclick={cancelSchedule} disabled={confirmLoading}>Cancel</button>
          <button class="btn-confirm" onclick={submitSchedule} disabled={confirmLoading} class:btn-confirming={confirmLoading}>
            {#if confirmLoading}
              <svg class="modal-spinner" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
              </svg>
              Confirming…
            {:else}
              Confirm Schedule
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if bulkActionModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => { if (!bulkLoading) cancelBulkAction(); }} onkeydown={(e) => { if (e.key === 'Escape' && !bulkLoading) cancelBulkAction(); }} role="dialog" aria-modal="true" tabindex="-1">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <h3>Selected application</h3>
        <p>
          {#if bulkActionType === 'accept'}
            Set a pickup schedule for all selected applications
          {:else}
            Provide a reason for rejecting all selected applications.
          {/if}
        </p>

        {#if bulkActionType === 'accept'}
          <div class="schedule-form">
            <div class="schedule-row">
              <div class="schedule-field">
                <label class="schedule-label">SET SCHEDULE</label>
                <input type="datetime-local" bind:value={bulkSchedule} class="sched-input" disabled={bulkLoading} />
              </div>
            </div>
          </div>
        {:else}
          <div class="form-group">
            <label class="form-label">Rejection Reason</label>
            <textarea bind:value={bulkReason} class="reason-input" placeholder="Enter rejection reason..." disabled={bulkLoading}></textarea>
          </div>
        {/if}

        <div class="modal-actions">
          <button class="btn-cancel" onclick={cancelBulkAction} disabled={bulkLoading}>Cancel</button>
          <button class="btn-confirm" onclick={submitBulkAction} disabled={bulkLoading} class:btn-confirming={bulkLoading}>
            {#if bulkLoading}
              <svg class="modal-spinner" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
              </svg>
              Processing…
            {:else if bulkActionType === 'accept'}
              Accept All
            {:else}
              Reject All
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

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
            ? 'Provide an official explanation for revoking this registered vehicle. This reason will be logged and visible in application records.'
            : 'Specify why this application is being rejected. This explanation will be displayed directly to the applicant on their status dashboard.'}
        </p>

        <!-- Quick Reason Presets -->
        <div class="reason-presets-section">
          <span class="presets-label">QUICK TEMPLATES</span>
          <div class="presets-chips">
            {#if reasonAction.action === 'revoke'}
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Expired Registration / Semester Renewal Required'}>Expired Registration</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Unauthorized Vehicle / Transfer Violation'}>Transfer Violation</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Campus Traffic & Safety Regulation Violation'}>Traffic Violation</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Revoked by Office of Student Affairs / Administration'}>OSA Order</button>
            {:else}
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Incomplete or unreadable documents uploaded'}>Incomplete Docs</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Expired Official Receipt (OR) or Certificate of Registration (CR)'}>Expired OR/CR</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Vehicle information does not match supporting credentials'}>Unmatched Info</button>
              <button type="button" class="preset-chip" onclick={() => reasonText = 'Discrepancy with official university enrollment / employee records'}>Enrollment Mismatch</button>
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
            placeholder={reasonAction.action === 'revoke' ? 'State the specific reason for revoking this sticker...' : 'State the specific reason for rejecting this application...'}
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
  .applications-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .overdue-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: #fff7ed;
    border: 1.5px solid #fed7aa;
    border-radius: 10px;
    color: #c2410c;
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .overdue-banner svg { flex-shrink: 0; margin-top: 1px; }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .header-content h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
  }

  .header-subtitle {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .header-stats {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .stat-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    min-width: 60px;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--maroon);
    line-height: 1;
  }

  .stat-label {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 0.25rem;
  }

  .filters-section {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 1rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .search-container {
    position: relative;
    flex: 1;
    min-width: 250px;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 1rem;
    color: var(--text-dim);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 0.75rem 2.5rem 0.75rem 2.5rem;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .search-input:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(107, 26, 42, 0.1);
  }

  .search-clear {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s, background 0.2s;
  }

  .search-clear:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .filter-group {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .filter-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .filter-btn:hover {
    border-color: var(--maroon);
  }

  .filter-btn.active {
    background: var(--maroon);
    color: white;
    border-color: var(--maroon);
  }

  .content-layout {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
    width: 100%;
    flex: 1;
    overflow: hidden;
  }

  .applications-list {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding-bottom: 2rem;
  }

  .applications-list.with-schedule-panel {
    max-width: 100%;
  }

  @media (max-width: 1024px) {
    .content-layout {
      flex-direction: column;
      gap: 1.25rem;
    }
    .applications-list {
      max-width: 100%;
    }
    .applications-list.with-schedule-panel {
      max-width: 100%;
    }
    .selected-apps-table {
      width: 100%;
    }
    .schedule-calendar-panel {
      width: 100%;
      max-height: none;
    }
  }

  .selected-apps-table {
    width: 380px;
    background: var(--surface);
    border: 2px solid var(--maroon);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.15);
    flex-shrink: 0;
  }

  .table-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-light);
  }

  .table-title {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .table-count {
    background: var(--maroon);
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .mini-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .mini-table thead {
    background: var(--maroon);
    color: white;
  }

  .mini-table th {
    padding: 0.5rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.75rem;
  }

  .mini-table td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border-light);
    color: var(--text-primary);
  }

  .mini-table tbody tr:last-child td {
    border-bottom: none;
  }

  .table-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: auto;
  }

  .table-btn {
    flex: 1;
    padding: 0.5rem;
    border: none;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .table-accept {
    background: var(--maroon);
    color: white;
  }

  .table-accept:hover {
    background: #8b1a2a;
  }

  .table-reject {
    background: #dc2626;
    color: white;
  }

  .table-reject:hover {
    background: #b91c1c;
  }

  .schedule-calendar-panel {
    width: 380px;
    background: var(--surface);
    border: 2px solid var(--maroon);
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.15);
    flex-shrink: 0;
  }

  .calendar-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .calendar-item {
    padding: 0.75rem;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    cursor: pointer;
    transition: all 0.2s;
  }

  .calendar-item:hover {
    border-color: var(--maroon);
    background: var(--surface-hover);
  }

  .calendar-item.selected {
    border-color: var(--maroon);
    background: rgba(107, 26, 42, 0.1);
  }

  .calendar-date {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .calendar-full-date {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }

  .calendar-empty {
    text-align: center;
    padding: 2rem;
    color: var(--text-dim);
  }

  .calendar-empty p {
    margin: 0;
    font-size: 0.875rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-label {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .reason-input {
    width: 100%;
    padding: 0.75rem;
    border: 1.5px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.875rem;
    font-family: inherit;
    resize: vertical;
    min-height: 80px;
  }

  .reason-input:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(107, 26, 42, 0.1);
  }

  .schedule-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .schedule-row {
    display: flex;
    gap: 0.75rem;
  }

  .schedule-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .schedule-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .filter-btn:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(107, 26, 42, 0.1);
  }

  .dropdown-wrap {
    position: relative;
  }

  .dropdown-btn {
    min-width: 150px;
    justify-content: space-between;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
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
    color: var(--text);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .dropdown-item:hover {
    background: var(--surface-hover);
  }

  .applications-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    background: var(--card-bg);
    border: 2px dashed var(--border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .empty-state svg {
    color: var(--text-dim);
    margin-bottom: 0.5rem;
  }

  .empty-state h3 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-state p {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .schedule-calendar-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .calendar-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .calendar-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--background);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
  }

  .calendar-item:hover {
    border-color: var(--maroon);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  }

  .calendar-item.selected {
    background: #fef2f2;
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px rgba(128,0,0,0.15);
  }

  .calendar-icon-box {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--maroon);
  }

  .calendar-day-num {
    position: absolute;
    top: 9px;
    font-size: 0.65rem;
    font-weight: 800;
    color: var(--maroon);
  }

  .calendar-info {
    display: flex;
    flex-direction: column;
  }

  .calendar-date {
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--text-primary);
  }

  .calendar-full-date {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .date-count-badge {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 700;
    padding: 0.3rem 0.75rem;
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #F5D98B;
    border: 1px solid rgba(212, 166, 42, 0.6);
    border-radius: 20px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(139, 26, 60, 0.25);
  }

  .calendar-item.selected .date-count-badge {
    background: linear-gradient(135deg, #F0CF72, #D4A62A);
    color: #3D0818;
    border-color: #B8891F;
  }

  .clear-filters-btn {
    padding: 0.75rem 1.5rem;
    background: var(--maroon);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s, transform 0.2s;
  }

  .clear-filters-btn:hover {
    background: var(--maroon-light);
    transform: translateY(-1px);
  }
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--surface);
    padding: 1.5rem;
    border-radius: 16px;
    width: 90%;
    max-width: 400px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  }

  .modal-content h3 {
    margin-top: 0;
    color: var(--maroon);
    margin-bottom: 0.5rem;
    font-size: 1.125rem;
  }

  .modal-content p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }

  .sched-input {
    width: 100%;
    padding: 0.75rem;
    margin: 1rem 0;
    border: 1.5px solid var(--border);
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.875rem;
  }

  .sched-input:focus {
    outline: none;
    border-color: var(--maroon);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .btn-cancel, .btn-confirm {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.625rem 1.25rem;
    border-radius: 8px;
    cursor: pointer;
    border: none;
    font-weight: 600;
    font-family: inherit;
    font-size: 0.875rem;
    transition: opacity 0.15s, transform 0.15s;
  }

  .btn-cancel {
    background: var(--surface);
    border: 1.5px solid var(--border);
    color: var(--text-primary);
  }

  .btn-cancel:hover {
    background: var(--surface-hover);
  }

  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-confirm {
    background: var(--maroon);
    color: white;
  }

  .btn-confirm:hover {
    background: var(--maroon-light);
    transform: translateY(-1px);
  }

  .btn-confirm:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .btn-confirming {
    cursor: wait !important;
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

  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
    }

    .filters-section {
      flex-direction: column;
      align-items: stretch;
    }

    .filter-group {
      flex-direction: column;
    }

    .filter-btn {
      width: 100%;
      justify-content: center;
    }

    .dropdown-btn {
      justify-content: center;
    }
  }

  /* Custom Layout for Hardcopies Compliance (Distribution) */
  .full-detail-view {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    animation: fadeIn 0.3s ease;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    cursor: pointer;
    align-self: flex-start;
    transition: all 0.2s;
  }
  .back-btn:hover {
    background: var(--maroon);
    color: white;
    border-color: var(--maroon);
  }

  .detail-card-wrapper {
    width: 100%;
  }

  .app-clickable-wrapper {
    transition: transform 0.2s, box-shadow 0.2s;
    border-radius: var(--radius-md, 10px);
  }
  .app-clickable-wrapper:hover {
    box-shadow: 0 6px 16px rgba(0,0,0,0.1);
    border-radius: var(--radius-md, 10px);
  }

  .applications-list.right-panel {
    flex: 1;
    min-width: 0;
    max-width: calc(100% - 420px);
  }

  @media (max-width: 1024px) {
    .applications-list.right-panel {
      max-width: 100%;
    }
  }

  /* ── Reason Modal (Reject / Revoke) ────────────────────────────────────────── */
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

  /* ── Responsive Enhancements ── */
  @media (max-width: 768px) {
    .filters-section {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
      padding: 0.85rem;
    }
    .search-container {
      width: 100%;
      min-width: 0;
    }
    .filter-group {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .filter-btn {
      flex: 1 1 calc(50% - 0.5rem);
      min-width: 130px;
      justify-content: center;
    }
    .calendar-list {
      flex-direction: column;
    }
    .calendar-item {
      width: 100%;
    }
    .reason-modal-card {
      padding: 1.25rem 1rem;
      border-radius: 14px;
      width: 95%;
      max-width: 95vw;
    }
    .reason-modal-actions {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }
    .btn-confirm-reason, .btn-cancel {
      width: 100%;
      justify-content: center;
    }
  }

  @media (max-width: 480px) {
    .filter-btn {
      flex: 1 1 100%;
      width: 100%;
    }
    .overdue-banner {
      font-size: 0.78rem;
      padding: 0.75rem;
    }
    .preset-chips-wrap {
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .preset-chip {
      font-size: 0.72rem;
      padding: 0.35rem 0.6rem;
    }
  }
</style>