<script lang="ts">
  import { showAlert, askConfirm } from '$lib/utils/dialog';
  import AppShell from "$lib/components/AppShell.svelte";
  import NavBar from "$lib/components/NavBar.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import ApplicationCard from "$lib/components/ApplicationCard.svelte";
  import ActionBar from "$lib/components/ActionBar.svelte";
  import ViolationModal from "$lib/components/ViolationModal.svelte";
  import { printRegisteredVehicles } from "$lib/utils/printRecords";
  import { invalidateAll } from "$app/navigation";
  import { supabaseClient } from "$lib/supabaseClient";

  import { startLiveSync } from "$lib/utils/liveSync";

  let { data } = $props();
  let userRole = $derived(data.userRole || "security");

  let tab = $state(data.initialTab || "Document Review");

  function switchTab(newTab: string) {
    tab = newTab;
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", newTab);
      window.history.replaceState({}, "", u.toString());
    }
  }

  const tabs = [
    "Document Review",
    "Registered Vehicles",
    "Rejected or Revoked Accounts & Applications",
  ];

  const tabLabels: Record<string, string> = {
    "Document Review": "Document Review",
    "Registered Vehicles": "Registered Vehicles",
    "Rejected or Revoked Accounts & Applications": "Rejected, Revoked & Blocked",
  };

  // ── Vehicle Monitoring ──────────────────────────────────────────────────
  let vehicles = $state(data.vehicles);

  // Rejected, Revoked & Blocked tab: sub-filter
  let rejectedFilter = $state<"all" | "rejected" | "revoked" | "blocked">("all");

  // Record Violation modal (Registered Vehicles tab)
  let violationTarget = $state<{ id: number; name: string; plate: string } | null>(null);

  // Registered Vehicles: select records to print
  let printSelectedIds = $state<Set<number>>(new Set());
  let isRegisteredTab = $derived(tab === "Registered Vehicles" || tab === "Registered");

  function togglePrintSelection(id: number, on: boolean) {
    const next = new Set(printSelectedIds);
    if (on) next.add(id); else next.delete(id);
    printSelectedIds = next;
  }

  // Sync vehicles state when data changes via invalidateAll
  $effect(() => {
    vehicles = data.vehicles;
  });

  // Pure realtime WebSocket sync for instant updates without background polling
  $effect(() => {
    return startLiveSync({
      channelName: "security-realtime",
      tables: ["registration", "vehicle_log", "parking_capacity"],
      onSync: () => {
        if (tab === "Vehicle Log") {
          fetchLogs();
        }
        fetchParkingStatus();
      }
    });
  });

  function getAppsForTab(t: string) {
    if (t === "Document Review") {
      return vehicles.filter(
        (v: any) =>
          ((v.status || "").toLowerCase() === "distributed" || v.osa_dist_at) && !v.security_check_at && !v.security_checked_at
      );
    }
    if (t === "Registered Vehicles" || t === "Registered") {
      return vehicles.filter(
        (v: any) => ["approved", "completed"].includes((v.status || "").toLowerCase())
      );
    }
    if (t === "Rejected or Revoked Accounts & Applications" || t === "Revoked Registered") {
      return vehicles.filter((v: any) => ['revoked', 'rejected'].includes((v.status || "").toLowerCase()) || v.active_block);
    }
    return [];
  }

  let tabCounts = $derived([
    getAppsForTab("Document Review").length,
    getAppsForTab("Registered Vehicles").length,
    getAppsForTab("Rejected or Revoked Accounts & Applications").length,
  ]);

  let searchQuery = $state("");
  let roleFilter = $state("all"); // 'all', 'student', 'faculty', 'staff'
  let vehicleTypeFilter = $state("all"); // 'all', '2-Wheeler / Motorcycle', '4-Wheeler / Car'

  // Capacity editing
  let editingCapacity = $state(false);
  let newCapacity = $state(data.stats.maxCapacity);
  let capacityLoading = $state(false);

  async function updateCapacity() {
    if (newCapacity < 0 || newCapacity > 10000) {
      showAlert("Capacity must be between 0 and 10000");
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
        showAlert("Capacity updated successfully");
      } else {
        const json = await res.json();
        showAlert(json.error || "Failed to update capacity");
      }
    } catch (e) {
      showAlert("Network error");
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
      if (node && !node.contains(e.target as Node)) {
        callback();
      }
    };
    document.addEventListener("click", handleClick);
    return {
      destroy() {
        document.removeEventListener("click", handleClick);
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

  // Role filter functionality - All university gate roles
  const allRoles = [
    "student",
    "faculty",
    "staff",
    "administrator",
    "concessionaire",
    "supplier",
    "vps",
    "vip",
  ];
  let selectedRoles = $state<string[]>([]);
  let roleDropdownOpen = $state(false);

  function formatRoleLabel(role: string): string {
    const lower = (role || "").toLowerCase();
    if (lower === "vps") return "VPS";
    if (lower === "vip") return "VIP";
    if (lower === "administrator") return "Administrator";
    if (lower === "concessionaire" || lower === "concecioonaire") return "Concessionaire";
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function selectRole(role: string) {
    if (role === 'all' || !role) {
      selectedRoles = [];
    } else {
      selectedRoles = [role];
    }
    roleDropdownOpen = false;
    currentPage = 1;
    fetchLogs();
  }

  function getRoleDropdownLabel() {
    if (selectedRoles.length === 0 || selectedRoles.length === allRoles.length) return "All Roles";
    if (selectedRoles.length === 1) return formatRoleLabel(selectedRoles[0]);
    return formatRoleLabel(selectedRoles[0]);
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

      const rawType = (v.vehicle_type || v.vehicle_information?.type || "").toLowerCase().trim();
      const matchesType =
        vehicleTypeFilter === "all" ||
        ((vehicleTypeFilter === "2 wheelers" || vehicleTypeFilter === "2-wheelers" || vehicleTypeFilter === "2-Wheeler / Motorcycle" || vehicleTypeFilter === "2-wheeler") && (rawType.includes("2") || rawType.includes("motor") || rawType.includes("bike"))) ||
        ((vehicleTypeFilter === "4 wheelers" || vehicleTypeFilter === "4-wheelers" || vehicleTypeFilter === "4-Wheeler / Car" || vehicleTypeFilter === "4-wheeler") && (rawType.includes("4") || rawType.includes("car"))) ||
        rawType === vehicleTypeFilter.toLowerCase();

      return matchesSearch && matchesType;
    }),
  );

  let displayedApps = $derived.by(() => {
    let filtered = [...vehicles];

    if (tab === "Document Review") {
      filtered = filtered.filter(
        (v: any) =>
          ((v.status || "").toLowerCase() === "distributed" || v.osa_dist_at) && !v.security_check_at && !v.security_checked_at
      );
    } else if (tab === "Registered Vehicles" || tab === "Registered") {
      filtered = filtered.filter(
        (v: any) => ["approved", "completed"].includes((v.status || "").toLowerCase())
      );
    } else if (tab === "Rejected or Revoked Accounts & Applications" || tab === "Revoked Registered") {
      filtered = filtered.filter((v: any) => ['revoked', 'rejected'].includes((v.status || "").toLowerCase()) || v.active_block);
      if (rejectedFilter === "rejected") filtered = filtered.filter((v: any) => (v.status || "").toLowerCase() === "rejected");
      else if (rejectedFilter === "revoked") filtered = filtered.filter((v: any) => (v.status || "").toLowerCase() === "revoked");
      else if (rejectedFilter === "blocked") filtered = filtered.filter((v: any) => v.active_block);
    }

    if (roleFilter !== "all") {
      filtered = filtered.filter((v: any) => {
        const r = (v.role || "").toLowerCase().trim();
        if (roleFilter === "student") return r === "student";
        if (roleFilter === "staff") return r === "staff" || r === "employee";
        if (roleFilter === "faculty") return r === "faculty";
        if (roleFilter === "concessionnare" || roleFilter === "concessionaire") return r === "concessionaire" || r === "concessionnare" || r === "concecioonaire";
        if (roleFilter === "supplier") return r === "supplier";
        if (roleFilter === "administrator") return r === "administrator" || r === "admin";
        if (roleFilter === "vps") return r === "vps";
        return r === roleFilter.toLowerCase();
      });
    }

    if (vehicleTypeFilter !== "all") {
      filtered = filtered.filter((v: any) => {
        const rawType = (v.vehicle_type || v.vehicle_information?.type || "").toLowerCase().trim();
        if (vehicleTypeFilter === "2 wheelers" || vehicleTypeFilter === "2-wheelers" || vehicleTypeFilter === "2-Wheeler / Motorcycle" || vehicleTypeFilter === "2-wheeler") {
          return rawType.includes("2") || rawType.includes("motor") || rawType.includes("bike");
        }
        if (vehicleTypeFilter === "4 wheelers" || vehicleTypeFilter === "4-wheelers" || vehicleTypeFilter === "4-Wheeler / Car" || vehicleTypeFilter === "4-wheeler") {
          return rawType.includes("4") || rawType.includes("car");
        }
        return rawType === vehicleTypeFilter.toLowerCase();
      });
    }

    if (selectedCampus !== "all") {
      filtered = filtered.filter((v: any) => {
        const c = (v.campus || "").toLowerCase().trim();
        if (selectedCampus === 'Main campus' || selectedCampus === 'main') {
          return c.includes('main');
        }
        if (selectedCampus === 'rnp campus' || selectedCampus === 'rnp') {
          return c.includes('rnp');
        }
        if (selectedCampus === 'Paseo' || selectedCampus === 'paseo') {
          return c.includes('paseo');
        }
        return c === selectedCampus.toLowerCase().trim();
      });
    }

    if (searchQuery && searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((v: any) => {
        const searchTarget = [
          v.first_name,
          v.last_name,
          `${v.first_name || ""} ${v.last_name || ""}`,
          v.student_id,
          v.id_no,
          v.user_email,
          v.mobile,
          v.department_name,
          v.campus,
          v.role,
          v.vehicle_plate,
          v.vehicle_make,
          v.vehicle_color,
          v.vehicle_type,
          v.vehicle_information?.plate_number,
          v.vehicle_information?.brand,
          v.vehicle_information?.color,
          v.vehicle_information?.type,
          v.qr_unique_code,
          v.registration_id,
          v.id
        ].filter(Boolean).map(String).join(" ").toLowerCase();

        return terms.every((term) => searchTarget.includes(term));
      });
    }

    return filtered;
  });

  async function revokeQR(registrationId: number) {
    if (
      !await askConfirm(
        "Are you sure you want to revoke this QR code? The vehicle will be denied access.",
      )
    )
      return;
    const previous = vehicles;
    vehicles = vehicles.map((v: any) =>
      v.registration_id === registrationId
        ? { ...v, status: "revoked" }
        : v,
    );
    try {
      const res = await fetch(`/api/monitor/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId }),
      });
      if (res.ok) {
        invalidateAll();
      } else {
        vehicles = previous;
        showAlert("Failed to revoke QR code.");
      }
    } catch (e) {
      vehicles = previous;
      console.error(e);
      showAlert("Error revoking QR code.");
    }
  }

  async function unrevokeQR(registrationId: number) {
    if (
      !await askConfirm(
        "Restore access for this vehicle? Their QR code will be reactivated.",
      )
    )
      return;
    const previous = vehicles;
    vehicles = vehicles.map((v: any) =>
      v.registration_id === registrationId
        ? { ...v, status: "approved" }
        : v,
    );
    try {
      const res = await fetch(`/api/monitor/revoke`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: registrationId }),
      });
      if (res.ok) {
        invalidateAll();
      } else {
        vehicles = previous;
        showAlert("Failed to restore QR code.");
      }
    } catch (e) {
      vehicles = previous;
      console.error(e);
      showAlert("Error restoring QR code.");
    }
  }

  async function deleteApp(registrationId: number) {
    if (
      !await askConfirm("Are you sure you want to permanently delete this registration?")
    )
      return;
    const previous = vehicles;
    vehicles = vehicles.filter(
      (v: any) => v.registration_id !== registrationId,
    );
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
        invalidateAll();
      } else {
        vehicles = previous;
        showAlert("Failed to delete registration.");
      }
    } catch (e) {
      vehicles = previous;
      console.error(e);
      showAlert("Error deleting registration.");
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
      showAlert("Please select at least one log to print.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showAlert("Please allow popups to print.");
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
                </style>
            </head>
            <body>
                <h1>Vehicle Log Report</h1>
                <div class="print-date">Printed: ${new Date().toLocaleString()}</div>
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
                        ${selectedLogsData
                          .map(
                            (log) => `
                            <tr>
                                <td>#${log.vehicle_log_id}</td>
                                <td>${log.plate || log.vehicle_plate || 'No Plate'}</td>
                                <td>${log.driver_name || log.name || 'Driver'} (${log.role || 'Visitor'})</td>
                                <td>${log.check_in ? new Date(log.check_in).toLocaleString() : '—'}</td>
                                <td>${log.check_out ? new Date(log.check_out).toLocaleString() : "Still Inside"}</td>
                                <td>${log.logged_status || (log.check_out ? 'Exited' : 'Inside')}</td>
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

  <TabBar {tabs} active={tab} counts={tabCounts} labels={tabLabels} onchange={switchTab} />

  {#if tab === "Rejected or Revoked Accounts & Applications"}
    {@const rejList = getAppsForTab("Rejected or Revoked Accounts & Applications")}
    <div class="sub-filter-bar" role="tablist" aria-label="Show">
      {#each [
        { key: "all", label: "All Records", count: rejList.length },
        { key: "rejected", label: "Rejected", count: rejList.filter((v: any) => (v.status || "").toLowerCase() === "rejected").length },
        { key: "revoked", label: "Revoked", count: rejList.filter((v: any) => (v.status || "").toLowerCase() === "revoked").length },
        { key: "blocked", label: "Blocked", count: rejList.filter((v: any) => v.active_block).length },
      ] as f (f.key)}
        <button
          type="button"
          role="tab"
          class="sub-filter-btn"
          class:active={rejectedFilter === f.key}
          aria-selected={rejectedFilter === f.key}
          onclick={() => (rejectedFilter = f.key as typeof rejectedFilter)}
        >
          {f.label} <span class="sub-filter-count">{f.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if tab === "Document Review" || tab === "Registered" || tab === "Registered Vehicles" || tab === "Revoked Registered" || tab === "Rejected or Revoked Accounts & Applications"}
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
        <select bind:value={roleFilter} class="filter-select">
          <option value="all">All Roles</option>
          <option value="student">Student</option>
          <option value="staff">Staff</option>
          <option value="faculty">Faculty</option>
          <option value="concessionnare">Concessionaire</option>
          <option value="supplier">Supplier</option>
          <option value="administrator">Administrator</option>
          <option value="vps">VPS</option>
        </select>
        <select bind:value={vehicleTypeFilter} class="filter-select">
          <option value="all">All Vehicles</option>
          <option value="2 wheelers">2 Wheelers</option>
          <option value="4 wheelers">4 Wheelers</option>
        </select>
        <select bind:value={selectedCampus} class="filter-select">
          <option value="all">All Campuses</option>
          <option value="Main campus">Main campus</option>
          <option value="rnp campus">rnp campus</option>
          <option value="Paseo">Paseo</option>
        </select>
      </div>
    </div>

    <div class="cards-list">
      {#if isRegisteredTab && displayedApps.length > 0}
        {@const printable = displayedApps.filter((a: any) => printSelectedIds.has(a.registration_id))}
        <div class="print-toolbar">
          <span class="print-count"><strong>{printable.length}</strong> of {displayedApps.length} selected</span>
          <div class="print-actions">
            <button type="button" class="print-link" onclick={() => (printSelectedIds = new Set(displayedApps.map((a: any) => a.registration_id)))}>Select all</button>
            {#if printable.length > 0}
              <button type="button" class="print-link" onclick={() => (printSelectedIds = new Set())}>Clear</button>
            {/if}
            <button
              type="button"
              class="print-btn"
              disabled={printable.length === 0}
              onclick={() => printRegisteredVehicles(
                printable.map((a: any) => ({
                  regNo: a.registration_id,
                  name: `${a.first_name || ""} ${a.last_name || ""}`.trim(),
                  role: a.role,
                  department: a.department_name,
                  campus: a.campus,
                  plate: a.vehicle_information?.plate_number,
                  vehicle: [a.vehicle_information?.brand, a.vehicle_information?.color].filter(Boolean).join(" · "),
                  type: a.vehicle_information?.type,
                  expires: a.expires_at,
                })),
                data.userEmail || "Safety and Security",
                "Safety and Security Office"
              )}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print Selected
            </button>
          </div>
        </div>
      {/if}
      {#each displayedApps as app}
        <ApplicationCard
          {tab}
          showDocs={true}
          selectable={isRegisteredTab}
          selected={printSelectedIds.has(app.registration_id)}
          onselect={(on) => togglePrintSelection(app.registration_id, on)}
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
            status: (tab === "Document Review" && app.status === "distributed") ? "" : app.status,
            crd: app.created_at,
            dpt: app.dept_val_at,
            osa: app.osa_val_at,
            sch: app.dist_sched,
            hdc: app.osa_dist_at,
            sec: app.security_checked_at,
            rel: app.sticker_released_at,
            exp: app.expires_at,
            rejection_reason: app.invalid_reason || null,
            is_change_vehicle: app.is_change_vehicle,
            qr_code: app.qr_code,
            qr_unique_code: app.qr_unique_code,
            blocked_until: app.active_block?.blocked_until ?? null,
            block_reason: app.active_block?.reason ?? null,
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
            {#if tab === "Rejected or Revoked Accounts & Applications" && !["rejected", "revoked"].includes((app.status || "").toLowerCase())}
              <p class="blocked-note">This vehicle is still registered. The gate block ends automatically on {new Date(app.active_block?.blocked_until).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>
            {:else}
            <ActionBar
              {tab}
              status={app.status}
              expiresAt={app.expires_at}
              onaction={async (action, schedule) => {
                if (action === "record_violation") {
                  violationTarget = {
                    id: app.registration_id,
                    name: `${app.first_name || ""} ${app.last_name || ""}`.trim(),
                    plate: app.vehicle_information?.plate_number || "",
                  };
                } else if (action === "revoke") {
                  await revokeQR(app.registration_id);
                } else if (action === "unrevoke") {
                  await unrevokeQR(app.registration_id);
                } else if (action === "delete") {
                  await deleteApp(app.registration_id);
                } else if (action === "security_check") {
                  const previousVehicles = vehicles;
                  vehicles = vehicles.map((v: any) =>
                    v.registration_id === app.registration_id
                      ? {
                          ...v,
                          security_check_at: new Date().toISOString(),
                          security_checked_at: new Date().toISOString(),
                          status: "security_checked"
                        }
                      : v,
                  );

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
                      invalidateAll();
                    } else {
                      vehicles = previousVehicles;
                      const errData = await res.json();
                      showAlert(errData.error || "Failed to perform action.");
                    }
                  } catch (e) {
                    vehicles = previousVehicles;
                    showAlert("Error performing action.");
                  }
                } else if (action === "security_reject") {
                  const previousVehicles = vehicles;
                  vehicles = vehicles.map((v: any) =>
                    v.registration_id === app.registration_id
                      ? {
                          ...v,
                          status: "rejected",
                          rejected_at: new Date().toISOString(),
                          rejection_reason: schedule
                        }
                      : v,
                  );

                  try {
                    const res = await fetch(`/api/monitor/actions`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        vehicle_id: app.registration_id,
                        action: "security_reject",
                        reason: schedule
                      }),
                    });
                    if (res.ok) {
                      invalidateAll();
                    } else {
                      vehicles = previousVehicles;
                      const errData = await res.json();
                      showAlert(errData.error || "Failed to reject application.");
                    }
                  } catch (e) {
                    vehicles = previousVehicles;
                    showAlert("Error rejecting application.");
                  }
                }
              }}
            />
            {/if}
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
          <div
            class="dropdown-wrap"
            use:clickOutside={() => (roleDropdownOpen = false)}
          >
            <button
              type="button"
              class="filter-select dropdown-btn"
              onclick={(e) => {
                e.stopPropagation();
                roleDropdownOpen = !roleDropdownOpen;
              }}
              aria-haspopup="listbox"
              aria-expanded={roleDropdownOpen}
            >
              <span>{getRoleDropdownLabel()}</span>
              <svg
                class="dropdown-arrow"
                class:rotated={roleDropdownOpen}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {#if roleDropdownOpen}
              <div class="dropdown-menu" role="listbox">
                <button
                  type="button"
                  class="dropdown-item"
                  class:selected={selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                  onclick={() => selectRole('all')}
                  role="option"
                  aria-selected={selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                >
                  <span>All Roles</span>
                  {#if selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                    <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  {/if}
                </button>
                {#each allRoles as role}
                  <button
                    type="button"
                    class="dropdown-item"
                    class:selected={selectedRoles.includes(role)}
                    onclick={() => selectRole(role)}
                    role="option"
                    aria-selected={selectedRoles.includes(role)}
                  >
                    <span>{formatRoleLabel(role)}</span>
                    {#if selectedRoles.includes(role)}
                      <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    {/if}
                  </button>
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
          <div class="table-total-badge" title="Total logs">
            <span class="total-badge-label">Total Logs:</span>
            <span class="total-badge-count">{totalLogs}</span>
          </div>
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
                <th>Plate Number</th>
                <th>Driver / Role</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Campus</th>
                <th>Status</th>
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
                    <span class="id-text">#{log.vehicle_log_id}</span>
                  </td>
                  <td>
                    <span class="plate-badge">{log.plate || log.vehicle_plate || 'No Plate'}</span>
                  </td>
                  <td>
                    <div class="driver-cell">
                      <span class="driver-name-text">{log.driver_name || log.name || 'Driver'}</span>
                      <span class="driver-role-chip">{log.role || 'Visitor'}</span>
                    </div>
                  </td>
                  <td class="td-time">
                    <span class="time-main"
                      >{log.check_in ? new Date(log.check_in).toLocaleString() : '—'}</span
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
                    <span class="campus-badge">{log.campus || 'Main Campus'}</span>
                  </td>
                  <td>
                    <span class="chip chip-status">{log.logged_status || (log.check_out ? 'Exited' : 'Inside')}</span>
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
              type="button"
              class="filter-select dropdown-btn"
              onclick={(e) => {
                e.stopPropagation();
                roleDropdownOpen = !roleDropdownOpen;
              }}
              aria-haspopup="listbox"
              aria-expanded={roleDropdownOpen}
            >
              <span>{getRoleDropdownLabel()}</span>
              <svg
                class="dropdown-arrow"
                class:rotated={roleDropdownOpen}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {#if roleDropdownOpen}
              <div class="dropdown-menu" role="listbox">
                <button
                  type="button"
                  class="dropdown-item"
                  class:selected={selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                  onclick={() => selectRole('all')}
                  role="option"
                  aria-selected={selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                >
                  <span>All Roles</span>
                  {#if selectedRoles.length === 0 || selectedRoles.length === allRoles.length}
                    <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  {/if}
                </button>
                {#each allRoles as role}
                  <button
                    type="button"
                    class="dropdown-item"
                    class:selected={selectedRoles.includes(role)}
                    onclick={() => selectRole(role)}
                    role="option"
                    aria-selected={selectedRoles.includes(role)}
                  >
                    <span>{formatRoleLabel(role)}</span>
                    {#if selectedRoles.includes(role)}
                      <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    {/if}
                  </button>
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
  {/if}

  {#if violationTarget}
    <ViolationModal
      registrationId={violationTarget.id}
      applicantName={violationTarget.name}
      plate={violationTarget.plate}
      onclose={() => (violationTarget = null)}
      onrecorded={() => invalidateAll()}
    />
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

  .table-total-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 0.85rem;
    background: #ffffff;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md, 8px);
    font-size: 0.8rem;
    color: var(--text-secondary);
    white-space: nowrap;
    margin-left: auto;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .total-badge-label {
    font-weight: 600;
  }

  .total-badge-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.45rem;
    background: var(--maroon);
    color: #ffffff;
    font-weight: 700;
    font-size: 0.78rem;
    border-radius: 999px;
  }

  @media (max-width: 768px) {
    .controls-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }
    .search-wrap {
      min-width: 0;
      width: 100%;
    }
    .filters {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .filter-select {
      flex: 1 1 calc(50% - 0.5rem);
      min-width: 120px;
    }
  }

  @media (max-width: 480px) {
    .filter-select {
      flex: 1 1 100%;
      width: 100%;
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
    display: inline-block;
  }
  .dropdown-btn {
    min-width: 130px;
    text-align: left;
    display: inline-flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .dropdown-arrow {
    transition: transform 0.2s ease;
    flex-shrink: 0;
    color: var(--text-secondary, #64748b);
  }
  .dropdown-arrow.rotated {
    transform: rotate(180deg);
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: #ffffff;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    padding: 0.35rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 175px;
    max-height: 290px;
    overflow-y: auto;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    padding: 0.45rem 0.65rem;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    text-align: left;
    transition: background 0.15s, color 0.15s;
    font-family: inherit;
    box-sizing: border-box;
  }
  .dropdown-item:hover {
    background: #fdf2f4;
    color: var(--maroon, #8B1A3C);
  }
  .dropdown-item.selected {
    background: rgba(139, 26, 60, 0.08);
    color: var(--maroon, #8B1A3C);
    font-weight: 700;
  }
  .check-icon {
    color: var(--maroon, #8B1A3C);
    margin-left: 0.5rem;
    flex-shrink: 0;
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

  /* Rejected, Revoked & Blocked sub-filter */
  .sub-filter-bar {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0.75rem 0 1rem;
  }

  .sub-filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 38px;
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    border: 1px solid #E8D5DA;
    background: #ffffff;
    color: #5C3A42;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }

  .sub-filter-btn.active {
    background: #8B1A3C;
    border-color: #8B1A3C;
    color: #ffffff;
  }

  .sub-filter-count {
    font-size: 0.72rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.08);
  }

  .sub-filter-btn.active .sub-filter-count {
    background: rgba(255, 255, 255, 0.25);
  }

  .blocked-note {
    margin: 0;
    font-size: 0.85rem;
    color: #991b1b;
  }

  /* Registered Vehicles print toolbar */
  .print-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.85rem;
    background: #ffffff;
    border: 1px solid #E8D5DA;
    border-radius: 12px;
  }

  .print-count {
    font-size: 0.85rem;
    color: #5C3A42;
  }

  .print-count strong {
    color: #8B1A3C;
  }

  .print-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .print-link {
    background: none;
    border: none;
    padding: 0.35rem 0.4rem;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    color: #8B1A3C;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .print-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 40px;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 10px;
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #E9C25E;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
  }

  .print-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 480px) {
    .print-toolbar { flex-direction: column; align-items: stretch; }
    .print-actions { justify-content: space-between; }
    .print-btn { flex: 1; justify-content: center; }
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

  .driver-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .driver-name-text {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text);
  }
  .driver-role-chip {
    display: inline-block;
    align-self: flex-start;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 9999px;
    background: rgba(139, 26, 60, 0.08);
    color: var(--maroon);
    border: 1px solid rgba(139, 26, 60, 0.2);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .plate-badge {
    display: inline-block;
    padding: 3px 8px;
    background: #f1f5f9;
    border-radius: 6px;
    font-family: monospace;
    font-weight: 700;
    font-size: 0.82rem;
    color: #1e293b;
    border: 1px solid #cbd5e1;
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

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }
    .header-left {
      width: 100%;
      justify-content: space-between;
    }
    .search-box {
      width: 100%;
    }
    .install-action-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }
    .btn-install {
      width: 100%;
    }
    .paginator {
      flex-wrap: wrap;
    }
    .card-photo-img {
      max-width: 95vw;
      max-height: 80vh;
    }
  }

  @media (max-width: 480px) {
    .empty-state-install {
      padding: 2.5rem 1rem;
    }
    .table-total-badge {
      width: 100%;
      justify-content: space-between;
      margin-left: 0;
    }
    .paginator {
      gap: 0.35rem;
    }
  }
</style>

