<script lang="ts">
  import StatusBadge from "./StatusBadge.svelte";
  import DocumentGrid from "./DocumentGrid.svelte";

  let {
    tab = "validation",
    showQR = false,
    showDocs = true,
    data = {},
    children,
    selectable = false,
    selected = false,
    onselect,
    startExpanded = false,
  }: {
    tab?: string;
    showQR?: boolean;
    showDocs?: boolean;
    data?: Record<string, any>;
    children?: any;
    selectable?: boolean;
    selected?: boolean;
    onselect?: (selected: boolean) => void;
    startExpanded?: boolean;
  } = $props();

  let expanded = $state(startExpanded);
  let effectiveShowQR = $derived(showQR);

  let showDocPopup = $state<string | null>(null);

  let defaults = $derived(data as Record<string, any>);

  let role = $derived(data.role?.toLowerCase() ?? "student");
  let ownerVal = $derived(data.owner?.toLowerCase() === "yes" ? "yes" : "no");
  let rejectionReason = $derived(data.rejection_reason ?? null);
  let appStatus = $derived(data.status ?? null);
  let reasonLabel = $derived(
    appStatus === "revoked" ? "Revoked:" : "Rejected:",
  );

  function formatDate(d: string | null | undefined): string | null {
    if (!d || d === '-' || d === 'N/A') return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  }

  let statusLabel = $derived(
    appStatus?.replace(/_/g, " ")?.toUpperCase() || "UNKNOWN",
  );
  let statusVariant = $derived<'default' | 'success' | 'warning' | 'danger'>(
    appStatus && ["approved", "completed", "Sticker_Installed", "sticker_installed", "Sticker_Released", "sticker_released", "security_checked", "osa_validated", "dept_validated", "distributed", "osa_val", "dept_val"].includes(appStatus)
      ? "success"
      : appStatus && ["rejected", "revoked", "expired"].includes(appStatus)
        ? "danger"
        : "warning",
  );

  // Status pill color
  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    success: { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
    danger:  { bg: "#fef2f2", text: "#b91c1c", border: "#fca5a5" },
    warning: { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
    default: { bg: "var(--surface)", text: "var(--text-secondary)", border: "var(--border)" },
  };
  let pill = $derived(statusColors[statusVariant] ?? statusColors.default);

  // Role badge colors
  const roleColors: Record<string, string> = {
    student: "#3b82f6",
    employee: "#8b5cf6",
    visitor: "#f59e0b",
    concessionaire: "#10b981",
    guest: "#6b7280",
  };
  let roleColor = $derived(roleColors[role] ?? "#6b7280");

  const excludedKeys = ["documents", "owner", "rejection_reason", "status", "crd", "dpt", "osa", "sch", "hdc", "sec", "rel", "ins", "exp", "qr_code", "qr_unique_code", "change_vehicle_request", "is_change_vehicle", "receipt"];

  function getQRImageUrl(qr: string | null | undefined = null, uniqueCode: string | null = null): string {
    const rawCode = (uniqueCode && uniqueCode.trim()) || (qr && typeof qr === 'string' && !qr.trim().startsWith('http') ? qr.trim() : null);
    if (rawCode) {
      return `/api/qr?code=${encodeURIComponent(rawCode)}&role=${encodeURIComponent(role)}`;
    }
    if (qr && typeof qr === 'string') {
      const trimmed = qr.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
        return trimmed;
      }
      return `/api/qr?code=${encodeURIComponent(trimmed)}&role=${encodeURIComponent(role)}`;
    }
    return `/api/qr?code=PENDING&role=${encodeURIComponent(role)}`;
  }

  function isPdf(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    return url.toLowerCase().includes('.pdf');
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="app-card" class:expanded class:selected class:selectable>

  <!-- ── Compact Summary Row (always visible) ── -->
  <div
    class="card-summary"
    onclick={(e) => {
      if ((e.target as HTMLElement).closest('.checkbox-wrap')) return;
      expanded = !expanded;
    }}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') expanded = !expanded; }}
    aria-expanded={expanded}
  >
    {#if selectable}
      <div class="checkbox-wrap" onclick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          class="sel-checkbox"
          checked={selected}
          onchange={(e) => onselect?.((e.target as HTMLInputElement).checked)}
        />
      </div>
    {/if}

    <!-- Avatar -->
    <div class="avatar" style="background: {roleColor}22; color: {roleColor}; border-color: {roleColor}44;">
      {(data.name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
    </div>

    <!-- Name + meta -->
    <div class="summary-main">
      <span class="summary-name">{data.name || '—'}</span>
      <div class="summary-meta">
        {#if (data.department || data.Department) && (data.department || data.Department) !== '-'}
          <span class="meta-chip">{data.department || data.Department}</span>
        {/if}
        {#if data.campus}
          <span class="meta-chip campus-chip">{data.campus}</span>
        {/if}
      </div>
    </div>

    <!-- Right pills -->
    <div class="summary-right">
      {#if data.change_vehicle_request || data.is_change_vehicle}
        <span class="change-veh-pill" title="This application is under the request to change registration details">
          Under Request to Change Registration Details
        </span>
      {/if}

      <!-- Distinct Rejected or Revoked indicator requested by user -->
      {#if appStatus === 'rejected'}
        <span class="indicator-pill indicator-rejected" title="Application is Rejected">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          REJECTED
        </span>
      {:else if appStatus === 'revoked'}
        <span class="indicator-pill indicator-revoked" title="Application/Vehicle is Revoked">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          REVOKED
        </span>
      {/if}

      {#if rejectionReason === 'OVERDUE' || (data.sch && (!data.hdc || data.hdc === '-') && new Date(data.sch) < new Date())}
        <span class="indicator-pill indicator-overdue" title="Passed scheduled visit date">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          OVERDUE SCHEDULE
        </span>
      {:else if rejectionReason === 'RESCHEDULED'}
        <span class="status-pill" style="background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe;">RESCHEDULED</span>
      {/if}

      <span class="role-badge" style="background: {roleColor}18; color: {roleColor}; border-color: {roleColor}33;">
        {role}
      </span>
      {#if data.plate}
        <span class="plate-chip">{data.plate}</span>
      {/if}
      {#if appStatus && appStatus !== '' && appStatus !== 'rejected' && appStatus !== 'revoked' && !(tab === 'Document Review' && (appStatus === 'distributed' || statusLabel === 'DISTRIBUTED'))}
        <span class="status-pill" style="background: {pill.bg}; color: {pill.text}; border-color: {pill.border};">
          {statusLabel}
        </span>
      {/if}
      <svg class="chevron" class:open={expanded} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
  </div>

  <!-- ── Expandable Detail Panel ── -->
  {#if expanded}
    <div class="card-detail">
      <div class="detail-inner">

        {#if appStatus === 'rejected'}
          <div class="app-alert-banner alert-rejected-banner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <div>
              <strong>Rejected Application:</strong> This vehicle registration application was rejected.
              {#if rejectionReason}
                <div class="alert-reason-text"><strong>Reason:</strong> {rejectionReason}</div>
              {/if}
            </div>
          </div>
        {:else if appStatus === 'revoked'}
          <div class="app-alert-banner alert-revoked-banner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div>
              <strong>Revoked Account / Application:</strong> Vehicle sticker privileges have been revoked.
              {#if rejectionReason}
                <div class="alert-reason-text"><strong>Revocation Reason:</strong> {rejectionReason}</div>
              {/if}
            </div>
          </div>
        {/if}

        {#if (rejectionReason === 'OVERDUE' || (data.sch && (!data.hdc || data.hdc === '-') && new Date(data.sch) < new Date())) && appStatus !== 'rejected' && appStatus !== 'revoked'}
          <div class="app-alert-banner alert-overdue-banner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
              <strong>Missed Submission Schedule:</strong> Scheduled visit date was {data.sch ? new Date(data.sch).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'in the past'}. Click <em>Verify Hardcopy</em> to proceed if applicant has appeared, or <em>Reschedule</em> to set a new date.
            </div>
          </div>
        {/if}

        {#if data.change_vehicle_request || data.is_change_vehicle}
          <div class="change-vehicle-banner">
            <div class="cvb-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
              <strong>This application is undergo request to change registration details process</strong>
            </div>
            {#if data.change_vehicle_request?.reason}
              <div class="cvb-reason">
                <strong>Applicant's Reason:</strong> "{data.change_vehicle_request.reason}"
              </div>
            {/if}
            {#if data.change_vehicle_request?.new_vehicle_plate}
              <div class="cvb-details">
                <strong>Requested New Vehicle:</strong> {data.change_vehicle_request.new_vehicle_make || ''} ({data.change_vehicle_request.new_vehicle_plate})
              </div>
            {/if}
          </div>
        {/if}

        <!-- Info grid -->
        <div class="info-grid">
          {#each Object.entries(defaults) as [key, val]}
            {#if val !== undefined && val !== null && val !== '-' && !excludedKeys.includes(key)}
              <div class="info-item">
                <span class="info-label">{key}</span>
                <span class="info-value">{val}</span>
              </div>
            {/if}
          {/each}
          {#if rejectionReason && rejectionReason !== 'OVERDUE' && rejectionReason !== 'RESCHEDULED'}
            <div class="info-item info-item-full reason-item">
              <span class="info-label reason-label">{reasonLabel}</span>
              <span class="info-value reason-value">{rejectionReason}</span>
            </div>
          {/if}
        </div>

        <!-- Receipt (uploaded by applicant) -->
        {#if data.receipt}
          <div class="detail-section">
            <span class="section-label">Receipt</span>
            <button
              type="button"
              class="qr-preview-trigger"
              onclick={() => (showDocPopup = data.receipt)}
              title="Click to view receipt"
            >
              {#if isPdf(data.receipt)}
                <span>View receipt (PDF)</span>
              {:else}
                <img src={data.receipt} alt="Payment receipt" width="96" height="96" class="qr-img" style="object-fit: cover;" />
              {/if}
            </button>
          </div>
        {/if}

        <!-- Documents -->
        {#if showDocs}
          <div class="detail-section" class:no-border={tab.toLowerCase() === 'revoked'}>
            <span class="section-label">Documents</span>
            <DocumentGrid
              {role}
              owner={ownerVal}
              documents={defaults.documents || {}}
              onopen={(url) => (showDocPopup = url)}
            />
          </div>
        {/if}

        <!-- QR Code -->
        {#if effectiveShowQR}
          {@const qrImgUrl = getQRImageUrl(data.qr_code, data.qr_unique_code)}
          <div class="detail-section" class:no-border={tab.toLowerCase() === 'revoked'}>
            <span class="section-label">QR Code</span>
            <div class="qr-body">
              <button
                type="button"
                class="qr-preview-trigger"
                onclick={() => (showDocPopup = qrImgUrl)}
                title="Click to view full size QR code"
              >
                <img src={qrImgUrl} alt="Vehicle QR Code" width="96" height="96" class="qr-img" />
              </button>
              <div class="qr-meta">
                <span class="qr-code-text">Code: {data.qr_unique_code || (data.qr_code && !data.qr_code.startsWith('http') ? data.qr_code : 'PENDING')}</span>
                <a href={qrImgUrl} download={`gateqr-${data.qr_unique_code || data.id || 'code'}.png`} class="qr-download-btn">Download QR</a>
              </div>
            </div>
          </div>
        {/if}

        <!-- Action Bar -->
        {#if children}
          <div class="detail-section action-section" class:no-border={tab.toLowerCase() === 'revoked'}>
            {@render children()}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if showDocPopup}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="doc-modal-overlay" onclick={() => (showDocPopup = null)} role="dialog" aria-modal="true" tabindex="-1">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="doc-modal-content" onclick={(e) => e.stopPropagation()}>
      <button class="close-modal" aria-label="Close document viewer" onclick={() => (showDocPopup = null)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
      <div class="doc-image-wrap">
        {#if isPdf(showDocPopup)}
          <iframe src={showDocPopup} title="Document Preview" class="doc-preview-frame"></iframe>
          <div class="doc-pdf-fallback" style="padding-top: 0.5rem; text-align: center;">
            <a href={showDocPopup} target="_blank" rel="noopener noreferrer" class="doc-open-link">
              Open original PDF in new tab ↗
            </a>
          </div>
        {:else}
          <img src={showDocPopup} alt="Document Preview" class="doc-preview-img" onerror={(e) => {
            (e.currentTarget as HTMLImageElement).src = '/liceo-logo.png';
          }} />
          <a href={showDocPopup} target="_blank" rel="noopener noreferrer" class="doc-open-link">
            Open original document in new tab ↗
          </a>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ─── Card Shell ─────────────────────────────────────────────────────── */
  .app-card {
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md, 10px);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.18s, box-shadow 0.18s;
  }
  .app-card.selected {
    border-color: var(--maroon);
    box-shadow: 0 0 0 2px rgba(107,26,42,0.12), var(--shadow-sm);
  }
  .app-card.expanded {
    border-color: var(--maroon, #6b1a2a);
    box-shadow: 0 4px 16px rgba(0,0,0,0.10);
  }

  /* ─── Summary Row ─────────────────────────────────────────────────────── */
  .card-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    cursor: pointer;
    user-select: none;
    min-height: 54px;
    transition: background 0.15s;
    flex-wrap: wrap;
  }
  .card-summary:hover {
    background: var(--maroon-muted, rgba(107,26,42,0.04));
  }
  .app-card.expanded .card-summary {
    border-bottom: 1.5px solid var(--border-light, #f0e8ea);
    background: var(--maroon-muted, rgba(107,26,42,0.04));
  }

  @media (max-width: 768px) {
    .card-summary {
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .summary-right {
      width: 100%;
      justify-content: flex-start;
      border-top: 1px solid var(--border-light, #f0e8ea);
      padding-top: 0.5rem;
      margin-top: 0.15rem;
      flex-shrink: 1;
    }
  }

  @media (max-width: 480px) {
    .card-summary {
      padding: 0.65rem 0.75rem;
    }
    .avatar {
      width: 32px;
      height: 32px;
      font-size: 0.68rem;
    }
    .summary-name {
      font-size: 0.825rem;
    }
    .info-grid {
      grid-template-columns: 1fr;
    }
    .qr-body {
      flex-direction: column;
      align-items: flex-start;
    }
    .qr-img {
      width: 130px;
      height: 130px;
    }
    .doc-preview-frame {
      width: 90vw;
      height: 65vh;
    }
    .doc-modal-content {
      padding: 1rem;
      max-width: 96vw;
    }
  }

  /* ─── Checkbox ───────────────────────────────────────────────────────── */
  .checkbox-wrap { flex-shrink: 0; }
  .sel-checkbox {
    width: 17px;
    height: 17px;
    cursor: pointer;
    accent-color: var(--maroon);
  }

  /* ─── Avatar ─────────────────────────────────────────────────────────── */
  .avatar {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1.5px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  /* ─── Name / meta ────────────────────────────────────────────────────── */
  .summary-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .summary-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .summary-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .meta-chip {
    font-size: 0.68rem;
    color: var(--text-secondary);
    background: var(--border-light, #f0f0f0);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-weight: 500;
  }
  .campus-chip {
    background: rgba(107,26,42,0.08);
    color: var(--maroon, #6b1a2a);
  }

  /* ─── Right Pills ────────────────────────────────────────────────────── */
  .summary-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .role-badge {
    font-size: 0.67rem;
    font-weight: 600;
    padding: 0.18rem 0.5rem;
    border-radius: 99px;
    border: 1px solid;
    text-transform: capitalize;
    letter-spacing: 0.02em;
  }
  .plate-chip {
    font-size: 0.72rem;
    font-weight: 700;
    font-family: monospace;
    color: var(--text-primary);
    background: var(--border-light, #f4f4f4);
    border: 1px solid var(--border);
    padding: 0.18rem 0.55rem;
    border-radius: 5px;
    letter-spacing: 0.06em;
  }
  .status-pill {
    font-size: 0.67rem;
    font-weight: 700;
    padding: 0.18rem 0.55rem;
    border-radius: 99px;
    border: 1px solid;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .indicator-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.22rem 0.65rem;
    border-radius: 99px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .indicator-rejected {
    background: #fef2f2;
    color: #dc2626;
    border: 1.5px solid #f87171;
  }
  .indicator-revoked {
    background: #fff1f2;
    color: #9f1239;
    border: 1.5px solid #fda4af;
  }
  .indicator-overdue {
    background: #fffbeb;
    color: #b45309;
    border: 1.5px solid #fcd34d;
    animation: overdue-glow 2s infinite ease-in-out;
  }
  @keyframes overdue-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
    50% { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15); }
  }

  .app-alert-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .app-alert-banner svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
  .alert-rejected-banner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }
  .alert-revoked-banner {
    background: #fff1f2;
    border: 1px solid #fecdd3;
    color: #881337;
  }
  .alert-overdue-banner {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
  }
  .alert-reason-text {
    margin-top: 4px;
    font-size: 0.8rem;
    color: inherit;
    opacity: 0.95;
  }

  /* ─── Chevron ────────────────────────────────────────────────────────── */
  .chevron {
    color: var(--text-secondary);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
    margin-left: 0.15rem;
  }
  .chevron.open {
    transform: rotate(180deg);
    color: var(--maroon);
  }

  /* ─── Detail Panel ───────────────────────────────────────────────────── */
  .card-detail {
    animation: slideDown 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .detail-inner {
    padding: 1rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  /* ─── Info Grid ──────────────────────────────────────────────────────── */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.4rem 1rem;
  }
  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .info-item-full { grid-column: 1 / -1; }
  .info-label {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .info-value {
    font-size: 0.8rem;
    color: var(--text-primary);
    font-weight: 500;
    word-break: break-word;
  }
  .reason-item {
    padding: 0.5rem 0.625rem;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
  }
  .reason-label { color: #b91c1c; }
  .reason-value { color: #b91c1c; }

  /* ─── Timeline Badges ────────────────────────────────────────────────── */
  .timeline-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  /* ─── Section divider ────────────────────────────────────────────────── */
  .detail-section {
    border-top: 1px solid var(--border-light, #f0e8ea);
    padding-top: 0.75rem;
  }
  .detail-section.no-border {
    border-top: none;
  }
  .section-label {
    display: block;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-secondary);
    margin-bottom: 0.45rem;
  }

  /* ─── QR ─────────────────────────────────────────────────────────────── */
  .qr-body {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .qr-preview-trigger {
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: flex;
    border-radius: 8px;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .qr-preview-trigger:hover {
    transform: scale(1.04);
  }
  .qr-img {
    border-radius: 8px;
    border: 1.5px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    background: #fff;
    display: block;
  }
  .qr-meta {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .qr-code-text {
    font-family: monospace;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--maroon);
    background: #f8fafc;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
    width: fit-content;
  }
  .qr-download-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--maroon);
    text-decoration: none;
    padding: 0.35rem 0.75rem;
    background: white;
    border: 1.5px solid var(--maroon);
    border-radius: 6px;
    transition: all 0.2s ease;
    width: fit-content;
  }
  .qr-download-btn:hover {
    background: var(--maroon);
    color: white;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(128, 0, 32, 0.25);
  }

  /* ─── Document Modal ─────────────────────────────────────────────────── */
  .doc-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .doc-modal-content {
    background: var(--surface);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    position: relative;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    max-width: 92vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    animation: slideUp 0.2s ease;
  }
  @keyframes slideUp {
    from { transform: translateY(16px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  .close-modal {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: var(--maroon-muted);
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
  }
  .close-modal:hover {
    background: var(--maroon);
    color: #fff;
    border-color: var(--maroon);
  }
  .doc-image-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .doc-preview-img {
    max-width: 90vw;
    max-height: 75vh;
    object-fit: contain;
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .doc-preview-frame {
    width: 80vw;
    height: 75vh;
    border: none;
    border-radius: var(--radius-sm);
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .doc-open-link {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--maroon);
    text-decoration: underline;
    margin-top: 0.25rem;
    transition: color 0.15s;
  }
  .change-veh-pill {
    padding: 0.2rem 0.55rem;
    border-radius: 9999px;
    font-size: 0.675rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
    display: inline-flex;
    align-items: center;
  }

  .change-vehicle-banner {
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.12), rgba(128, 0, 0, 0.06));
    border: 1.5px solid #d4af37;
    border-radius: 8px;
    padding: 0.875rem 1rem;
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .cvb-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--maroon, #800000);
    font-weight: 700;
  }

  .cvb-reason {
    font-size: 0.85rem;
    color: #78350f;
    font-style: italic;
    padding-left: 1.6rem;
  }

  .cvb-details {
    font-size: 0.825rem;
    color: #111827;
    padding-left: 1.6rem;
  }
</style>

