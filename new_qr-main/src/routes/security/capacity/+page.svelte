<script lang="ts">
  import { showAlert, askConfirm } from '$lib/utils/dialog';
  import AppShell from '$lib/components/AppShell.svelte';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';

  import { startLiveSync } from '$lib/utils/liveSync';

  let { data } = $props();
  let userRole = $derived(data.userRole || 'security');

  let campuses = $state(data.campuses);
  let loadingCampus = $state<string | null>(null);
  let editingCampus = $state<string | null>(null);

  // One wide card; the segmented buttons pick which campus it shows
  let selectedName = $state<string>((data.campuses?.[0]?.name as string) || 'Main Campus');
  let campus = $derived((campuses as any[]).find((c: any) => c.name === selectedName) ?? (campuses as any[])[0]);

  const campusLabels: Record<string, string> = { 'Main Campus': 'Main', 'RNP': 'RNP', 'PASEO': 'Paseo' };

  // Sync state when data changes via invalidateAll
  $effect(() => {
    // Only update if we are not currently editing to avoid overriding user input
    if (!editingCampus && data.campuses) {
      untrack(() => {
        campuses = data.campuses;
      });
    }
  });

  // Standard live sync with WebSocket push and unmount cleanup
  $effect(() => {
    return startLiveSync({
      channelName: 'security-capacity-realtime',
      tables: ['parking_capacity', 'campus_event', 'vehicle_log'],
      invalidate: false,
      onSync: () => {
        if (!editingCampus) {
          invalidateAll();
        }
      }
    });
  });

  function toLocalDatetimeString(dateInput: string | Date | null | undefined): string {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Auto-expire events in UI when end date has passed without triggering recursive network loops
  $effect(() => {
    const checkExpiredEvents = () => {
      const now = Date.now();
      let hasExpired = false;

      const currentCampuses = untrack(() => campuses);
      if (!currentCampuses) return;

      const updated = (currentCampuses as any[]).map((c: any) => {
        if (c.event_name && c.event_end) {
          const endTime = new Date(c.event_end).getTime();
          if (!isNaN(endTime) && endTime <= now) {
            hasExpired = true;
            const pastEvent = {
              event_name: c.event_name,
              start_date: c.event_start,
              end_date: c.event_end,
              is_active: false
            };
            return {
              ...c,
              event_name: '',
              event_start: '',
              event_end: '',
              history: [pastEvent, ...(c.history || [])]
            };
          }
        }
        return c;
      });

      if (hasExpired) {
        campuses = updated;
      }
    };

    checkExpiredEvents();
    const interval = setInterval(checkExpiredEvents, 10000);
    return () => clearInterval(interval);
  });

  // Temp state for editing
  let edit2 = $state(0);
  let edit4 = $state(0);
  let editEventName = $state('');
  let editStartDate = $state('');
  let editEndDate = $state('');
  let editTotal = $derived((Number(edit2) || 0) + (Number(edit4) || 0));

  let showHistory = $state(false);

  function selectCampus(name: string) {
    if (editingCampus) return;
    selectedName = name;
    showHistory = false;
  }

  function startEdit() {
    editingCampus = campus.name;
    // When limits were never split, start from an even split of the old total
    edit2 = campus.capacity2 ?? Math.floor((campus.capacity ?? 0) / 2);
    edit4 = campus.capacity4 ?? Math.ceil((campus.capacity ?? 0) / 2);
    editEventName = campus.event_name;
    editStartDate = toLocalDatetimeString(campus.event_start);
    editEndDate = toLocalDatetimeString(campus.event_end);
  }

  function cancelEdit() {
    editingCampus = null;
  }

  function pct(used: number, cap: number | null): number {
    if (!cap) return used > 0 ? 100 : 0;
    return Math.min(100, Math.round((used / cap) * 100));
  }

  function level(used: number, cap: number | null): 'ok' | 'busy' | 'full' {
    const p = pct(used, cap);
    if (p >= 100) return 'full';
    if (p >= 80) return 'busy';
    return 'ok';
  }

  async function removeEvent(campusName: string) {
    if (!await askConfirm('Are you sure you want to remove the current event?')) return;
    loadingCampus = campusName;
    try {
        const res = await fetch('/api/security/capacity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campus: campusName, remove_event: true })
        });
        if (res.ok) {
            invalidateAll();
        } else {
            showAlert('Failed to remove event.');
        }
    } catch(e) {
        showAlert('Network error');
    } finally {
        loadingCampus = null;
    }
  }

  async function saveCapacity(campusName: string) {
    const limits = [Number(edit2), Number(edit4)];
    if (limits.some((v) => !Number.isInteger(v) || v < 0 || v > 10000)) {
        showAlert('2-wheel and 4-wheel limits must be whole numbers from 0 to 10000.');
        return;
    }

    if (editEventName && (!editStartDate || !editEndDate)) {
        showAlert('Please specify both start and end date for the event');
        return;
    }

    if (editEventName && editStartDate && editEndDate) {
        if (new Date(editEndDate).getTime() < new Date(editStartDate).getTime()) {
            showAlert('End date cannot be earlier than start date');
            return;
        }
    }

    loadingCampus = campusName;
    try {
        const res = await fetch('/api/security/capacity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campus: campusName,
                capacity_2_wheels: Number(edit2),
                capacity_4_wheels: Number(edit4),
                event_name: editEventName,
                start_date: editStartDate ? new Date(editStartDate).toISOString() : undefined,
                end_date: editEndDate ? new Date(editEndDate).toISOString() : undefined
            })
        });

        if (res.ok) {
            invalidateAll();
            editingCampus = null;
            showAlert('Capacity updated successfully');
        } else {
            const json = await res.json();
            showAlert(json.error || 'Failed to update capacity. Did you run the SQL migration?');
        }
    } catch (e) {
        showAlert('Network error');
    } finally {
        loadingCampus = null;
    }
  }
</script>

<AppShell showSidebar={true} userEmail={data.userEmail} userRole={userRole}>
  <div class="capacity-wrapper">
    <div class="header">
      <h1>Parking Capacity Records</h1>
      <p>Vehicles inside and parking limits per campus, for 2-wheel and 4-wheel vehicles</p>
    </div>

    <!-- Campus selector -->
    <div class="campus-switch" role="tablist" aria-label="Campus">
      {#each campuses as c}
        <button
          type="button"
          role="tab"
          class="campus-tab"
          class:active={c.name === selectedName}
          aria-selected={c.name === selectedName}
          disabled={!!editingCampus && c.name !== selectedName}
          onclick={() => selectCampus(c.name)}
        >
          <span class="campus-tab-name">{campusLabels[c.name] ?? c.name}</span>
          <span class="campus-tab-count">{c.occupied}/{c.capacity}</span>
        </button>
      {/each}
    </div>

    {#if campus}
      <section class="capacity-card">
        <div class="card-head">
          <div>
            <h2>{campus.name === 'Main Campus' ? 'Main Campus' : `${campusLabels[campus.name] ?? campus.name} Campus`}</h2>
            <span class="card-sub">Live count of vehicles currently inside</span>
          </div>
          {#if !editingCampus}
            <button class="set-btn" onclick={startEdit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              Update Limits &amp; Event
            </button>
          {/if}
        </div>

        {#if editingCampus === campus.name}
          <div class="edit-form">
            <div class="limit-inputs">
              <div class="form-group">
                <label for="cap2">2-Wheel Limit (Motorcycles)</label>
                <input id="cap2" type="number" inputmode="numeric" bind:value={edit2} min="0" max="10000" disabled={loadingCampus === campus.name} />
              </div>
              <div class="form-group">
                <label for="cap4">4-Wheel Limit (Cars)</label>
                <input id="cap4" type="number" inputmode="numeric" bind:value={edit4} min="0" max="10000" disabled={loadingCampus === campus.name} />
              </div>
              <div class="form-group total-preview">
                <span class="total-label">Total Capacity</span>
                <span class="total-value">{editTotal}</span>
              </div>
            </div>
            <div class="form-group">
              <label for="evt">Event Name (Optional)</label>
              <input id="evt" type="text" placeholder="e.g. Intramurals" bind:value={editEventName} disabled={loadingCampus === campus.name} />
            </div>
            {#if editEventName}
              <div class="limit-inputs two">
                <div class="form-group">
                  <label for="evt-start">Start Date</label>
                  <input id="evt-start" type="datetime-local" bind:value={editStartDate} disabled={loadingCampus === campus.name} />
                </div>
                <div class="form-group">
                  <label for="evt-end">End Date</label>
                  <input id="evt-end" type="datetime-local" bind:value={editEndDate} disabled={loadingCampus === campus.name} />
                </div>
              </div>
            {/if}
            <div class="edit-actions">
              <button class="cancel-btn" onclick={cancelEdit} disabled={loadingCampus === campus.name}>Cancel</button>
              <button class="save-btn" onclick={() => saveCapacity(campus.name)} disabled={loadingCampus === campus.name}>
                {loadingCampus === campus.name ? 'Saving...' : 'Save Limits'}
              </button>
            </div>
          </div>
        {:else}
          <!-- Overall -->
          <div class="total-row">
            <div class="stat">
              <span class="label">Total Capacity</span>
              <span class="value">{campus.capacity}</span>
            </div>
            <div class="stat">
              <span class="label">Occupied</span>
              <span class="value occupied">{campus.occupied}</span>
            </div>
            <div class="stat">
              <span class="label">Unoccupied</span>
              <span class="value available">{campus.unoccupied ?? campus.available}</span>
            </div>
          </div>

          <!-- Per vehicle type -->
          <div class="type-grid">
            {#each [
              { key: '2', title: '2-Wheels', sub: 'Motorcycles', used: campus.wheels2 ?? 0, cap: campus.capacity2, free: campus.available2 },
              { key: '4', title: '4-Wheels', sub: 'Cars', used: campus.wheels4 ?? 0, cap: campus.capacity4, free: campus.available4 }
            ] as t (t.key)}
              {@const lvl = level(t.used, t.cap)}
              <div class="type-card lvl-{lvl}">
                <div class="type-head">
                  <div class="type-icon" aria-hidden="true">
                    {#if t.key === '2'}
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M15 6h2l3 8"/><path d="M5.5 17l4-7h5l4 7"/></svg>
                    {:else}
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14"/><path d="M3 17v-4l2.5-5h13L21 13v4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
                    {/if}
                  </div>
                  <div class="type-title">
                    <span class="type-name">{t.title}</span>
                    <span class="type-sub">{t.sub}</span>
                  </div>
                  <span class="type-badge">
                    {#if t.cap === null}No limit set{:else if lvl === 'full'}Full{:else if lvl === 'busy'}Almost full{:else}Available{/if}
                  </span>
                </div>
                <div class="type-numbers">
                  <span class="type-used">{t.used}</span>
                  <span class="type-of">/ {t.cap ?? '—'} inside</span>
                </div>
                <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax={t.cap ?? 0} aria-valuenow={t.used} aria-label="{t.title} occupancy">
                  <div class="meter-fill" style="width: {pct(t.used, t.cap)}%"></div>
                </div>
                <span class="type-free">
                  {#if t.cap === null}Set a limit with Update Limits{:else}{t.free} slot{t.free === 1 ? '' : 's'} free{/if}
                </span>
              </div>
            {/each}
          </div>

          <!-- Event -->
          <div class="event-display">
            <div class="event-main">
              <span class="label">Current Event</span>
              <span class="event-name">{campus.event_name || 'None'}</span>
              {#if campus.event_name}
                <span class="event-times">
                  {new Date(campus.event_start).toLocaleString()} – {new Date(campus.event_end).toLocaleString()}
                </span>
              {/if}
            </div>
            {#if campus.event_name}
              <button class="remove-event-btn" onclick={() => removeEvent(campus.name)} disabled={loadingCampus === campus.name}>Remove Event</button>
            {/if}
          </div>
        {/if}

        <!-- History -->
        <button type="button" class="history-toggle" aria-expanded={showHistory} onclick={() => (showHistory = !showHistory)}>
          <span>Event History</span>
          <svg class:rotated={showHistory} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        {#if showHistory}
          <div class="history-panel">
            {#if campus.history && campus.history.length > 0}
              <table class="history-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {#each campus.history as h}
                    <tr>
                      <td>{h.event_name}</td>
                      <td>{new Date(h.start_date).toLocaleDateString()} {new Date(h.start_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                      <td>{new Date(h.end_date).toLocaleDateString()} {new Date(h.end_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <div class="no-history">No past events recorded.</div>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</AppShell>

<style>
  .capacity-wrapper {
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  .header {
    position: relative;
    overflow: hidden;
    margin-bottom: 1.25rem;
    padding: 1.75rem 2.25rem;
    border-radius: 18px;
    background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
    border: 1px solid rgba(233, 194, 94, 0.25);
    box-shadow: 0 10px 25px -5px rgba(122, 23, 52, 0.35);
  }

  .header::after {
    content: '';
    position: absolute;
    right: -40px;
    top: -40px;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(233, 194, 94, 0.25), transparent 70%);
    pointer-events: none;
  }

  .header h1 {
    font-size: 1.6rem;
    font-weight: 800;
    color: #E9C25E;
    margin: 0 0 0.35rem 0;
    letter-spacing: -0.01em;
  }

  .header p {
    color: #F5D5DE;
    font-size: 0.92rem;
    font-weight: 500;
    margin: 0;
  }

  /* ─── Campus selector ─── */
  .campus-switch {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
    padding: 0.35rem;
    margin-bottom: 1.25rem;
    background: #ffffff;
    border: 1px solid rgba(139, 26, 60, 0.15);
    border-radius: 14px;
    box-shadow: 0 2px 8px rgba(139, 26, 60, 0.06);
  }

  .campus-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.65rem 0.5rem;
    min-height: 52px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: #5C3A42;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.2s, color 0.2s, box-shadow 0.2s;
  }

  .campus-tab:hover:not(:disabled):not(.active) {
    background: #F8E9EC;
  }

  .campus-tab.active {
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(139, 26, 60, 0.3);
  }

  .campus-tab:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .campus-tab-name {
    font-size: 0.95rem;
    font-weight: 800;
  }

  .campus-tab-count {
    font-size: 0.72rem;
    font-weight: 600;
    opacity: 0.8;
  }

  .campus-tab.active .campus-tab-count {
    color: #E9C25E;
    opacity: 1;
  }

  /* ─── Wide card ─── */
  .capacity-card {
    position: relative;
    overflow: hidden;
    background: #ffffff;
    border-radius: 20px;
    padding: 1.75rem;
    border: 1px solid rgba(226, 232, 240, 0.9);
    box-shadow: 0 4px 20px rgba(139, 26, 60, 0.06);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .capacity-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 5px;
    background: linear-gradient(90deg, #8B1A3C, #D4A62A);
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .card-head h2 {
    margin: 0;
    font-size: 1.35rem;
    color: #6B1A2A;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .card-sub {
    font-size: 0.8rem;
    color: #8B6A72;
  }

  .total-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    background: linear-gradient(145deg, #fffdf6, #fef7e0);
    padding: 1.1rem 0.5rem;
    border-radius: 16px;
    border: 1px solid rgba(212, 166, 42, 0.35);
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    padding: 0 0.25rem;
  }
  .stat:not(:last-child) {
    border-right: 1px solid rgba(226, 232, 240, 0.9);
  }

  .label {
    font-size: 0.68rem;
    color: #718096;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: center;
  }

  .value {
    font-size: 1.6rem;
    font-weight: 800;
    color: #2d3748;
    line-height: 1.1;
  }

  .value.occupied { color: #e53e3e; }
  .value.available { color: #B8891A; }

  /* ─── Per type ─── */
  .type-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .type-card {
    --lvl: #16a34a;
    --lvl-soft: #f0fdf4;
    border: 1px solid #ecdfe3;
    border-radius: 16px;
    padding: 1rem 1.1rem;
    background: #fbf7f8;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .type-card.lvl-busy { --lvl: #d97706; --lvl-soft: #fffbeb; }
  .type-card.lvl-full { --lvl: #dc2626; --lvl-soft: #fef2f2; }

  .type-head {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .type-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(139, 26, 60, 0.08);
    color: #8B1A3C;
    flex-shrink: 0;
  }

  .type-title {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .type-name {
    font-size: 1rem;
    font-weight: 800;
    color: #1A0A0E;
  }

  .type-sub {
    font-size: 0.75rem;
    color: #8B6A72;
  }

  .type-badge {
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    color: var(--lvl);
    background: var(--lvl-soft);
    border: 1px solid color-mix(in srgb, var(--lvl) 35%, transparent);
    white-space: nowrap;
  }

  .type-numbers {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
  }

  .type-used {
    font-size: 2rem;
    font-weight: 800;
    color: #1A0A0E;
    line-height: 1;
  }

  .type-of {
    font-size: 0.85rem;
    color: #5C3A42;
    font-weight: 600;
  }

  .meter {
    height: 10px;
    border-radius: 999px;
    background: #efe3e6;
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--lvl);
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .type-free {
    font-size: 0.78rem;
    font-weight: 600;
    color: #5C3A42;
  }

  /* ─── Event ─── */
  .event-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 1rem 1.1rem;
    background: rgba(139, 26, 60, 0.05);
    border-radius: 14px;
    border: 1px solid rgba(139, 26, 60, 0.15);
  }

  .event-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .event-main .label {
    text-align: left;
  }

  .event-name {
    font-size: 1.05rem;
    color: #8B1A3C;
    font-weight: 800;
  }

  .event-times {
    font-size: 0.78rem;
    color: #4a5568;
    font-weight: 500;
  }

  .remove-event-btn {
    background: #fff5f5;
    color: #e53e3e;
    border: 1px solid #feb2b2;
    border-radius: 8px;
    padding: 0.5rem 0.85rem;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s;
  }

  .remove-event-btn:hover:not(:disabled) {
    background: #fed7d7;
  }

  .set-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.7rem 1.1rem;
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #E9C25E;
    border: 1px solid rgba(212, 166, 42, 0.5);
    border-radius: 12px;
    font-weight: 700;
    font-family: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 10px rgba(139, 26, 60, 0.25);
  }

  .set-btn:hover {
    background: linear-gradient(135deg, #7A1734, #4a0d1e);
    transform: translateY(-1px);
  }

  /* ─── Edit form ─── */
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .limit-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr 0.8fr;
    gap: 0.75rem;
    align-items: end;
  }

  .limit-inputs.two {
    grid-template-columns: 1fr 1fr;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .form-group label {
    font-size: 0.72rem;
    font-weight: 700;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .form-group input {
    padding: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    font-size: 0.95rem;
    transition: border-color 0.2s, box-shadow 0.2s;
    background: #f8fafc;
    outline: none;
    min-width: 0;
  }

  .form-group input:focus {
    border-color: #8B1A3C;
    box-shadow: 0 0 0 3px rgba(139, 26, 60, 0.1);
    background: #ffffff;
  }

  .total-preview {
    align-items: center;
    justify-content: center;
    padding: 0.55rem;
    border-radius: 10px;
    background: linear-gradient(145deg, #fffdf6, #fef7e0);
    border: 1px solid rgba(212, 166, 42, 0.35);
  }

  .total-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #8B6A72;
  }

  .total-value {
    font-size: 1.35rem;
    font-weight: 800;
    color: #6B1A2A;
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .save-btn, .cancel-btn {
    min-height: 44px;
    padding: 0.7rem 1.4rem;
    border-radius: 10px;
    font-weight: 700;
    font-family: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .save-btn {
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #E9C25E;
    border: none;
    box-shadow: 0 4px 10px rgba(139, 26, 60, 0.3);
  }
  .save-btn:disabled { opacity: 0.7; cursor: not-allowed; box-shadow: none; }

  .cancel-btn {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
  }
  .cancel-btn:disabled { opacity: 0.7; cursor: not-allowed; }

  /* ─── History ─── */
  .history-toggle {
    padding-top: 1rem;
    border: none;
    border-top: 1px dashed #e2e8f0;
    background: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #718096;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .history-toggle:hover {
    color: #2d3748;
  }

  .history-toggle svg {
    transition: transform 0.2s;
  }
  .history-toggle svg.rotated {
    transform: rotate(180deg);
  }

  .history-panel {
    background: #f7fafc;
    border-radius: 10px;
    padding: 0.5rem;
    font-size: 0.78rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .history-table {
    width: 100%;
    min-width: 380px;
    border-collapse: collapse;
    text-align: left;
  }

  .history-table th {
    padding: 0.5rem;
    color: #4a5568;
    border-bottom: 1px solid #e2e8f0;
  }

  .history-table td {
    padding: 0.5rem;
    color: #2d3748;
    border-bottom: 1px solid #edf2f7;
  }

  .history-table tr:last-child td {
    border-bottom: none;
  }

  .no-history {
    padding: 1rem;
    text-align: center;
    color: #a0aec0;
  }

  @media (max-width: 1024px) {
    .capacity-wrapper {
      padding: 1.5rem 1rem;
    }
  }

  @media (max-width: 640px) {
    .capacity-wrapper {
      padding: 0.75rem 0.5rem;
    }
    .header {
      padding: 1.1rem;
      border-radius: 14px;
      margin-bottom: 1rem;
    }
    .header h1 {
      font-size: 1.25rem;
    }
    .capacity-card {
      padding: 1.25rem 0.9rem;
      border-radius: 16px;
    }
    .set-btn {
      width: 100%;
      justify-content: center;
    }
    .value {
      font-size: 1.25rem;
    }
    .type-grid {
      grid-template-columns: 1fr;
    }
    .limit-inputs {
      grid-template-columns: 1fr 1fr;
    }
    .total-preview {
      grid-column: 1 / -1;
      flex-direction: row;
      gap: 0.6rem;
    }
    .limit-inputs.two {
      grid-template-columns: 1fr;
    }
    .edit-actions {
      flex-direction: column-reverse;
    }
    .save-btn, .cancel-btn {
      width: 100%;
    }
    .event-display {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
