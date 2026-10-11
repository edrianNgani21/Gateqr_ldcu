<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import NavBar from '$lib/components/NavBar.svelte';
  import { supabaseClient } from '$lib/supabaseClient';

  let { data } = $props();
  let userRole = $derived(data.userRole || 'security');

  let logs = $state<any[]>([]);
  let totalLogs = $state(0);
  let currentPage = $state(1);
  let totalPages = $state(1);
  const pageSize = 25;
  let loading = $state(false);

  import { startLiveSync } from '$lib/utils/liveSync';

  // Pure realtime WebSocket sync for vehicle logs without background polling
  $effect(() => {
    return startLiveSync({
      channelName: 'security-logs-realtime',
      tables: ['vehicle_log'],
      onSync: () => fetchLogs()
    });
  });

  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let boundFilter = $state('all');
  let selectedCampus = $state('');
  let searchQuery = $state('');

  // Print functionality
  let selectedLogs = $state(new Set<number>());
  let selectAllChecked = $state(false);
  let printModeActive = $state(false);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Guest Details Modal
  let viewingGuestLog = $state<any>(null);
  let showGuestModal = $state(false);

  function openGuestDetails(log: any) {
    viewingGuestLog = log;
    showGuestModal = true;
  }

  function closeGuestDetails() {
    showGuestModal = false;
    viewingGuestLog = null;
  }

  // Role filter functionality
  const allRoles = ['student', 'employee', 'visitor', 'concessionaire', 'guest', 'vip'];
  let selectedRoles = $state<string[]>([]);
  let roleDropdownOpen = $state(false);

  function toggleRole(role: string) {
    if (selectedRoles.includes(role)) {
      selectedRoles = selectedRoles.filter(r => r !== role);
    } else {
      selectedRoles = [...selectedRoles, role];
    }
    currentPage = 1;
    fetchLogs();
  }

  function getRoleDropdownLabel() {
    if (selectedRoles.length === 0 || selectedRoles.length === allRoles.length) return 'All Roles';
    if (selectedRoles.length === 1) return selectedRoles[0].charAt(0).toUpperCase() + selectedRoles[0].slice(1);
    return `${selectedRoles.length} Roles Selected`;
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

  async function fetchLogs() {
    if (!selectedCampus) {
      logs = [];
      totalLogs = 0;
      totalPages = 1;
      return;
    }
    loading = true;
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        search: searchQuery,
        bound: boundFilter,
        page: String(currentPage),
        limit: String(pageSize),
      });
      if (selectedRoles.length > 0) {
        params.append('roles', selectedRoles.join(','));
      }
      if (selectedCampus) {
        params.append('campus', selectedCampus);
      }
      const res = await fetch(`/api/gate/logs?${params}`);
      if (res.ok) {
        const json = await res.json();
        logs = json.logs || [];
        totalLogs = json.total || 0;
        currentPage = json.page || 1;
        totalPages = json.totalPages || 1;
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    } finally {
      loading = false;
    }
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      fetchLogs();
    }, 300);
  }

  function prevPage() {
    if (currentPage > 1) {
      currentPage--;
      fetchLogs();
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      fetchLogs();
    }
  }

  function toggleLogSelection(logId: number) {
    if (selectedLogs.has(logId)) {
      selectedLogs.delete(logId);
    } else {
      selectedLogs.add(logId);
    }
    selectedLogs = new Set(selectedLogs);
    selectAllChecked = selectedLogs.size === logs.length && logs.length > 0;
  }

  function toggleSelectAll() {
    selectAllChecked = !selectAllChecked;
    if (selectAllChecked) {
      selectedLogs = new Set(logs.map((log: any) => log.vehicle_log_id));
    } else {
      selectedLogs.clear();
      selectedLogs = new Set();
    }
  }

  function togglePrintMode() {
    printModeActive = !printModeActive;
    if (!printModeActive) {
      selectedLogs.clear();
      selectedLogs = new Set();
      selectAllChecked = false;
    }
  }

  function printSelectedLogs() {
    const selectedLogsData = logs.filter((log: any) => selectedLogs.has(log.vehicle_log_id));
    if (selectedLogsData.length === 0) {
      alert('Please select at least one log to print.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print.');
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Vehicle Log Report - Liceo GateQR</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; color: #1a0a0e; }
          h1 { text-align: center; margin-bottom: 6px; color: #8B1A3C; font-size: 20px; }
          .sub { text-align: center; font-size: 13px; color: #666; margin-bottom: 20px; }
          .print-meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 12px; color: #555; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
          th { background-color: #F8E9EC; color: #5C1025; font-weight: 700; text-transform: uppercase; font-size: 11px; }
          tr:nth-child(even) { background-color: #faf5f7; }
        </style>
      </head>
      <body>
        <h1>LICEO DE CAGAYAN UNIVERSITY</h1>
        <div class="sub">Security Department — GateQR Vehicle Log Report</div>
        <div class="print-meta">
          <span>Date Filter: ${selectedDate}</span>
          <span>Printed: ${new Date().toLocaleString()}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Log ID</th>
              <th>Plate Number</th>
              <th>Driver / Role</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${selectedLogsData.map((log: any) => `
              <tr>
                <td><strong>#${log.vehicle_log_id}</strong></td>
                <td>${log.vehicle_plate || log.plate || (log.is_vip ? 'VIP' : log.is_guest ? 'Guest Vehicle' : 'No Plate')}</td>
                <td>${log.is_vip ? 'VIP Access [VIP]' : log.is_guest ? (log.driver_name + ' [GUEST]') : ((log.driver_name || log.name || 'N/A') + ' (' + (log.role || 'Visitor') + ')')}</td>
                <td>${log.check_in ? new Date(log.check_in).toLocaleString() : '—'}</td>
                <td>${log.check_out ? new Date(log.check_out).toLocaleString() : '—'}</td>
                <td><strong style="color: ${log.check_out ? '#64748b' : '#059669'}">${log.check_out ? 'EXITED' : 'INSIDE CAMPUS'}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  $effect(() => {
    fetchLogs();
  });
</script>

<svelte:head>
  <title>Vehicle Log — Security | GateQR</title>
  <meta name="description" content="Gate entry and exit vehicle logs for Liceo de Cagayan University." />
</svelte:head>

<AppShell showSidebar={true} userEmail={data.userEmail} userRole={userRole}>
  <NavBar title="Vehicle Log" />
  <div class="page-container">
    <div class="header-section" style="justify-content: flex-end; margin-bottom: 1rem;">
      <div class="header-stats">
        <select bind:value={selectedCampus} onchange={() => { currentPage = 1; fetchLogs(); }} class="select-control top-campus-select">
          <option value="">Select Campus</option>
          <option value="Liceo Main">Liceo Main</option>
          <option value="RNP">RNP</option>
          <option value="PASEO">PASEO</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="controls-toolbar">
        <div class="search-wrap">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search plate, name, vehicle…"
            bind:value={searchQuery}
            oninput={onSearchInput}
            class="search-input"
          />
          {#if searchQuery}
            <button class="clear-btn" onclick={() => { searchQuery = ''; currentPage = 1; fetchLogs(); }}>×</button>
          {/if}
        </div>

        <div class="filters-row">
          <select bind:value={boundFilter} onchange={() => { currentPage = 1; fetchLogs(); }} class="select-control">
            <option value="all">All (In &amp; Out)</option>
            <option value="in">Entry Only</option>
            <option value="out">Exit Only</option>
          </select>

          <input
            type="date"
            bind:value={selectedDate}
            onchange={() => { currentPage = 1; fetchLogs(); }}
            class="select-control date-input"
          />

          <div class="dropdown-wrap" use:clickOutside={() => roleDropdownOpen = false}>
            <button class="select-control dropdown-btn" onclick={() => roleDropdownOpen = !roleDropdownOpen}>
              {getRoleDropdownLabel()}
            </button>
            {#if roleDropdownOpen}
              <div class="dropdown-menu">
                {#each allRoles as role}
                  <label class="dropdown-item">
                    <input type="checkbox" checked={selectedRoles.includes(role)} onchange={() => toggleRole(role)} />
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <button
            class="btn-action"
            class:active={printModeActive}
            onclick={togglePrintMode}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            {printModeActive ? 'Cancel Selection' : 'Print Select'}
          </button>

          {#if printModeActive}
            <button class="btn-primary" onclick={printSelectedLogs} disabled={selectedLogs.size === 0}>
              Print ({selectedLogs.size})
            </button>
          {/if}
        </div>
      </div>

      {#if !selectedCampus}
        <div class="empty-campus-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <h3>Select a Campus</h3>
          <p>Please select a specific campus from the dropdown above to view its real-time vehicle logs.</p>
        </div>
      {:else if loading}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading vehicle logs…</p>
        </div>
      {:else}
        <div class="table-container">
          <table class="logs-table">
            <thead>
              <tr>
                {#if printModeActive}
                  <th class="col-checkbox">
                    <input type="checkbox" checked={selectAllChecked} onchange={toggleSelectAll} />
                  </th>
                {/if}
                <th>Log ID</th>
                <th>Plate Number</th>
                <th>Driver / Role</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {#each logs as log}
                <tr class:selected-row={selectedLogs.has(log.vehicle_log_id)}>
                  {#if printModeActive}
                    <td class="col-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.vehicle_log_id)}
                        onchange={() => toggleLogSelection(log.vehicle_log_id)}
                      />
                    </td>
                  {/if}
                  <td class="td-id">
                    <span class="id-tag">#{log.vehicle_log_id}</span>
                  </td>
                  <td class="td-plate">
                    {#if log.is_vip || log.role?.toLowerCase() === 'vip'}
                      <span class="plate-badge plate-vip">VIP</span>
                    {:else if log.is_guest || log.role?.toLowerCase() === 'guest'}
                      <button
                        type="button"
                        class="plate-badge plate-guest plate-clickable"
                        onclick={() => openGuestDetails(log)}
                        title="Click to view guest details"
                      >
                        {log.vehicle_plate || log.plate || 'Guest Vehicle'}
                      </button>
                    {:else}
                      <span class="plate-badge">{log.vehicle_plate || log.plate || 'No Plate'}</span>
                    {/if}
                  </td>
                  <td>
                    <div class="driver-info">
                      <span class="driver-name">{log.driver_name || log.name || 'Driver'}</span>
                      <div class="role-tags">
                        {#if log.is_vip || log.role?.toLowerCase() === 'vip'}
                          <span class="badge-role badge-vip">👑 VIP</span>
                        {:else if log.is_guest || log.role?.toLowerCase() === 'guest'}
                          <button
                            type="button"
                            class="badge-role badge-guest badge-clickable"
                            onclick={() => openGuestDetails(log)}
                            title="Click to view guest details"
                          >
                            🏷️ Guest
                          </button>
                        {:else if log.role?.toLowerCase() === 'student'}
                          <span class="badge-role badge-student">Student</span>
                        {:else if log.role?.toLowerCase() === 'employee'}
                          <span class="badge-role badge-employee">Employee</span>
                        {:else}
                          <span class="badge-role badge-default">{log.role || 'Visitor'}</span>
                        {/if}
                      </div>
                    </div>
                  </td>
                  <td class="td-time">
                    {log.check_in ? new Date(log.check_in).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td class="td-time">
                    {#if log.check_out}
                      {new Date(log.check_out).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    {:else}
                      <span style="color: #64748b; font-size: 0.85rem;">—</span>
                    {/if}
                  </td>
                  <td>
                    {#if !log.check_out && (log.logged_status || '').toLowerCase() !== 'exited'}
                      <span class="status-pill status-inside-pill">INSIDE CAMPUS</span>
                    {:else}
                      <span class="status-pill status-exited-pill">EXITED</span>
                    {/if}
                  </td>
                  <td class="td-action">
                    {#if log.is_guest || log.guest_details || (log.role && log.role.toLowerCase() === 'guest')}
                      <button
                        type="button"
                        class="btn-guest-details"
                        onclick={() => openGuestDetails(log)}
                        title="View Guest Log Details"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        <span>View Details</span>
                      </button>
                    {:else}
                      <span class="action-dash">—</span>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan={printModeActive ? 8 : 7} class="empty-state-cell">
                    No vehicle logs found for this date or search filter.
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if totalPages > 1}
          <div class="pagination-bar">
            <button class="pag-btn" onclick={prevPage} disabled={currentPage <= 1}>
              Previous
            </button>
            <span class="page-indicator">Page {currentPage} of {totalPages}</span>
            <button class="pag-btn" onclick={nextPage} disabled={currentPage >= totalPages}>
              Next
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </div>

  {#if showGuestModal && viewingGuestLog}
    <div class="modal-backdrop" onclick={closeGuestDetails} role="presentation">
      <div class="guest-modal-card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="guest-modal-title">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <div class="modal-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <h3 id="guest-modal-title">Guest Log Details</h3>
              <p class="modal-sub">Verified Guest Gate Record &bull; Log #{viewingGuestLog.vehicle_log_id}</p>
            </div>
          </div>
          <button type="button" class="modal-close-btn" onclick={closeGuestDetails} aria-label="Close details">
            &times;
          </button>
        </div>

        <div class="modal-body">
          <!-- Status Banner -->
          <div class="guest-status-banner" class:banner-inside={!viewingGuestLog.check_out && (viewingGuestLog.logged_status || '').toLowerCase() !== 'exited'} class:banner-exited={viewingGuestLog.check_out || (viewingGuestLog.logged_status || '').toLowerCase() === 'exited'}>
            <div class="status-indicator-dot"></div>
            <span class="status-banner-text">
              {#if !viewingGuestLog.check_out && (viewingGuestLog.logged_status || '').toLowerCase() !== 'exited'}
                CURRENTLY INSIDE CAMPUS
              {:else}
                EXITED CAMPUS
              {/if}
            </span>
            <span class="status-banner-campus">{viewingGuestLog.campus || 'Main Campus'}</span>
          </div>

          <!-- Details Grid -->
          <div class="guest-grid">
            <div class="detail-box">
              <span class="detail-label">Plate Number</span>
              <div class="detail-plate">
                {viewingGuestLog.guest_details?.plate_number || viewingGuestLog.vehicle_plate || viewingGuestLog.plate || 'Guest Vehicle'}
              </div>
            </div>

            <div class="detail-box">
              <span class="detail-label">Driver's License / ID Number</span>
              <div class="detail-val-strong">
                {viewingGuestLog.guest_details?.id_number || 'N/A'}
              </div>
            </div>

            <div class="detail-box full-col">
              <span class="detail-label">Purpose of Visit</span>
              <div class="detail-val-purpose">
                {viewingGuestLog.guest_details?.purpose || viewingGuestLog.reason || 'Visitor / Guest Access'}
              </div>
            </div>

            <div class="detail-box">
              <span class="detail-label">Check-In Time</span>
              <div class="detail-val time-in">
                {viewingGuestLog.check_in ? new Date(viewingGuestLog.check_in).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
              </div>
            </div>

            <div class="detail-box">
              <span class="detail-label">Check-Out Time</span>
              <div class="detail-val time-out">
                {viewingGuestLog.check_out ? new Date(viewingGuestLog.check_out).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not Checked Out (Active)'}
              </div>
            </div>

            <div class="detail-box">
              <span class="detail-label">Campus &amp; Gate</span>
              <div class="detail-val">
                {viewingGuestLog.campus || 'Main Campus'}
              </div>
            </div>

            <div class="detail-box">
              <span class="detail-label">Guest ID Reference</span>
              <div class="detail-val id-mono">
                {viewingGuestLog.guest_details?.guest_id ? `GST-${viewingGuestLog.guest_details.guest_id}` : `LOG-${viewingGuestLog.vehicle_log_id}`}
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-modal-close" onclick={closeGuestDetails}>
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
</AppShell>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 1300px;
    margin: 0 auto;
    width: 100%;
  }

  .header-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .title-wrap h1 {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 0.25rem 0;
  }

  .top-campus-select {
    background: #2d3748;
    color: white;
    border: none;
    font-weight: 600;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .total-badge {
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 20px;
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--maroon);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .card {
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  }

  .controls-toolbar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .search-wrap {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.875rem;
    color: var(--text-muted);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    height: 42px;
    padding: 0 2rem 0 2.5rem;
    border: 1.5px solid var(--border-light);
    border-radius: 10px;
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .search-input:focus {
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(139, 26, 60, 0.1);
  }

  .clear-btn {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    font-size: 1.1rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .filters-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .select-control {
    height: 38px;
    padding: 0 0.875rem;
    border: 1.5px solid var(--border-light);
    border-radius: 8px;
    background: #ffffff;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .select-control:focus {
    border-color: var(--maroon);
  }

  .date-input {
    padding: 0 0.6rem;
  }

  .dropdown-wrap {
    position: relative;
  }

  .dropdown-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: #ffffff;
    border: 1px solid var(--border-light);
    border-radius: 10px;
    padding: 0.5rem;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
    z-index: 50;
    min-width: 170px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.825rem;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .dropdown-item:hover {
    background: #fdf2f4;
  }

  .btn-action {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 38px;
    padding: 0 1rem;
    background: #ffffff;
    border: 1.5px solid var(--border-light);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-action:hover, .btn-action.active {
    background: #fdf2f4;
    border-color: var(--maroon);
    color: var(--maroon);
  }

  .btn-primary {
    height: 38px;
    padding: 0 1.25rem;
    background: var(--maroon);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .table-container {
    overflow-x: auto;
    border: 1px solid var(--border-light);
    border-radius: 12px;
  }

  .logs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    text-align: left;
  }

  .logs-table th {
    background: #faf5f7;
    padding: 0.75rem 1rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--maroon-dark);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1.5px solid var(--border-light);
  }

  .logs-table td {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid #f1f5f9;
    color: var(--text-primary);
  }

  .selected-row {
    background: #fdf2f4 !important;
  }

  .col-checkbox {
    width: 40px;
    text-align: center;
  }

  .id-tag {
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .plate-badge {
    display: inline-block;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font-family: monospace;
    font-weight: 700;
    font-size: 0.825rem;
    color: #0f172a;
  }

  .driver-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .driver-name {
    font-weight: 600;
  }

  .role-tags {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 3px;
  }

  .badge-role {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 9999px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1.2;
  }

  .badge-vip {
    background: rgba(245, 158, 11, 0.15);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.35);
  }

  :global(.dark) .badge-vip {
    background: rgba(245, 158, 11, 0.22);
    color: #fbbf24;
    border-color: rgba(245, 158, 11, 0.45);
  }

  .badge-guest {
    background: rgba(59, 130, 246, 0.12);
    color: #1d4ed8;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  :global(.dark) .badge-guest {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.4);
  }

  .badge-student {
    background: rgba(147, 51, 234, 0.12);
    color: #7e22ce;
    border: 1px solid rgba(147, 51, 234, 0.25);
  }

  :global(.dark) .badge-student {
    background: rgba(147, 51, 234, 0.2);
    color: #c084fc;
    border-color: rgba(147, 51, 234, 0.35);
  }

  .badge-employee {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    border: 1px solid rgba(16, 185, 129, 0.25);
  }

  :global(.dark) .badge-employee {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.35);
  }

  .badge-default {
    background: rgba(100, 116, 139, 0.1);
    color: #64748b;
    border: 1px solid rgba(100, 116, 139, 0.2);
  }

  .campus-badge {
    font-size: 0.7rem;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    color: #64748b;
    border: 1px solid rgba(100, 116, 139, 0.2);
  }

  :global(.dark) .campus-badge {
    color: #cbd5e1;
    border-color: rgba(255, 255, 255, 0.1);
  }

  .plate-vip {
    background: #fffbeb !important;
    border-color: #fcd34d !important;
    color: #b45309 !important;
  }

  :global(.dark) .plate-vip {
    background: rgba(245, 158, 11, 0.18) !important;
    border-color: rgba(245, 158, 11, 0.4) !important;
    color: #fbbf24 !important;
  }

  .plate-guest {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }

  :global(.dark) .plate-guest {
    background: rgba(59, 130, 246, 0.18) !important;
    border-color: rgba(59, 130, 246, 0.4) !important;
    color: #93c5fd !important;
  }

  .role-badge {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: capitalize;
  }

  .bound-tag {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .bound-tag.in {
    background: #ecfdf5;
    color: #047857;
  }

  .bound-tag.out {
    background: #fef2f2;
    color: #b91c1c;
  }

  .status-inside {
    color: #047857;
    font-weight: 600;
    font-size: 0.8rem;
  }

  .status-pill {
    display: inline-block;
    padding: 0.25rem 0.65rem;
    border-radius: 9999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .status-inside-pill {
    background: rgba(16, 185, 129, 0.14);
    color: #059669;
    border: 1px solid rgba(16, 185, 129, 0.28);
  }

  .status-exited-pill {
    background: rgba(100, 116, 139, 0.12);
    color: #475569;
    border: 1px solid rgba(100, 116, 139, 0.22);
  }

  .status-pill.ok {
    background: #ecfdf5;
    color: #047857;
  }

  .status-pill.warn {
    background: #fef2f2;
    color: #b91c1c;
  }

  .empty-state-cell {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .pagination-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .pag-btn {
    padding: 0.4rem 0.85rem;
    background: #ffffff;
    border: 1px solid var(--border-light);
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .pag-btn:hover:not(:disabled) {
    background: #fdf2f4;
    border-color: var(--maroon);
    color: var(--maroon);
  }

  .pag-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-indicator {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .empty-campus-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 5rem 2rem;
    text-align: center;
    color: #4a5568;
    background: #f7fafc;
    border-radius: 12px;
    margin: 2rem;
    border: 1px dashed #cbd5e0;
  }
  .empty-campus-state svg {
    color: #718096;
    margin-bottom: 1rem;
    opacity: 0.6;
  }
  .empty-campus-state h3 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: #2d3748;
  }
  .empty-campus-state p {
    margin: 0;
    font-size: 0.95rem;
    color: #718096;
    max-width: 400px;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    gap: 0.75rem;
    color: var(--text-muted);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(139, 26, 60, 0.15);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .card {
      padding: 1rem;
      border-radius: 12px;
    }

    .controls-toolbar {
      gap: 0.75rem;
    }

    .filters-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .select-control {
      width: 100%;
    }

    .dropdown-btn {
      width: 100%;
      justify-content: space-between;
    }

    .dropdown-menu {
      width: 100%;
    }

    .btn-action {
      width: 100%;
      justify-content: center;
    }

    .btn-primary {
      width: 100%;
      justify-content: center;
    }

    .pagination-bar {
      justify-content: space-between;
    }
  }

  @media (max-width: 480px) {
    .header-section {
      width: 100%;
    }

    .header-stats {
      width: 100%;
    }

    .top-campus-select {
      width: 100%;
    }

    .empty-campus-state {
      padding: 2.5rem 1rem;
      margin: 1rem 0;
    }

    .logs-table th,
    .logs-table td {
      padding: 0.65rem 0.75rem;
      font-size: 0.8rem;
    }
  }

  /* Guest Details Button & Modal */
  .td-action {
    white-space: nowrap;
    text-align: center;
  }

  .action-dash {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .btn-guest-details {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    background: rgba(139, 26, 60, 0.08);
    color: #8B1A3C;
    border: 1px solid rgba(139, 26, 60, 0.25);
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-guest-details:hover {
    background: #8B1A3C;
    color: #ffffff;
    border-color: #8B1A3C;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(139, 26, 60, 0.2);
  }

  .plate-clickable,
  .badge-clickable {
    cursor: pointer;
    border: none;
    font-family: inherit;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .plate-clickable:hover,
  .badge-clickable:hover {
    transform: scale(1.04);
    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
  }

  /* Modal Backdrop & Card */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
    animation: fadeIn 0.2s ease;
  }

  .guest-modal-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 540px;
    box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #f1f5f9;
    background: #fafaf9;
  }

  .modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .modal-icon-badge {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(139, 26, 60, 0.1);
    color: #8B1A3C;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: #1e293b;
  }

  .modal-sub {
    margin: 0.15rem 0 0 0;
    font-size: 0.8rem;
    color: #64748b;
  }

  .modal-close-btn {
    background: transparent;
    border: none;
    font-size: 1.6rem;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    transition: all 0.15s ease;
  }

  .modal-close-btn:hover {
    color: #1e293b;
    background: #f1f5f9;
  }

  .modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .guest-status-banner {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .banner-inside {
    background: #ecfdf5;
    color: #065f46;
    border: 1px solid #a7f3d0;
  }

  .banner-inside .status-indicator-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
  }

  .banner-exited {
    background: #f8fafc;
    color: #475569;
    border: 1px solid #e2e8f0;
  }

  .banner-exited .status-indicator-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #94a3b8;
  }

  .status-banner-campus {
    margin-left: auto;
    font-weight: 600;
    font-size: 0.75rem;
    color: #64748b;
  }

  .guest-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .detail-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .detail-box.full-col {
    grid-column: span 2;
  }

  .detail-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }

  .detail-plate {
    font-family: monospace;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #8B1A3C;
    background: #fff;
    border: 1px dashed rgba(139, 26, 60, 0.3);
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    display: inline-block;
  }

  .detail-val-strong {
    font-size: 0.95rem;
    font-weight: 700;
    color: #1e293b;
  }

  .detail-val-purpose {
    font-size: 0.95rem;
    font-weight: 600;
    color: #0f172a;
    line-height: 1.4;
  }

  .detail-val {
    font-size: 0.9rem;
    font-weight: 600;
    color: #334155;
  }

  .detail-val.time-in {
    color: #059669;
  }

  .detail-val.time-out {
    color: #475569;
  }

  .id-mono {
    font-family: monospace;
    font-size: 0.85rem;
    color: #64748b;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid #f1f5f9;
    background: #fafaf9;
    display: flex;
    justify-content: flex-end;
  }

  .btn-modal-close {
    padding: 0.55rem 1.25rem;
    background: #1e293b;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-modal-close:hover {
    background: #0f172a;
  }

  @media (max-width: 600px) {
    .guest-modal-card {
      width: 95vw;
      max-width: 95vw;
      border-radius: 12px;
    }
    .guest-grid {
      grid-template-columns: 1fr;
    }
    .detail-box.full-col {
      grid-column: span 1;
    }
    .modal-header {
      padding: 1rem;
    }
    .modal-body {
      padding: 1rem;
      gap: 1rem;
    }
    .modal-footer {
      padding: 0.75rem 1rem;
    }
    .btn-modal-close {
      width: 100%;
      text-align: center;
    }
  }
</style>
