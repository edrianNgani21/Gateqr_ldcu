<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import NavBar from "$lib/components/NavBar.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import ApplicationCard from "$lib/components/ApplicationCard.svelte";
  import ActionBar from "$lib/components/ActionBar.svelte";
  import { invalidateAll } from "$app/navigation";
  import { supabaseClient } from "$lib/supabaseClient";

  import { startLiveSync } from "$lib/utils/liveSync";

  let { data } = $props();
  let userRole = $derived(data.userRole || "security");

  let tab = $state("Document Review");
  const tabs = [
    "Document Review",
    "Sticker Installation",
    "Registered",
    "Revoked Registered",
  ];

  // ── Vehicle Monitoring ──────────────────────────────────────────────────
  let vehicles = $state(data.vehicles);

  // Sync vehicles state when data changes via invalidateAll
  $effect(() => {
    vehicles = data.vehicles;
  });

  // Dual-engine live sync for instant automatic updates without page refresh
  $effect(() => {
    return startLiveSync({
      channelName: "security-realtime",
      tables: ["registration", "vehicle_log", "parking_availability"],
      intervalMs: 5000,
      onSync: () => {
        fetchLogs();
        fetchParkingStatus();
      }
    });
  });

  let searchQuery = $state("");
  let vehicleTypeFilter = $state("all"); // 'all', '2-Wheeler / Motorcycle', '4-Wheeler / Car'

  // Capacity editing
  let editingCapacity = $state(false);
  let newCapacity = $state(data.stats.maxCapacity);
  let capacityLoading = $state(false);

  async function updateCapacity() {
    if (newCapacity < 0 || newCapacity > 10000) {
      alert("Capacity must be between 0 and 10000");
      return;
    }

    capacityLoading = true;
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parking_capacity: newCapacity,
          max_capacity: newCapacity,
        }),
      });

      if (res.ok) {
        data.stats.maxCapacity = newCapacity;
        editingCapacity = false;
        alert("Capacity updated successfully");
      } else {
        const json = await res.json();
        alert(json.error || "Failed to update capacity");
      }
    } catch (e) {
      alert("Network error");
    } finally {
      capacityLoading = false;
    }
  }

  // Real-time parking status updates
  async function fetchParkingStatus() {
    try {
      const res = await fetch("/api/gate/stats");
      if (res.ok) {
        const json = await res.json();
        data.stats.slot_occupied = json.slot_occupied || 0;
        data.stats.slot_unoccupied =
          json.slot_unoccupied || data.stats.maxCapacity;
        data.stats.currentlyIn = json.currentlyIn || 0;
      }
    } catch (e) {
      console.error("Error fetching parking status:", e);
    }
  }

  // Poll for real-time updates every 30 seconds
  $effect(() => {
    const statusInterval = setInterval(fetchParkingStatus, 30000);
    return () => {
      clearInterval(statusInterval);
    };
  });

  // ── Photo modal ──────────────────────────────────────────────────────────
  let showModal = $state(false);
  let modalImage = $state("");
  function openPhoto(url: string | null) {
    if (!url) return;
    modalImage = url;
    showModal = true;
  }

  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (e: MouseEvent) => {
      if (node && !node.contains(e.target as Node) && !e.defaultPrevented) {
        callback();
      }
    };
    document.addEventListener("click", handleClick, true);
    return {
      destroy() {
        document.removeEventListener("click", handleClick, true);
      },
    };
  }

  // For History tab - gate logs from vehicle_log table
  let logs = $state<any[]>([]);
  let totalLogs = $state(0);
  let currentPage = $state(1);
  let totalPages = $state(1);
  const pageSize = 25;
  let loading = $state(false);

  let selectedDate = $state(new Date().toISOString().split("T")[0]);
  let boundFilter = $state("all");
  let selectedCampus = $state("all");

  // Print functionality for Vehicle Log tab
  let selectedLogs = $state(new Set<number>());
  let selectAllChecked = $state(false);
  let printModeActive = $state(false);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Role filter functionality
  const allRoles = [
    "student",
    "employee",
    "visitor",
    "concessionaire",
    "guest",
    "vip",
  ];
  let selectedRoles = $state<string[]>([]);
  let roleDropdownOpen = $state(false);

  function toggleRole(role: string) {
    if (selectedRoles.includes(role)) {
      selectedRoles = selectedRoles.filter((r) => r !== role);
    } else {
      selectedRoles = [...selectedRoles, role];
    }
    currentPage = 1;
    fetchLogs();
  }

  function getRoleDropdownLabel() {
    if (selectedRoles.length === 0) return "All Roles";
    if (selectedRoles.length === allRoles.length) return "All Roles";
    if (selectedRoles.length === 1)
      return (
        selectedRoles[0].charAt(0).toUpperCase() + selectedRoles[0].slice(1)
      );
    return `${selectedRoles.length} Roles Selected`;
  }

  function toDocUrl(val: any): string | null {
    if (!val || typeof val !== "string") return null;
    const trimmed = val.trim();
    if (
      trimmed.startsWith("/") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("data:")
    ) {
      return trimmed;
    }
    return null;
  }

  // Vehicles filtering
  const filteredVehicles = $derived(
    vehicles.filter((v: any) => {
      const matchesSearch =
        (v.first_name?.toLowerCase() || "").includes(
          searchQuery.toLowerCase(),
        ) ||
        (v.last_name?.toLowerCase() || "").includes(
          searchQuery.toLowerCase(),
        ) ||
        (v.vehicle_plate?.toLowerCase() || "").includes(
          searchQuery.toLowerCase(),
        ) ||
        (v.id || "").toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType =
        vehicleTypeFilter === "all" || v.vehicle_type === vehicleTypeFilter;

      return matchesSearch && matchesType;
    }),
  );

  let displayedApps = $derived.by(() => {
    let filtered = [...vehicles];

    if (tab === "Document Review") {
      // Show applications that have been checked by OSA (osa_dist_at) but not yet checked by Security
      filtered = filtered.filter(
        (v: any) =>
          v.status === "distributed" && v.osa_dist_at && !v.security_checked_at,
      );
    } else if (tab === "Sticker Installation") {
      // Show applications that have been released by OSA (sticker_released_at) but not yet installed
      filtered = filtered.filter(
        (v: any) =>
          v.status === "completed" &&
          v.sticker_released_at &&
          !v.sticker_installed_at,
      );
    } else if (tab === "Registered") {
      // Show fully registered applications (sticker installed)
      filtered = filtered.filter(
        (v: any) => v.status === "completed" && v.sticker_installed_at,
      );
    } else if (tab === "Revoked Registered") {
      // Show revoked applications
      filtered = filtered.filter((v: any) => v.status === "revoked");
    }

    if (vehicleTypeFilter !== "all") {
      filtered = filtered.filter(
        (v: any) => v.vehicle_type === vehicleTypeFilter,
      );
    }

    if (selectedRoles.length > 0 && selectedRoles.length < allRoles.length) {
      filtered = filtered.filter(
        (v: any) => v.role && selectedRoles.includes(v.role.toLowerCase()),
      );
    }

    if (selectedCampus !== "all") {
      filtered = filtered.filter((v: any) => v.campus === selectedCampus);
    }

    if (searchQuery) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((v: any) => {
        const fullString = Object.values(v)
          .filter((val) => val !== null && val !== undefined)
          .map((val) => String(val).toLowerCase())
          .join(" ");
        return terms.every((term) => fullString.includes(term));
      });
    }

    return filtered;
  });

  async function revokeQR(registrationId: number) {
    if (
      !confirm(
        "Are you sure you want to revoke this QR code? The vehicle will be denied access.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/monitor/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId }),
      });
      if (res.ok) {
        vehicles = vehicles.map((v: any) =>
          v.registration_id === registrationId
            ? { ...v, status: "revoked" }
            : v,
        );
      } else {
        alert("Failed to revoke QR code.");
      }
    } catch (e) {
      console.error(e);
      alert("Error revoking QR code.");
    }
  }

  async function unrevokeQR(registrationId: number) {
    if (
      !confirm(
        "Restore access for this vehicle? Their QR code will be reactivated.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/monitor/revoke`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId }),
      });
      if (res.ok) {
        vehicles = vehicles.map((v: any) =>
          v.registration_id === registrationId
            ? { ...v, status: "distributed" }
            : v,
        );
      } else {
        alert("Failed to restore QR code.");
      }
    } catch (e) {
      console.error(e);
      alert("Error restoring QR code.");
    }
  }

  async function deleteApp(registrationId: number) {
    if (
      !confirm("Are you sure you want to permanently delete this registration?")
    )
      return;
    try {
      const res = await fetch("/api/osa/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration_id: registrationId,
          action: "delete",
        }),
      });
      if (res.ok) {
        vehicles = vehicles.filter(
          (v: any) => v.registration_id !== registrationId,
        );
        alert("Registration deleted successfully.");
      } else {
        alert("Failed to delete registration.");
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting registration.");
    }
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      fetchLogs();
    }, 300);
  }

  // Reset pagination when switching tabs
  $effect(() => {
    if (tab === "Vehicle Log" || tab === "Revoked Registered") {
      currentPage = 1;
      fetchLogs();
    }
  });

  // Reset selection when logs change
  $effect(() => {
    if (logs.length === 0) {
      selectedLogs.clear();
      selectAllChecked = false;
      printModeActive = false;
    }
  });

  async function fetchLogs() {
    loading = true;
    try {
      // Fetch gate logs from vehicle_log table for both History and Vehicle Log tabs
      const params = new URLSearchParams({
        date: selectedDate,
        search: searchQuery,
        bound: boundFilter,
        page: String(currentPage),
        limit: String(pageSize),
      });
      if (selectedRoles.length > 0) {
        params.append("roles", selectedRoles.join(","));
      }
      const res = await fetch(`/api/gate/logs?${params}`);
      if (res.ok) {
        const json = await res.json();
        logs = json.logs;
        totalLogs = json.total;
        currentPage = json.page;
        totalPages = json.totalPages;
      }
    } catch (e) {
      console.error(e);
    }
    loading = false;
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

  // Print functionality for Vehicle Log tab
  function toggleLogSelection(logId: number) {
    if (selectedLogs.has(logId)) {
      selectedLogs.delete(logId);
    } else {
      selectedLogs.add(logId);
    }
    selectAllChecked = selectedLogs.size === logs.length && logs.length > 0;
  }

  function toggleSelectAll() {
    selectAllChecked = !selectAllChecked;
    if (selectAllChecked) {
      selectedLogs = new Set(logs.map((log: any) => log.vehicle_log_id));
    } else {
      selectedLogs.clear();
    }
  }

  function togglePrintMode() {
    console.log("Toggle print mode called, current state:", printModeActive);
    printModeActive = !printModeActive;
    console.log("New print mode state:", printModeActive);
    if (!printModeActive) {
      selectedLogs.clear();
      selectAllChecked = false;
    }
  }

  function printSelectedLogs() {
    const selectedLogsData = logs.filter((log: any) =>
      selectedLogs.has(log.vehicle_log_id),
    );
    if (selectedLogsData.length === 0) {
      alert("Please select at least one log to print.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to print.");
      return;
    }

    const printContent = `
            <html>
            <head>
                <title>Vehicle Log Report</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { text-align: center; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; font-weight: bold; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .print-date { text-align: right; margin-bottom: 10px; }
                
  /* -- Sticker Installation Tab ------------------------------------------- */
  .install-info-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: #eff6ff;
    border: 1.5px solid #bfdbfe;
    border-radius: var(--radius-sm);
    color: #1d4ed8;
    font-size: 0.8rem;
    margin-bottom: 1rem;
    line-height: 1.5;
  }
  .install-info-banner svg { flex-shrink: 0; margin-top: 1px; }
  .install-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .install-meta { display: flex; flex-direction: column; gap: 0.15rem; }
  .install-date-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .install-date-value { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
  .btn-install {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.625rem 1.125rem;
    background: #ecfdf5;
    color: #047857;
    border: 1.5px solid #a7f3d0;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, transform 0.15s;
  }
  .btn-install:not(:disabled):hover { background: #d1fae5; transform: translateY(-1px); }
  .btn-install:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-install.btn-loading { opacity: 1; cursor: wait; }
  .btn-spinner { width: 14px; height: 14px; animation: spin-install 0.75s linear infinite; flex-shrink: 0; }
  @keyframes spin-install { to { transform: rotate(360deg); } }
  .empty-state-install {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 4rem 2rem; background: var(--surface); border: 1.5px dashed var(--border);
    border-radius: var(--radius-md); text-align: center; gap: 0.75rem; color: var(--text-secondary);
  }
  .empty-state-install svg { color: var(--text-dim); }
  .empty-state-install h3 { font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0; }
  .empty-state-install p { font-size: 0.85rem; max-width: 400px; margin: 0; }
</style>
            </head>
            <body>
                <h1>Vehicle Log Report</h1>
                <div class="print-date">Printed: ${new Date().toLocaleString()}</div>
                <table>
                    <thead>
                        <tr>
                            <th>Log ID</th>
                            <th>Registration ID</th>
                            <th>Vehicle Info ID</th>
                            <th>Check In</th>
                            <th>Check Out</th>
                            <th>Logged Status</th>
                            <th>Created At</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${selectedLogsData
                          .map(
                            (log) => `
                            <tr>
                                <td>${log.vehicle_log_id}</td>
                                <td>${log.registration_id}</td>
                                <td>${log.vehicle_information_id}</td>
                                <td>${new Date(log.check_in).toLocaleString()}</td>
                                <td>${log.check_out ? new Date(log.check_out).toLocaleString() : "Still Inside"}</td>
                                <td>${log.logged_status}</td>
                                <td>${new Date(log.created_at).toLocaleString()}</td>
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
            </body>
            </html>
        `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  }
  // ── Sticker Installation ─────────────────────────────────────────────────
  let installationSearch = $state("");
  let installationLoading = $state<number | null>(null);

  // Vehicles that have had stickers released by OSA (sticker_released_at is set) but not yet marked as installed
  let installationVehicles = $derived(
    vehicles.filter(
      (v: any) =>
        v.status === "completed" &&
        v.sticker_released_at &&
        !v.sticker_installed_at,
    ),
  );

  let filteredInstallationVehicles = $derived(
    installationVehicles.filter((v: any) => {
      if (!installationSearch) return true;
      const terms = installationSearch
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const fullString = Object.values(v)
        .filter((val) => val !== null && val !== undefined)
        .map((val) => String(val).toLowerCase())
        .join(" ");
      return terms.every((term: string) => fullString.includes(term));
    }),
  );

  async function markStickerInstalled(registrationId: number) {
    if (
      !confirm(
        "Confirm that the sticker has been physically installed on the vehicle?",
      )
    )
      return;
    installationLoading = registrationId;
    try {
      const res = await fetch("/api/security/sticker-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId }),
      });
      if (res.ok) {
        vehicles = vehicles.map((v: any) =>
          v.registration_id === registrationId
            ? { ...v, sticker_installed_at: new Date().toISOString() }
            : v,
        );
      } else {
        const err = await res.json();
        alert(err.error || "Failed to mark sticker as installed.");
      }
    } catch (e) {
      alert("Network error. Please try again.");
    } finally {
      installationLoading = null;
    }
  }
</script>

<svelte:head>
  <title>Application Review — Security | GateQR</title>
  <meta
    name="description"
    content="Security vehicle monitoring dashboard for Liceo de Cagayan University."
  />
</svelte:head>

{#if showModal}
  <div
    class="modal-backdrop"
    onclick={() => (showModal = false)}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === "Escape" && (showModal = false)}
  >
    <div
      class="modal-content"
      onclick={(e) => e.stopPropagation()}
      role="document"
    >
      <button class="modal-close" onclick={() => (showModal = false)}
        >&times;</button
      >
      <img src={modalImage} alt="Snapshot" />
    </div>
  </div>
{/if}

<AppShell showSidebar={true} userEmail={data.userEmail} {userRole}>
  <NavBar title="Application Review" />

  <TabBar {tabs} active={tab} onchange={(t) => (tab = t)} />

  {#if tab === "Document Review" || tab === "Registered" || tab === "Revoked Registered"}
    <!-- Monitoring Tab - Registered Vehicles -->
    <div class="controls-row">
      <div class="search-wrap">
        <svg
          class="search-icon"
          width="14"
          height="14"
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
          data={{
            id: app.registration_id || "-",
            name: `${app.first_name} ${app.last_name}`,
            role: app.role,
            campus: app.campus || "-",
            "year level": app.year_level || "-",
            email: app.user_email || "-",
            contact: app.mobile || "-",
            department: app.department_name || "-",
            "dept. email": app.department_email || "-",
            vehicle: app.vehicle_information?.brand || "-",
            "vehicle type": app.vehicle_information?.type || "-",
            color: app.vehicle_information?.color || "-",
            plate: app.vehicle_information?.plate_number || "-",
            owner: app.is_owner ? "Yes" : "No",
            status: app.status,
            "dean status": app.dept_val_at
              ? "Approved"
              : app.status === "rejected"
                ? "Rejected"
                : app.status === "dept_val"
                  ? "Pending"
                  : "N/A",
            crd: app.created_at,
            dpt: app.dept_val_at,
            osa: app.osa_val_at,
            sch: app.dist_sched,
            hdc: app.osa_dist_at,
            sec: app.security_checked_at,
            rel: app.sticker_released_at,
            ins: app.sticker_installed_at,
            exp: app.expires_at,
            rejection_reason: app.invalid_reason || null,
            is_change_vehicle: app.is_change_vehicle,
            qr_code: app.qr_code,
            qr_unique_code: app.qr_unique_code,
            documents: {
              id:
                toDocUrl(app.doc_id) ||
                toDocUrl(app.vehicle_information?.school_id),
              enrollment:
                toDocUrl(app.doc_load) || toDocUrl(app.enrollment_form),
              or:
                toDocUrl(app.doc_or) ||
                toDocUrl(app.vehicle_information?.or_document),
              cr:
                toDocUrl(app.doc_cr) ||
                toDocUrl(app.vehicle_information?.cr_document),
              license:
                toDocUrl(app.doc_license) ||
                toDocUrl(app.vehicle_information?.drivers_license),
              letter:
                toDocUrl(app.doc_letter) ||
                toDocUrl(app.vehicle_information?.authorization_letter),
            },
          }}
          showQR={true}
        >
          {#snippet children()}
            <ActionBar
              {tab}
              status={app.status}
              expiresAt={app.expires_at}
              onaction={async (action, schedule) => {
                if (action === "revoke") {
                  await revokeQR(app.registration_id);
                } else if (action === "unrevoke") {
                  await unrevokeQR(app.registration_id);
                } else if (action === "delete") {
                  await deleteApp(app.registration_id);
                } else if (
                  action === "security_check" ||
                  action === "install_sticker"
                ) {
                  try {
                    const res = await fetch(`/api/monitor/actions`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        vehicle_id: app.registration_id,
                        action,
                      }),
                    });
                    if (res.ok) {
                      if (action === "security_check") {
                        vehicles = vehicles.map((v: any) =>
                          v.registration_id === app.registration_id
                            ? {
                                ...v,
                                security_checked_at: new Date().toISOString(),
                              }
                            : v,
                        );
                      } else if (action === "install_sticker") {
                        vehicles = vehicles.map((v: any) =>
                          v.registration_id === app.registration_id
                            ? {
                                ...v,
                                sticker_installed_at: new Date().toISOString(),
                              }
                            : v,
                        );
                      }
                    } else {
                      alert("Failed to perform action.");
                    }
                  } catch (e) {
                    alert("Error performing action.");
                  }
                }
              }}
            />
          {/snippet}
        </ApplicationCard>
      {:else}
        <p class="empty-state">No vehicles found.</p>
      {/each}
    </div>
  {:else if tab === "Vehicle Log"}
    <!-- Vehicle Log Tab - Gate Logs Only -->
    <div class="card">
      <div class="header">
        <div class="header-left">
          <h2 class="title">Gate History</h2>
        </div>
        <div class="filters">
          <select
            bind:value={boundFilter}
            onchange={() => {
              currentPage = 1;
              fetchLogs();
            }}
            class="filter-select"
          >
            <option value="all">In &amp; Out</option>
            <option value="in">Entry Only</option>
            <option value="out">Exit Only</option>
          </select>
          <input
            type="date"
            bind:value={selectedDate}
            onchange={() => {
              currentPage = 1;
              fetchLogs();
            }}
            class="filter-select"
          />
          <input
            type="text"
            placeholder="Search…"
            bind:value={searchQuery}
            oninput={onSearchInput}
            class="search-box"
          />
          <button class="print-btn" onclick={() => togglePrintMode()}
            >{printModeActive ? "Cancel Selection" : "Print Selected"}</button
          >
          {#if printModeActive}
            <button class="print-btn" onclick={() => printSelectedLogs()}
              >Print</button
            >
          {/if}
        </div>
      </div>

      {#if loading}
        <div class="loading-row">
          <div class="spinner"></div>
          Loading…
        </div>
      {:else}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                {#if printModeActive}
                  <th class="select-column">
                    <input
                      type="checkbox"
                      checked={selectAllChecked}
                      onchange={() => toggleSelectAll()}
                    />
                  </th>
                {/if}
                <th>Log ID</th>
                <th>Registration ID</th>
                <th>Vehicle Info ID</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Logged Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {#each logs as log}
                <tr class:selected-row={selectedLogs.has(log.vehicle_log_id)}>
                  {#if printModeActive}
                    <td class="select-column">
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.vehicle_log_id)}
                        onchange={() => toggleLogSelection(log.vehicle_log_id)}
                      />
                    </td>
                  {/if}
                  <td class="td-id">
                    <span class="id-text">{log.vehicle_log_id}</span>
                  </td>
                  <td class="td-id">
                    <span class="id-text">{log.registration_id}</span>
                  </td>
                  <td class="td-id">
                    <span class="id-text">{log.vehicle_information_id}</span>
                  </td>
                  <td class="td-time">
                    <span class="time-main"
                      >{new Date(log.check_in).toLocaleString()}</span
                    >
                  </td>
                  <td class="td-time">
                    <span class="time-main"
                      >{log.check_out
                        ? new Date(log.check_out).toLocaleString()
                        : "Still Inside"}</span
                    >
                  </td>
                  <td>
                    <span class="chip chip-status">{log.logged_status}</span>
                  </td>
                  <td class="td-time">
                    <span class="time-main"
                      >{new Date(log.created_at).toLocaleString()}</span
                    >
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan={printModeActive ? 8 : 7} class="empty-cell"
                    >No logs found for the selected filters.</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Paginator -->
        {#if totalPages > 1}
          <div class="paginator">
            <button
              class="page-btn"
              onclick={prevPage}
              disabled={currentPage <= 1}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
              >
              Prev
            </button>
            <span class="page-info">Page {currentPage} of {totalPages}</span>
            <button
              class="page-btn"
              onclick={nextPage}
              disabled={currentPage >= totalPages}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg
              >
              Next
            </button>
          </div>
        {/if}
      {/if}

      <!-- Selected Logs Table -->
      {#if printModeActive && selectedLogs.size > 0}
        <div class="selected-logs-section">
          <div class="header">
            <div class="header-left">
              <h2 class="title">Selected Logs ({selectedLogs.size})</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Log ID</th>
                  <th>Registration ID</th>
                  <th>Vehicle Info ID</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Logged Status</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {#each logs.filter( (log: any) => selectedLogs.has(log.vehicle_log_id), ) as log}
                  <tr>
                    <td class="td-id">
                      <span class="id-text">{log.vehicle_log_id}</span>
                    </td>
                    <td class="td-id">
                      <span class="id-text">{log.registration_id}</span>
                    </td>
                    <td class="td-id">
                      <span class="id-text">{log.vehicle_information_id}</span>
                    </td>
                    <td class="td-time">
                      <span class="time-main"
                        >{new Date(log.check_in).toLocaleString()}</span
                      >
                    </td>
                    <td class="td-time">
                      <span class="time-main"
                        >{log.check_out
                          ? new Date(log.check_out).toLocaleString()
                          : "Still Inside"}</span
                      >
                    </td>
                    <td>
                      <span class="chip chip-status">{log.logged_status}</span>
                    </td>
                    <td class="td-time">
                      <span class="time-main"
                        >{new Date(log.created_at).toLocaleString()}</span
                      >
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>
  {:else if tab === "History"}
    <!-- History Tab - Gate History from vehicle_log table -->
    <div class="card">
      <div class="header">
        <div class="header-left">
          <h2 class="title">Gate History</h2>
        </div>
        <div class="filters">
          <div
            class="dropdown-wrap"
            use:clickOutside={() => (roleDropdownOpen = false)}
          >
            <button
              class="filter-select dropdown-btn"
              onclick={() => (roleDropdownOpen = !roleDropdownOpen)}
            >
              {getRoleDropdownLabel()}
            </button>
            {#if roleDropdownOpen}
              <div class="dropdown-menu">
                {#each allRoles as role}
                  <label class="dropdown-item">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onchange={() => toggleRole(role)}
                    />
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
          <select
            bind:value={boundFilter}
            onchange={() => {
              currentPage = 1;
              fetchLogs();
            }}
            class="filter-select"
          >
            <option value="all">In & Out</option>
            <option value="in">In Only</option>
            <option value="out">Out Only</option>
          </select>
          <input
            type="date"
            bind:value={selectedDate}
            onchange={() => {
              currentPage = 1;
              fetchLogs();
            }}
            class="filter-select"
          />
          <select
            bind:value={selectedCampus}
            onchange={() => {
              currentPage = 1;
              fetchLogs();
            }}
            class="filter-select"
          >
            <option value="all">All Campuses</option>
            <option value="Liceo Main">Liceo Main</option>
            <option value="RNP">RNP</option>
            <option value="PASEO">PASEO</option>
          </select>
          <input
            type="text"
            placeholder="Search name, plate, vehicle…"
            bind:value={searchQuery}
            oninput={onSearchInput}
            class="search-box"
          />
        </div>
      </div>

      {#if loading}
        <div class="loading-row">
          <div class="spinner"></div>
          Loading…
        </div>
      {:else}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>TYPE</th>
                <th>NAME / ROLE</th>
                <th>VEHICLE</th>
                <th>BOUND</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {#each logs as log}
                <tr>
                  <td class="td-time">
                    <span class="time-main">{log.time}</span>
                    <span class="time-sub">{log.date}</span>
                  </td>
                  <td>
                    <span class="type-badge">{log.type}</span>
                  </td>
                  <td class="td-name">
                    <span class="name-text">{log.name}</span>
                    <span class="role-badge">{log.role}</span>
                  </td>
                  <td class="td-vehicle">
                    {log.make}
                    {log.vehicle_type}
                    <span class="plate-tag">{log.plate}</span>
                  </td>
                  <td>
                    <span
                      class="bound-badge {log.bound === 'In' ? 'in' : 'out'}"
                      >{log.bound}</span
                    >
                  </td>
                  <td>
                    <span
                      class="status-badge {log.status === 'Inside'
                        ? 'success'
                        : 'default'}">{log.status}</span
                    >
                  </td>
                </tr>
              {:else}
                <tr>
                  <td colspan="6" class="empty-cell"
                    >No logs found for the selected filters.</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Paginator -->
        {#if totalPages > 1}
          <div class="paginator">
            <button
              class="page-btn"
              onclick={prevPage}
              disabled={currentPage <= 1}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="15 18 9 12 15 6" /></svg
              >
              Prev
            </button>
            <span class="page-info">Page {currentPage} of {totalPages}</span>
            <button
              class="page-btn"
              onclick={nextPage}
              disabled={currentPage >= totalPages}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="9 18 15 12 9 6" /></svg
              >
              Next
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {:else if tab === "Sticker Installation"}
    <!-- Sticker Installation Tab - Security marks sticker as physically installed on vehicle -->
    <div class="controls-row">
      <div class="search-wrap">
        <svg
          class="search-icon"
          width="14"
          height="14"
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
          bind:value={installationSearch}
          class="search-input"
        />
        {#if installationSearch}
          <button
            class="search-clear"
            onclick={() => {
              installationSearch = "";
            }}>×</button
          >
        {/if}
      </div>
    </div>

    <div class="install-info-banner">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" /><line
          x1="12"
          y1="8"
          x2="12"
          y2="12"
        /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span
        >This tab lists applicants whose sticker has been released by OSA and is
        ready for physical installation on the vehicle. Click <strong
          >Mark as Installed</strong
        > once the sticker has been placed on the vehicle.</span
      >
    </div>

    <div class="cards-list">
      {#each filteredInstallationVehicles as app}
        <ApplicationCard
          data={{
            id: app.registration_id || "-",
            name: `${app.first_name} ${app.last_name}`,
            role: app.role,
            campus: app.campus || "-",
            "year level": app.year_level || "-",
            email: app.user_email || "-",
            contact: app.mobile || "-",
            department: app.department_name || "-",
            "dept. email": app.department_email || "-",
            vehicle: app.vehicle_information?.brand || "-",
            "vehicle type": app.vehicle_information?.type || "-",
            color: app.vehicle_information?.color || "-",
            plate: app.vehicle_information?.plate_number || "-",
            owner: app.is_owner ? "Yes" : "No",
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
            rejection_reason: app.invalid_reason || null,
            is_change_vehicle: app.is_change_vehicle,
            qr_code: app.qr_code,
            qr_unique_code: app.qr_unique_code,
            documents: {
              id:
                toDocUrl(app.doc_id) ||
                toDocUrl(app.vehicle_information?.school_id),
              enrollment:
                toDocUrl(app.doc_load) || toDocUrl(app.enrollment_form),
              or:
                toDocUrl(app.doc_or) ||
                toDocUrl(app.vehicle_information?.or_document),
              cr:
                toDocUrl(app.doc_cr) ||
                toDocUrl(app.vehicle_information?.cr_document),
              license:
                toDocUrl(app.doc_license) ||
                toDocUrl(app.vehicle_information?.drivers_license),
              letter:
                toDocUrl(app.doc_letter) ||
                toDocUrl(app.vehicle_information?.authorization_letter),
            },
          }}
          showQR={true}
        >
          {#snippet children()}
            <div class="install-action-row">
              <div class="install-meta">
                {#if app.sticker_released_at}
                  {@const releasedDate = new Date(app.sticker_released_at)}
                  {@const today = new Date()}
                  {@const isOverdue =
                    releasedDate.getDate() !== today.getDate() ||
                    releasedDate.getMonth() !== today.getMonth() ||
                    releasedDate.getFullYear() !== today.getFullYear()}
                  <span class="install-date-label">Sticker Released:</span>
                  <span class="install-date-value"
                    >{releasedDate.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}</span
                  >
                  {#if isOverdue && releasedDate < today}
                    <div
                      class="overdue-warning"
                      style="color: #b91c1c; font-size: 0.8rem; font-weight: 600; margin-top: 0.35rem; display: flex; align-items: center; gap: 0.35rem; background: #fef2f2; padding: 0.4rem 0.6rem; border-radius: 4px; border: 1px solid #fca5a5; width: fit-content;"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        /><line x1="12" y1="9" x2="12" y2="13" /><line
                          x1="12"
                          y1="17"
                          x2="12.01"
                          y2="17"
                        />
                      </svg>
                      WARNING: Applicant did not visit for installation
                    </div>
                  {/if}
                {/if}
              </div>
              <button
                class="action-btn btn-install"
                onclick={() => markStickerInstalled(app.registration_id)}
                disabled={installationLoading === app.registration_id}
                class:btn-loading={installationLoading === app.registration_id}
              >
                {#if installationLoading === app.registration_id}
                  <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-dasharray="35 15"
                      stroke-linecap="round"
                    />
                  </svg>
                  Installing…
                {:else}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Mark as Installed
                {/if}
              </button>
            </div>
          {/snippet}
        </ApplicationCard>
      {:else}
        <div class="empty-state-install">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M9 11l3 3L22 4" /><path
              d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
            />
          </svg>
          <h3>No Pending Installations</h3>
          <p>
            All stickers that have been released by OSA have been installed, or
            no stickers have been released yet.
          </p>
        </div>
      {/each}
    </div>
  {/if}
</AppShell>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
  }
  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .page-header {
    margin-bottom: 1.5rem;
  }

  .page-header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  /* ── Print / Tabs ────────────────────────────────────────────────────── */

  .parking-info {
    display: flex;
    gap: 2rem;
    align-items: center;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }

  .parking-stat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .parking-label {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .parking-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .capacity-input {
    width: 80px;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    font-weight: 600;
    margin-right: 0.5rem;
  }

  .capacity-btn {
    padding: 0.25rem 0.75rem;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    margin-right: 0.25rem;
  }

  .capacity-save {
    background: var(--maroon);
    color: white;
  }

  .capacity-save:hover:not(:disabled) {
    background: var(--maroon-light);
  }

  .capacity-cancel {
    background: #e2e8f0;
    color: var(--text-primary);
  }

  .capacity-cancel:hover:not(:disabled) {
    background: #cbd5e1;
  }

  .capacity-edit-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0.25rem;
    margin-left: 0.5rem;
    transition: color 0.2s;
  }

  .capacity-edit-btn:hover {
    color: var(--maroon);
  }

  .capacity-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .realtime-indicator {
    color: #22c55e;
    font-size: 0.6rem;
    margin-left: 0.25rem;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .parking-value.occupied {
    color: #dc2626;
  }

  .parking-value.available {
    color: #16a34a;
  }

  /* ── Controls ────────────────────────────────────────────────────────── */
  .controls-row {
    padding: 0.625rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    background: var(--background);
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
      min-width: 0;
    }
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
    left: 0.625rem;
    color: var(--text-dim);
    pointer-events: none;
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    height: 32px;
    padding: 0 2rem 0 2.1rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .search-input:focus {
    border-color: var(--maroon);
  }
  .search-clear {
    position: absolute;
    right: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    padding: 0;
  }
  .search-clear:hover {
    color: var(--text);
  }

  .filters {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-shrink: 0;
    pointer-events: auto;
  }

  .filter-select {
    height: 32px;
    padding: 0 0.625rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .filter-select:focus {
    border-color: var(--maroon);
  }

  .dropdown-wrap {
    position: relative;
  }
  .dropdown-btn {
    min-width: 130px;
    text-align: left;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    padding: 0.5rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 140px;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text);
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    transition: background 0.15s;
  }
  .dropdown-item:hover {
    background: var(--surface-hover);
  }

  /* ── Loading ─────────────────────────────────────────────────────────── */
  .loading-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 3rem;
    color: var(--text-dim);
    font-size: 0.875rem;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--maroon);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Table ───────────────────────────────────────────────────────────── */

  .td-time {
    min-width: 80px;
  }
  .time-main {
    display: block;
    font-weight: 600;
    color: var(--text);
  }

  .td-name {
    max-width: 180px;
  }
  .name-text {
    display: block;
    font-weight: 500;
  }
  .role-badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    margin-top: 2px;
    background: var(--border);
    color: var(--text-dim);
    text-transform: capitalize;
  }

  .td-vehicle {
    color: var(--text);
  }
  .plate-tag {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--border);
    color: var(--text-dim);
    margin-left: 4px;
    font-family: monospace;
    letter-spacing: 0.05em;
  }

  .card-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .card-qr img {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    background: white;
  }
  .card-qr a {
    font-size: 0.75rem;
    color: var(--maroon);
    text-decoration: none;
    font-weight: 600;
  }
  .card-qr a:hover {
    text-decoration: underline;
  }

  /* ── Chips ───────────────────────────────────────────────────────────── */
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .empty-cell {
    text-align: center;
    padding: 3rem;
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  /* ── Paginator ───────────────────────────────────────────────────────── */
  .paginator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.875rem;
    border-top: 1px solid var(--border);
  }
  .page-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0.4rem 0.875rem;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .page-btn:hover:not(:disabled) {
    border-color: var(--maroon);
    color: var(--maroon);
  }
  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-info {
    font-size: 0.8125rem;
    color: var(--text-dim);
  }

  /* ── Photo modal ─────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .modal-content {
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
  }
  .modal-content img {
    max-width: 100%;
    max-height: 90vh;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }
  .modal-close {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
  }

  .card {
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .header {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .search-box {
    height: 32px;
    padding: 0 0.625rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .search-box:focus {
    border-color: var(--maroon);
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.875rem;
  }

  .data-table th,
  .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .data-table th {
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.7rem;
    background: var(--surface);
    position: sticky;
    top: 0;
  }

  .data-table tbody tr:hover {
    background: var(--surface-hover);
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }

  /* ── Additional styles for monitoring/history tabs ──────────────────────── */
  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .card {
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .header {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .search-box {
    height: 32px;
    padding: 0 0.625rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .search-box:focus {
    border-color: var(--maroon);
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.875rem;
  }

  .data-table th,
  .data-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .data-table th {
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.7rem;
    background: var(--surface);
    position: sticky;
    top: 0;
  }

  .data-table tbody tr:hover {
    background: var(--surface-hover);
  }

  /* ── Chips ───────────────────────────────────────────────────────────── */
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .empty-cell {
    text-align: center;
    padding: 3rem;
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  /* ── Paginator ───────────────────────────────────────────────────────── */
  .paginator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.875rem;
    border-top: 1px solid var(--border);
  }
  .page-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm);
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .page-btn:hover:not(:disabled) {
    border-color: var(--maroon);
    color: var(--maroon);
  }
  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .page-info {
    font-size: 0.8125rem;
    color: var(--text-dim);
  }

  /* ── Photo modal ─────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .modal-content {
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
  }
  .modal-content img {
    max-width: 100%;
    max-height: 90vh;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }
  .modal-close {
    position: absolute;
    top: -40px;
    right: 0;
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
  }

  .table-wrap {
    overflow-x: auto;
  }
  .td-time {
    min-width: 80px;
  }
  .time-main {
    display: block;
    font-weight: 600;
    color: var(--text);
  }

  .td-name {
    max-width: 180px;
  }
  .name-text {
    display: block;
    font-weight: 500;
  }
  .role-badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    margin-top: 2px;
    background: var(--border);
    color: var(--text-dim);
    text-transform: capitalize;
  }
  .td-vehicle {
    color: var(--text);
  }
  .plate-tag {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--border);
    color: var(--text-dim);
    margin-left: 4px;
    font-family: monospace;
    letter-spacing: 0.05em;
  }

  .card-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .card-qr img {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    background: white;
  }
  .card-qr a {
    font-size: 0.75rem;
    color: var(--maroon);
    text-decoration: none;
    font-weight: 600;
  }
  .card-qr a:hover {
    text-decoration: underline;
  }

  /* ── Print functionality styles ─────────────────────────────────────────── */
  .print-btn {
    background: var(--maroon);
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    pointer-events: auto;
    z-index: 1;
  }
  .print-btn:hover {
    background: #8b1a3b;
  }

  .select-column {
    width: 40px;
    text-align: center;
  }
  .select-column input[type="checkbox"] {
    cursor: pointer;
  }

  .td-id {
    text-align: center;
  }
  .id-text {
    font-family: monospace;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .selected-row {
    background-color: #fff3cd !important;
  }

  .selected-logs-section {
    margin-top: 1.5rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  /* -- Sticker Installation Tab ------------------------------------------- */
  .install-info-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    background: #eff6ff;
    border: 1.5px solid #bfdbfe;
    border-radius: var(--radius-sm);
    color: #1d4ed8;
    font-size: 0.8rem;
    margin-bottom: 1rem;
    line-height: 1.5;
  }
  .install-info-banner svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .install-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .install-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .install-date-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }
  .install-date-value {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .btn-install {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.625rem 1.125rem;
    background: #ecfdf5;
    color: #047857;
    border: 1.5px solid #a7f3d0;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.15s,
      transform 0.15s;
  }
  .btn-install:not(:disabled):hover {
    background: #d1fae5;
    transform: translateY(-1px);
  }
  .btn-install:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-install.btn-loading {
    opacity: 1;
    cursor: wait;
  }
  .btn-spinner {
    width: 14px;
    height: 14px;
    animation: spin-install 0.75s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin-install {
    to {
      transform: rotate(360deg);
    }
  }
  .empty-state-install {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
    text-align: center;
    gap: 0.75rem;
    color: var(--text-secondary);
  }
  .empty-state-install svg {
    color: var(--text-dim);
  }
  .empty-state-install h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .empty-state-install p {
    font-size: 0.85rem;
    max-width: 400px;
    margin: 0;
  }
</style>
