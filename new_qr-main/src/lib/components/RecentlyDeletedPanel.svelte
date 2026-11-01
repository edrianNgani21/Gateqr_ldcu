<script lang="ts">
  import { startLiveSync } from '$lib/utils/liveSync';
  import { askConfirm, showAlert } from '$lib/utils/dialog';
  import { printRecentlyDeleted } from '$lib/utils/printRecords';

  let { userEmail = '' }: { userEmail?: string } = $props();

  interface Duplicate {
    registration_id: number;
    status: string;
    name: string;
    plate: string;
    matched: string[];
  }
  interface DeletedItem {
    registration_id: number;
    name: string;
    email: string | null;
    role: string | null;
    school_id: string | null;
    plate: string | null;
    vehicle: string | null;
    vehicle_type: string | null;
    previous_status: string;
    reason: string;
    deleted_by_role: string;
    deleted_by_email: string | null;
    deleted_at: string;
    duplicates: Duplicate[];
  }

  let items = $state<DeletedItem[]>([]);
  let canManage = $state(false);
  let primaryEmail = $state('');
  let loading = $state(true);
  let loadError = $state('');
  let busyId = $state<number | null>(null);
  let decisionFor = $state<number | null>(null);
  let search = $state('');

  let filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [String(i.registration_id), i.name, i.email, i.plate, i.reason, i.deleted_by_role]
        .some((v) => (v || '').toLowerCase().includes(q))
    );
  });

  async function load() {
    try {
      const res = await fetch('/api/osa/recycle-bin');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load Recently Deleted.');
      items = body.items || [];
      canManage = !!body.canManage;
      primaryEmail = body.primaryEmail || '';
      loadError = '';
    } catch (e: any) {
      loadError = e?.message || 'Could not load Recently Deleted.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    load();
    return startLiveSync({
      channelName: 'osa-recycle-bin-realtime',
      tables: ['recycle_bin', 'registration'],
      invalidate: false,
      onSync: load
    });
  });

  async function act(item: DeletedItem, action: 'restore' | 'purge', mode: 'restore' | 'replace_new' = 'restore') {
    busyId = item.registration_id;
    try {
      const res = await fetch('/api/osa/recycle-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, registration_id: item.registration_id, mode })
      });
      const body = await res.json();
      if (res.status === 409 && body.conflict) {
        // Another application with the same details exists: ask what to do
        items = items.map((i) => (i.registration_id === item.registration_id ? { ...i, duplicates: body.duplicates } : i));
        decisionFor = item.registration_id;
        return;
      }
      if (!res.ok) throw new Error(body.error || 'The action failed.');
      decisionFor = null;
      await load();
      showAlert(body.message, { tone: 'success', title: action === 'purge' ? 'Permanently deleted' : 'Restored' });
    } catch (e: any) {
      showAlert(e?.message || 'The action failed. Please try again.');
    } finally {
      busyId = null;
    }
  }

  function restore(item: DeletedItem) {
    if (item.duplicates.length) {
      decisionFor = decisionFor === item.registration_id ? null : item.registration_id;
      return;
    }
    act(item, 'restore');
  }

  async function replaceNew(item: DeletedItem) {
    const nums = item.duplicates.map((d) => `Reg. No. ${d.registration_id}`).join(', ');
    if (!await askConfirm(`Restore Reg. No. ${item.registration_id} and move the newer application (${nums}) to Recently Deleted?`, { title: 'Replace the new application', confirmLabel: 'Yes, replace it' })) return;
    act(item, 'restore', 'replace_new');
  }

  async function purge(item: DeletedItem, keepingNew = false) {
    const message = keepingNew
      ? `Keep the newer application and permanently delete Reg. No. ${item.registration_id}? This cannot be undone. Its gate history is kept.`
      : `Permanently delete Reg. No. ${item.registration_id} (${item.name})? Its uploaded documents and QR are removed for good; gate history is kept. This cannot be undone.`;
    if (!await askConfirm(message, { title: 'Delete permanently', confirmLabel: 'Delete permanently' })) return;
    act(item, 'purge');
  }

  function printList() {
    printRecentlyDeleted(
      filtered.map((i) => ({
        regNo: i.registration_id,
        name: i.name,
        email: i.email,
        role: i.role,
        plate: i.plate,
        vehicle: i.vehicle,
        previousStatus: i.previous_status,
        deletedByRole: i.deleted_by_role,
        deletedByEmail: i.deleted_by_email,
        deletedAt: i.deleted_at,
        reason: i.reason
      })),
      userEmail || 'OSA Administrator'
    );
  }

  function fmt(d: string) {
    return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function label(s: string | null) {
    return (s || '-').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
</script>

<section class="rd-card" aria-labelledby="rd-title">
  <header class="rd-header">
    <div class="rd-title-wrap">
      <span class="rd-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </span>
      <div>
        <h2 id="rd-title">Recently Deleted</h2>
        <p>Registered vehicles deleted by Security or OSA. Deleted QR codes are denied at the gate.</p>
      </div>
    </div>
    <div class="rd-tools">
      <span class="rd-count">{items.length} record{items.length === 1 ? '' : 's'}</span>
      <button type="button" class="rd-print" onclick={printList} disabled={filtered.length === 0}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print
      </button>
    </div>
  </header>

  {#if !canManage && !loading && !loadError}
    <p class="rd-viewonly">View only: restoring or permanently deleting is limited to the primary OSA administrator ({primaryEmail}).</p>
  {/if}

  {#if items.length > 0}
    <input class="rd-search" type="search" placeholder="Search name, Reg. No., plate, reason" bind:value={search} aria-label="Search recently deleted" />
  {/if}

  {#if loading}
    <p class="rd-empty">Loading recently deleted records...</p>
  {:else if loadError}
    <p class="rd-error">{loadError}</p>
  {:else if items.length === 0}
    <p class="rd-empty">Nothing here. Deleted registered vehicles will appear in this list.</p>
  {:else if filtered.length === 0}
    <p class="rd-empty">No deleted records match "{search}".</p>
  {:else}
    <ul class="rd-list">
      {#each filtered as item (item.registration_id)}
        <li class="rd-item">
          <div class="rd-item-top">
            <span class="rd-reg">Reg. No. {item.registration_id}</span>
            <strong class="rd-name">{item.name}</strong>
            <span class="rd-status">Was: {label(item.previous_status)}</span>
          </div>

          <dl class="rd-grid">
            <div><dt>Email</dt><dd>{item.email || '-'}</dd></div>
            <div><dt>Role</dt><dd>{label(item.role)}</dd></div>
            <div><dt>Plate / Vehicle</dt><dd><span class="rd-plate">{item.plate || '-'}</span> {item.vehicle || ''}</dd></div>
            <div><dt>Deleted by</dt><dd>{item.deleted_by_role}{#if item.deleted_by_email}<span class="rd-sub">{item.deleted_by_email}</span>{/if}</dd></div>
            <div><dt>Deleted on</dt><dd>{fmt(item.deleted_at)}</dd></div>
            <div class="rd-wide"><dt>Reason</dt><dd>{item.reason}</dd></div>
          </dl>

          {#if item.duplicates.length > 0}
            <div class="rd-warn" role="note">
              <strong>This applicant already submitted another application with the same details.</strong>
              {#each item.duplicates as d (d.registration_id)}
                <span class="rd-dup">Reg. No. {d.registration_id} · {d.name || 'Applicant'} · {d.plate} · {label(d.status)} ({d.matched.join(', ')})</span>
              {/each}
            </div>
          {/if}

          {#if canManage}
            {#if decisionFor === item.registration_id && item.duplicates.length > 0}
              <div class="rd-decision">
                <p>Which application should stay active?</p>
                <div class="rd-actions">
                  <button type="button" class="rd-btn rd-restore" disabled={busyId === item.registration_id} onclick={() => replaceNew(item)}>
                    Replace the new one with this record
                  </button>
                  <button type="button" class="rd-btn rd-danger" disabled={busyId === item.registration_id} onclick={() => purge(item, true)}>
                    Keep the new one, delete this record
                  </button>
                  <button type="button" class="rd-btn rd-ghost" onclick={() => (decisionFor = null)}>Cancel</button>
                </div>
              </div>
            {:else}
              <div class="rd-actions">
                <button type="button" class="rd-btn rd-restore" disabled={busyId === item.registration_id} onclick={() => restore(item)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  {busyId === item.registration_id ? 'Working...' : 'Restore'}
                </button>
                <button type="button" class="rd-btn rd-danger" disabled={busyId === item.registration_id} onclick={() => purge(item)}>
                  Delete permanently
                </button>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .rd-card {
    background: #ffffff;
    border: 1px solid rgba(226, 232, 240, 0.9);
    border-radius: 18px;
    padding: 1.4rem 1.5rem;
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .rd-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1rem;
  }
  .rd-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }
  .rd-icon {
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fef2f2;
    color: #b91c1c;
  }
  .rd-title-wrap h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: #1e293b;
  }
  .rd-title-wrap p {
    margin: 0.15rem 0 0;
    font-size: 0.82rem;
    color: #64748b;
  }
  .rd-tools {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .rd-count {
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .rd-print {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    border: 1.5px solid #8b1a3c;
    background: #ffffff;
    color: #8b1a3c;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }
  .rd-print:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .rd-viewonly {
    margin: 0;
    padding: 0.65rem 0.85rem;
    border-radius: 10px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
    font-size: 0.82rem;
  }
  .rd-search {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem 0.85rem;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.88rem;
  }
  .rd-empty,
  .rd-error {
    margin: 0;
    padding: 1.25rem;
    text-align: center;
    font-size: 0.88rem;
    color: #64748b;
  }
  .rd-error {
    color: #b91c1c;
  }
  .rd-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .rd-item {
    border: 1px solid #ecdfe3;
    border-left: 4px solid #b91c1c;
    border-radius: 12px;
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .rd-item-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.65rem;
  }
  .rd-reg {
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
    background: #fdf2f4;
    color: #8b1a3c;
    font-size: 0.78rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .rd-name {
    font-size: 0.98rem;
    color: #1e293b;
  }
  .rd-status {
    margin-left: auto;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .rd-grid {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.55rem 1rem;
  }
  .rd-grid div {
    min-width: 0;
  }
  .rd-wide {
    grid-column: 1 / -1;
  }
  .rd-grid dt {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .rd-grid dd {
    margin: 0.15rem 0 0;
    font-size: 0.86rem;
    color: #1e293b;
    overflow-wrap: anywhere;
  }
  .rd-sub {
    display: block;
    font-size: 0.76rem;
    color: #64748b;
  }
  .rd-plate {
    font-family: monospace;
    font-weight: 700;
  }
  .rd-warn {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.7rem 0.85rem;
    border-radius: 10px;
    background: #fffbeb;
    border: 1px solid #fcd34d;
    color: #92400e;
    font-size: 0.82rem;
  }
  .rd-dup {
    font-size: 0.8rem;
  }
  .rd-decision p {
    margin: 0 0 0.5rem;
    font-size: 0.86rem;
    font-weight: 700;
    color: #1e293b;
  }
  .rd-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .rd-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 40px;
    padding: 0.5rem 0.95rem;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    border: 1.5px solid transparent;
  }
  .rd-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .rd-restore {
    background: #16a34a;
    color: #ffffff;
  }
  .rd-danger {
    background: #ffffff;
    color: #b91c1c;
    border-color: #fca5a5;
  }
  .rd-ghost {
    background: #ffffff;
    color: #475569;
    border-color: #e2e8f0;
  }
  @media (max-width: 600px) {
    .rd-card {
      padding: 1.1rem 1rem;
    }
    .rd-status {
      margin-left: 0;
    }
    .rd-btn {
      flex: 1 1 100%;
      justify-content: center;
    }
  }
</style>
