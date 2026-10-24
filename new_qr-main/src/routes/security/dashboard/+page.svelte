<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import NavBar from '$lib/components/NavBar.svelte';
  import { invalidateAll } from '$app/navigation';
  import { startLiveSync } from '$lib/utils/liveSync';

  let { data } = $props();
  let userRole = $derived(data.userRole || 'security');

  // Pure realtime WebSocket sync for instant automatic updates without background polling
  $effect(() => {
    return startLiveSync({
      channelName: 'security-dashboard-realtime',
      tables: ['vehicle_log', 'incident_report', 'parking_capacity', 'registration']
    });
  });

  const navLinks = $derived([
    { label: 'Dashboard', href: '/security/dashboard' },
    { label: 'Application Review', href: '/security' },
    { label: 'Vehicle Log', href: '/security/logs' },
    { label: 'Incident Report', href: '/security/complaints', badge: data.unreadComplaints },
    { label: 'Settings', href: '/security/settings' }
  ]);

  // Security Statistics
  let statsData = $derived((data.stats as any) || { 
    totalEntriesToday: 0, 
    twoWheelers: 0,
    fourWheelers: 0,
    mainCampusPresence: 0,
    rnpCampusPresence: 0,
    paseoCampusPresence: 0,
    totalComplaints: 0 
  });

  let roleBreakdownByCampus = $derived((data.roleBreakdownByCampus as Record<string, Record<string, number>>) || {});
  const roleColors: Record<string, string> = {
    student: '#3B82F6',
    faculty: '#4F46E5',
    staff: '#10B981',
    administrator: '#DC2626',
    concessionaire: '#EA580C',
    supplier: '#D97706',
    vps: '#854D0E',
    vip: '#D4AF37',
    guest: '#0EA5E9'
  };

  const roleLabels: Record<string, string> = {
    student: 'Student',
    faculty: 'Faculty',
    staff: 'Staff',
    administrator: 'Administrator',
    concessionaire: 'Concessionaire',
    supplier: 'Supplier',
    vps: 'VPS',
    vip: 'VIP',
    guest: 'Guest'
  };

  function getCampusRoleStats(campusLabel: string) {
    const key = campusLabel === 'MAIN CAMPUS' ? 'Main Campus' : campusLabel;
    const breakdown = roleBreakdownByCampus[key] || {};
    const roles = [
      'student',
      'faculty',
      'staff',
      'administrator',
      'concessionaire',
      'supplier',
      'vps',
      'vip',
      'guest'
    ];
    let total = 0;
    roles.forEach(r => { total += (breakdown[r] || 0); });

    let accumulatedPct = 0;
    const items = roles.map(r => {
      const count = breakdown[r] || 0;
      const pct = total > 0 ? (count / total) * 100 : 0;
      const offsetPct = accumulatedPct;
      accumulatedPct += pct;
      return {
        role: r,
        label: roleLabels[r] || r,
        count,
        pct,
        pctFormatted: pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1),
        color: roleColors[r] || '#718096',
        offsetPct
      };
    });

    return { total, items };
  }
  let hourlyChart = $derived((data.hourlyChart as number[]) || Array(24).fill(0));
  let flaggedAlerts = $derived((data.flaggedAlerts as any[]) || []);

  const statCards = $derived([
    {
      label: 'MAIN CAMPUS',
      value: statsData.mainCampusPresence || 0,
      desc: `2-Wheels: ${statsData.main2W || 0} • 4-Wheels: ${statsData.main4W || 0}`,
      capacity: statsData.mainCapacity,
      icon: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
      color: '#8B1A3C',
      bg: 'rgba(139,26,60,0.08)',
      event: statsData.mainEvent
    },
    {
      label: 'RNP',
      value: statsData.rnpCampusPresence || 0,
      desc: `2-Wheels: ${statsData.rnp2W || 0} • 4-Wheels: ${statsData.rnp4W || 0}`,
      capacity: statsData.rnpCapacity,
      icon: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
      color: '#D4A62A',
      bg: 'rgba(212,166,42,0.1)',
      event: statsData.rnpEvent
    },
    {
      label: 'PASEO',
      value: statsData.paseoCampusPresence || 0,
      desc: `2-Wheels: ${statsData.paseo2W || 0} • 4-Wheels: ${statsData.paseo4W || 0}`,
      capacity: statsData.paseoCapacity,
      icon: `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
      color: '#A21C46',
      bg: 'rgba(162,28,70,0.08)',
      event: statsData.paseoEvent
    }
  ]);

  const maxChartValue = $derived(Math.max(...hourlyChart, 1));
</script>

<svelte:head>
  <title>Security Dashboard | GateQR</title>
  <meta name="description" content="Real-time security analytics and gate operations monitoring." />
</svelte:head>

<AppShell showSidebar={true} userEmail={data.userEmail} userRole={userRole}>
  <NavBar title="Security Dashboard" />
  <div class="dashboard-wrapper">
    <!-- Welcome Banner matching Dashboard Aesthetic -->
    <div class="welcome-banner">
      <div class="wb-content">
        <h1 class="wb-title">Welcome back, Security Officer!</h1>
        <p class="wb-sub">Here's what's happening across all university campus gates today.</p>
      </div>
      <div class="wb-icon-shield">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
    </div>

    <!-- Stats Cards Grid with Role Percentage Diagrams -->
    <div class="stats-grid">
      {#each statCards as card}
        {@const roleStats = getCampusRoleStats(card.label)}
        <div class="stat-card" style="--card-color: {card.color}; --card-bg: {card.bg};">
          {#if card.event}
            <div class="event-badge">
              <span class="event-dot"></span>
              {card.event.name}
              <div class="event-tooltip">
                <strong>Start:</strong> {new Date(card.event.start).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}<br/>
                <strong>End:</strong> {new Date(card.event.end).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}
              </div>
            </div>
          {/if}

          <!-- Top: Campus Header & Active Count -->
          <div class="stat-card-top">
            <div class="stat-icon-box">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {@html card.icon}
              </svg>
            </div>
            <div class="stat-details">
              <div class="stat-value">{card.value}</div>
              <div class="stat-label">{card.label}</div>
              <div class="stat-desc">{card.desc}</div>
            </div>
          </div>

          <!-- Capacity Bar / Stats -->
          <div class="capacity-stats">
            <div class="cap-item"><span>Capacity:</span> {card.capacity?.capacity ?? 0}</div>
            <div class="cap-item"><span>Occupied:</span> <strong style="color:#e53e3e">{card.capacity?.occupied ?? 0}</strong></div>
            <div class="cap-item"><span>Unoccupied:</span> <strong style="color:#D4A62A">{card.capacity?.available ?? card.capacity?.unoccupied ?? 0}</strong></div>
          </div>

          <!-- Role Percentage Diagram & Details Section -->
          <div class="campus-role-section">
            <div class="role-section-header">
              <span class="role-section-title">Entries by Role</span>
              <span class="role-section-total">Total: <strong>{roleStats.total}</strong></span>
            </div>

            <div class="role-diagram-row">
              <!-- Mini Donut Chart (Radius 30, Circumference 188.5) -->
              <div class="role-donut-box">
                <svg class="role-donut-svg" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="30" fill="none" stroke="#f1f5f9" stroke-width="8" />
                  {#if roleStats.total > 0}
                    {#each roleStats.items as item}
                      {#if item.count > 0}
                        <circle
                          cx="40"
                          cy="40"
                          r="30"
                          fill="none"
                          stroke={item.color}
                          stroke-width="8"
                          stroke-dasharray="{((item.pct / 100) * 188.5)} 188.5"
                          stroke-dashoffset="-{((item.offsetPct / 100) * 188.5)}"
                          class="donut-segment"
                        />
                      {/if}
                    {/each}
                  {/if}
                </svg>
                <div class="role-donut-center">
                  <span class="donut-number">{roleStats.total}</span>
                  <span class="donut-unit">Entries</span>
                </div>
              </div>

              <!-- Role Percentage Breakdown Details -->
              <div class="role-details-list">
                {#each roleStats.items as item}
                  <div class="role-detail-item">
                    <div class="role-detail-header">
                      <div class="role-name-wrap">
                        <span class="role-dot" style="background: {item.color};"></span>
                        <span class="role-name">{item.label}</span>
                      </div>
                      <div class="role-metrics">
                        <span class="role-pct" style="color: {item.color};">{item.pctFormatted}%</span>
                        <span class="role-count">({item.count})</span>
                      </div>
                    </div>
                    <div class="role-progress-track">
                      <div class="role-progress-fill" style="width: {item.pct}%; background: {item.color};"></div>
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Stacked Proportion Bar -->
            <div class="role-stacked-bar" title="{roleStats.items.map(i => `${i.label}: ${i.pctFormatted}%`).join(' | ')}">
              {#if roleStats.total > 0}
                {#each roleStats.items as item}
                  {#if item.count > 0}
                    <div class="stacked-seg" style="width: {item.pct}%; background: {item.color};" title="{item.label}: {item.pctFormatted}% ({item.count})"></div>
                  {/if}
                {/each}
              {:else}
                <div class="stacked-seg" style="width: 100%; background: #e2e8f0;" title="No entries recorded"></div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>


    <!-- Analytics Grid: Hourly Traffic Chart + Role Breakdown -->
    <div class="analytics-row">
      <!-- Hourly Entry Traffic -->
      <div class="card chart-card">
        <div class="card-header">
          <h2>Hourly Entry Traffic Today</h2>
        </div>
        <div class="chart-content">
          <div class="chart-bars">
            {#each hourlyChart as value, i}
              <div class="bar-col">
                <div class="bar-fill-wrap">
                  <div
                    class="bar-fill"
                    style="height: {(value / maxChartValue) * 100}%"
                    title="{i}:00 — {value} entries"
                  ></div>
                </div>
                <span class="bar-hour">{i}</span>
              </div>
            {/each}
          </div>
          <div class="chart-axis-label">Hour of the Day (0:00 – 23:00)</div>
      </div>
    </div>

    <!-- Flagged Alerts Section -->
    <div class="card flagged-alerts-card">
      <div class="card-header">
        <div class="header-left">
          <h2>Flagged Alerts</h2>
        </div>
        <span class="alerts-count-badge" class:has-alerts={flaggedAlerts.length > 0}>
          {flaggedAlerts.length} Recorded
        </span>
      </div>

      {#if flaggedAlerts.length > 0}
        <div class="table-container">
          <table class="flagged-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Alert / Reason</th>
                <th>Plate Number</th>
                <th>Driver / Role</th>
                <th>Campus</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each flaggedAlerts as alert}
                <tr>
                  <td class="td-datetime">
                    <span class="date-text">{new Date(alert.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <span class="time-text">{new Date(alert.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </td>
                  <td>
                    <span
                      class="reason-tag"
                      class:danger={alert.reason.toLowerCase().includes('not recognized') || alert.reason.toLowerCase().includes('duplicate') || alert.reason.toLowerCase().includes('denied')}
                    >
                      {alert.reason}
                    </span>
                  </td>
                  <td>
                    <span class="plate-code">{alert.plate}</span>
                  </td>
                  <td>
                    <div class="user-cell">
                      <span class="user-name">{alert.name}</span>
                      <span class="user-role">{alert.role}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      class="campus-tag"
                      class:rnp={alert.campus?.toLowerCase().includes('rnp')}
                      class:paseo={alert.campus?.toLowerCase().includes('paseo')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                      {alert.campus || 'Main Campus'}
                    </span>
                  </td>
                  <td>
                    <span class="status-badge-chip">{alert.status}</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="no-alerts-state">
          <div>
            <h4>No flagged alerts detected</h4>
            <p>All recognized QR codes and gate entries are clean.</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</AppShell>

<style>
  :global(body) {
    background-color: #f7f9fc;
  }

  .dashboard-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    padding: 1.5rem;
  }

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

  /* Stats Grid: Exactly 3 aligned campuses on desktop */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.25rem;
    align-items: stretch;
  }

  .stat-card {
    background: #ffffff;
    border-radius: 18px;
    padding: 1.25rem 1.15rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.85rem;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(0,0,0,0.03);
    position: relative;
    overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
    height: 100%;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
  }

  .stat-card-top {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .stat-desc {
    font-size: 0.75rem;
    color: #a0aec0;
    margin-top: 4px;
  }

  /* Campus Role Percentage Section */
  .campus-role-section {
    margin-top: 0.5rem;
    padding-top: 0.85rem;
    border-top: 1px dashed #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .role-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.78rem;
    font-weight: 700;
    color: #475569;
  }

  .role-section-total {
    font-size: 0.72rem;
    color: #64748b;
  }

  .role-section-total strong {
    color: #1e293b;
    font-weight: 800;
  }

  .role-diagram-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .role-donut-box {
    position: relative;
    width: 80px;
    height: 80px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .role-donut-svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .donut-segment {
    transition: stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease;
  }

  .role-donut-center {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .donut-number {
    font-size: 0.95rem;
    font-weight: 800;
    color: #1e293b;
    line-height: 1;
  }

  .donut-unit {
    font-size: 0.55rem;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .role-details-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .role-detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .role-detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
  }

  .role-name-wrap {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .role-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .role-name {
    font-weight: 600;
    color: #334155;
  }

  .role-metrics {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 0.72rem;
  }

  .role-pct {
    font-weight: 800;
  }

  .role-count {
    font-weight: 600;
    color: #64748b;
  }

  .role-progress-track {
    height: 3px;
    background: #f1f5f9;
    border-radius: 999px;
    overflow: hidden;
  }

  .role-progress-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.4s ease;
  }

  .role-stacked-bar {
    display: flex;
    height: 5px;
    background: #f1f5f9;
    border-radius: 999px;
    overflow: hidden;
    gap: 1px;
    margin-top: 0.25rem;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
  }

  .stacked-seg {
    height: 100%;
    transition: width 0.4s ease;
  }

  .event-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(229, 62, 62, 0.1);
    color: #e53e3e;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid rgba(229, 62, 62, 0.2);
    z-index: 10;
    cursor: help;
  }

  .event-badge:hover .event-tooltip {
    display: block;
  }

  .event-tooltip {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: #2d3748;
    color: #fff;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.7rem;
    white-space: nowrap;
    z-index: 20;
    font-weight: 500;
    letter-spacing: 0;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  }

  .event-tooltip::after {
    content: '';
    position: absolute;
    top: -4px;
    right: 12px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 4px solid #2d3748;
  }

  .event-dot {
    width: 6px;
    height: 6px;
    background: #e53e3e;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.7); }
    70% { transform: scale(1); box-shadow: 0 0 0 4px rgba(229, 62, 62, 0); }
    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(229, 62, 62, 0); }
  }

  .stat-icon-box {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--card-bg);
    color: var(--card-color);
    flex-shrink: 0;
  }

  .stat-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .stat-value {
    font-size: 1.8rem;
    font-weight: 700;
    color: #1a202c;
    line-height: 1.2;
  }

  .stat-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #718096;
    margin-top: 0.25rem;
  }

  /* Card Container */
  .card {
    background: #ffffff;
    border-radius: 20px;
    padding: 1.75rem;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(0,0,0,0.03);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .card-header h2 {
    font-size: 1.15rem;
    font-weight: 700;
    color: #1a202c;
    margin: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .alerts-count-badge {
    padding: 0.25rem 0.65rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    background: #f1f5f9;
    color: #475569;
  }

  .alerts-count-badge.has-alerts {
    background: #fef2f2;
    color: #b91c1c;
  }

  /* Flagged Alerts Small Table */
  .table-container {
    overflow-x: auto;
    border: 1px solid rgba(0,0,0,0.05);
    border-radius: 12px;
  }

  .flagged-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    text-align: left;
  }

  .flagged-table th {
    background: #f7fafc;
    padding: 0.85rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(0,0,0,0.05);
  }

  .flagged-table td {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid rgba(0,0,0,0.03);
    vertical-align: middle;
  }

  .td-datetime {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .date-text {
    font-weight: 600;
    color: #2d3748;
    font-size: 0.85rem;
  }

  .time-text {
    font-size: 0.75rem;
    color: #718096;
  }

  .reason-tag {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.65rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    background: #fef3c7;
    color: #b45309;
  }

  .reason-tag.danger {
    background: #fef2f2;
    color: #c53030;
  }

  .plate-code {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    background: #edf2f7;
    font-family: monospace;
    font-weight: 700;
    font-size: 0.85rem;
    color: #2d3748;
  }

  .user-cell {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .user-name {
    font-weight: 600;
    color: #2d3748;
  }

  .user-role {
    font-size: 0.75rem;
    color: #718096;
  }

  .campus-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    background: #fdf2f4;
    border: 1px solid rgba(139, 26, 60, 0.2);
    border-radius: 6px;
    color: #8B1A3C;
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
    letter-spacing: 0.01em;
  }

  .campus-tag.rnp {
    background: #fefce8;
    border-color: rgba(212, 166, 42, 0.35);
    color: #92400e;
  }

  .campus-tag.paseo {
    background: #fdf2f8;
    border-color: rgba(162, 28, 70, 0.25);
    color: #9d174d;
  }

  .status-badge-chip {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    background: #edf2f7;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: #4a5568;
  }

  .no-alerts-state {
    padding: 1.5rem;
    text-align: center;
  }

  .no-alerts-state h4 {
    margin: 0 0 0.25rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: #2d3748;
  }

  .no-alerts-state p {
    margin: 0;
    font-size: 0.85rem;
    color: #718096;
  }

  /* Analytics Row */
  .analytics-row {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.5rem;
  }

  @media (max-width: 900px) {
    .analytics-row {
      grid-template-columns: 1fr;
    }
  }

  /* Chart Card */
  .chart-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .chart-bars {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    height: 180px;
    padding-top: 1rem;
    border-bottom: 1px solid rgba(0,0,0,0.05);
  }

  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .bar-fill-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .bar-fill {
    width: 70%;
    min-height: 4px;
    background: #8B1A3C;
    border-radius: 4px 4px 0 0;
    transition: height 0.3s ease, background 0.2s;
  }
  
  .bar-col:nth-child(even) .bar-fill {
    background: #D4A62A;
  }

  .bar-hour {
    font-size: 0.7rem;
    color: #a0aec0;
  }

  .chart-axis-label {
    text-align: center;
    font-size: 0.75rem;
    color: #a0aec0;
    font-weight: 500;
    margin-top: 0.5rem;
  }

  /* Role Breakdown */
  .breakdown-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .breakdown-item {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .breakdown-top {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
  }

  .role-title {
    font-weight: 600;
    color: #2d3748;
  }

  .role-count {
    color: #718096;
    font-weight: 500;
  }

  .progress-track {
    width: 100%;
    height: 8px;
    background: #edf2f7;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #8B1A3C, #D4A62A);
    border-radius: 4px;
    transition: width 0.4s ease;
  }

  .capacity-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.75rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed #e2e8f0;
    font-size: 0.7rem;
    color: #4a5568;
    width: 100%;
  }

  .cap-item span {
    color: #a0aec0;
    margin-right: 2px;
  }



  @media (max-width: 640px) {
    .dashboard-wrapper {
      padding: 0.75rem;
      gap: 1rem;
    }
    .stats-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .stat-card {
      padding: 1.25rem;
      gap: 1rem;
    }
    .stat-value {
      font-size: 1.5rem;
    }
    .card {
      padding: 1.25rem;
    }
    .chart-content {
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .chart-bars {
      min-width: 480px;
    }
    .capacity-stats {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  }

  /* ── Enhanced Responsiveness for Mobile, Tablet, Laptop, Desktop ── */
  @media (max-width: 1024px) {
    .dashboard-wrapper {
      padding: 1rem;
      gap: 1.25rem;
    }
  }

  @media (max-width: 768px) {
    .dashboard-wrapper {
      padding: 0.75rem 0.5rem;
      gap: 1rem;
    }
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
    .panel-section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .panel-main-title {
      font-size: 1.2rem;
    }
    .chart-content {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 0.5rem;
    }
    .chart-bars {
      min-width: 480px;
    }
  }

  @media (max-width: 480px) {
    .dashboard-wrapper {
      padding: 0.5rem 0.25rem;
    }
    .panel-main-title {
      font-size: 1.1rem;
    }
    .panel-subtext {
      font-size: 0.78rem;
    }
    .flagged-table th, .flagged-table td {
      padding: 0.65rem 0.65rem;
      font-size: 0.78rem;
    }
  }
</style>