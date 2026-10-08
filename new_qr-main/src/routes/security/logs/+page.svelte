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

  // Realtime subscription for vehicle logs
  $effect(() => {
    const channel = supabaseClient
      .channel('security-logs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_log' }, () => {
        fetchLogs();
      })
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
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
              <th>Plate / Vehicle</th>
              <th>Driver / Role</th>
              <th>Bound</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${selectedLogsData.map((log: any) => `
              <tr>
                <td><strong>#${log.vehicle_log_id}</strong></td>
                <td>${log.vehicle_plate || log.plate || 'N/A'}</td>
                <td>${log.driver_name || log.name || 'N/A'} (${log.role || 'Guest'})</td>
                <td>${log.bound ? log.bound.toUpperCase() : 'IN'}</td>
                <td>${log.check_in ? new Date(log.check_in).toLocaleString() : (log.in ? new Date(log.in).toLocaleString() : 'N/A')}</td>
                <td>${log.check_out ? new Date(log.check_out).toLocaleString() : (log.out ? new Date(log.out).toLocaleString() : 'Still Inside')}</td>
                <td>${log.logged_status || 'OK'}</td>
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
                <th>Bound</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Logged Status</th>
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
                    <span class="plate-badge">{log.vehicle_plate || log.plate || 'No Plate'}</span>
                  </td>
                  <td>
                    <div class="driver-info">
                      <span class="driver-name">{log.driver_name || log.name || 'Registered Driver'}</span>
                      <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 2px;">
                        <span class="role-badge">{log.role || 'Student'}</span>
                        {#if log.campus}
                          <span class="campus-badge" style="font-size: 0.7rem; font-weight: 500; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);">{log.campus}</span>
                        {/if}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="bound-tag" class:in={log.bound !== 'out'} class:out={log.bound === 'out'}>
                      {log.bound ? log.bound.toUpperCase() : 'IN'}
                    </span>
                  </td>
                  <td class="td-time">
                    {log.check_in ? new Date(log.check_in).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : (log.in ? new Date(log.in).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—')}
                  </td>
                  <td class="td-time">
                    {#if log.check_out || log.out}
                      {new Date(log.check_out || log.out).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    {:else}
                      <span class="status-inside">Inside Campus</span>
                    {/if}
                  </td>
                  <td>
                    <span class="status-pill" class:ok={log.logged_status === 'Inside' || log.logged_status === 'OK'} class:warn={log.logged_status && log.logged_status !== 'Inside' && log.logged_status !== 'OK'}>
                      {log.logged_status || 'OK'}
                    </span>
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
    padding: 0.2rem 0.55rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
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
</style>
