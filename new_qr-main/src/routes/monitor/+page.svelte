<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';

    let { data } = $props();

    const navLinks = [
        { label: 'Dashboard', href: '/security/dashboard' },
        { label: 'Operations', href: '/security' },
        { label: 'Monitor', href: '/monitor' },
        { label: 'Incident Report', href: '/security/complaints' }
    ];

    import { startLiveSync } from '$lib/utils/liveSync';

    let vehicles = $state((data.vehicles as any[]) || []);
    let searchQuery = $state('');

    $effect(() => {
        vehicles = (data.vehicles as any[]) || [];
    });

    // Pure realtime WebSocket sync for registered vehicles
    $effect(() => {
        return startLiveSync({
            channelName: 'monitor-vehicles-realtime',
            tables: ['registration']
        });
    });

    const filteredVehicles = $derived(
        vehicles.filter((v: any) => 
            v.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.last_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            v.vehicle_plate.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (v.id || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
    );

    async function revokeQR(vehicleId: number) {
        if (!confirm('Are you sure you want to revoke this QR code? The vehicle will be denied access.')) return;
        try {
            const res = await fetch(`/api/monitor/revoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicle_id: vehicleId })
            });
            if (res.ok) {
                vehicles = vehicles.map((v: any) => v.vehicle_id === vehicleId ? { ...v, status: 'revoked' } : v);
            } else {
                alert('Failed to revoke QR code.');
            }
        } catch (e) {
            console.error(e);
            alert('Error revoking QR code.');
        }
    }

    async function unrevokeQR(vehicleId: number) {
        if (!confirm('Restore access for this vehicle? Their QR code will be reactivated.')) return;
        try {
            const res = await fetch(`/api/monitor/revoke`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vehicle_id: vehicleId })
            });
            if (res.ok) {
                vehicles = vehicles.map((v: any) => v.vehicle_id === vehicleId ? { ...v, status: 'distributed' } : v);
            } else {
                alert('Failed to restore QR code.');
            }
        } catch (e) {
            console.error(e);
            alert('Error restoring QR code.');
        }
    }
</script>

<AppShell>
  <NavBar title="Safety & Security Monitor" links={navLinks} />

  <div class="card">
    <div class="header">
      <h2 class="title">Registered Vehicles</h2>
      <input type="text" placeholder="Search by name, plate, or QR..." bind:value={searchQuery} class="search-box" />
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Owner Name</th>
            <th>Role</th>
            <th>Vehicle</th>
            <th>Plate No</th>
            <th>Type</th>
            <th>QR ID</th>
            <th>Status</th>
            {#if data.userRole === 'security'}<th>Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each filteredVehicles as v}
          <tr>
            <td>{v.first_name} {v.last_name}</td>
            <td class="capitalize">{v.role}</td>
            <td>{v.vehicle_make}</td>
            <td>{v.vehicle_plate}</td>
            <td>{v.vehicle_type}</td>
            <td class="font-mono">{v.id ? v.id : `REG-${v.vehicle_id}`}</td>
            <td>
              <span class="status-badge {v.status}">{v.status}</span>
            </td>
            {#if data.userRole === 'security'}
            <td class="actions-cell">
              {#if v.status === 'revoked'}
                <button class="btn-success" onclick={() => unrevokeQR(v.vehicle_id)}>Restore QR</button>
              {:else if v.status === 'distributed'}
                <button class="btn-danger" onclick={() => revokeQR(v.vehicle_id)}>Revoke QR</button>
              {/if}
            </td>
            {/if}
          </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</AppShell>

<style>
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-md); padding: 1.5rem;
    box-shadow: var(--shadow-sm);
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap;
  }
  .title { font-size: 1.25rem; font-weight: 700; color: var(--text); margin: 0; }
  .search-box {
    padding: 0.5rem 1rem; border: 1.5px solid var(--border); border-radius: var(--radius-sm);
    width: 300px; max-width: 100%; font-size: 0.875rem; outline: none; background: var(--background);
  }
  .search-box:focus { border-color: var(--maroon); }
  @media (max-width: 640px) {
    .header {
      flex-direction: column;
      align-items: stretch;
    }
    .search-box {
      width: 100%;
    }
  }
  .table-wrap { overflow-x: auto; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .data-table th, .data-table td {
    padding: 1rem; border-bottom: 1px solid var(--border); text-align: left;
  }
  .data-table th {
    background: var(--surface-hover); color: var(--text-dim); font-weight: 600;
    text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em;
  }
  .data-table tbody tr:hover { background: var(--surface-hover); }
  .capitalize { text-transform: capitalize; }
  .font-mono { font-family: monospace; letter-spacing: 0.05em; }
  .status-badge {
    padding: 0.25rem 0.6rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
  }
  .status-badge.osa_val  { background: rgba(59,130,246,0.15);  color: #2563eb; }
  .status-badge.dept_val { background: rgba(234,179,8,0.15);   color: #ca8a04; }
  .status-badge.revoked  { background: rgba(239,68,68,0.15);   color: #dc2626; }
  .status-badge.rejected { background: rgba(107,114,128,0.15); color: #4b5563; }
  .status-badge.expired  { background: rgba(107,114,128,0.15); color: #6b7280; }
  .actions-cell { white-space: nowrap; }
  .btn-danger {
    background: #dc2626; color: white; border: none; padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem; font-weight: 600;
  }
  .btn-danger:hover { background: #b91c1c; }
  .btn-success {
    background: #16a34a; color: white; border: none; padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm); cursor: pointer; font-size: 0.75rem; font-weight: 600;
  }
  .btn-success:hover { background: #15803d; }
</style>
