<script lang="ts">
  import { VIOLATION_LEVEL_LABELS, type ViolationLevel } from '$lib/violations';

  let {
    registrationId,
    applicantName = '',
    plate = '',
    onclose,
    onrecorded
  }: {
    registrationId: number;
    applicantName?: string;
    plate?: string;
    onclose: () => void;
    onrecorded?: () => void;
  } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let history = $state<any[]>([]);
  let nextLevel = $state<ViolationLevel>('first_warning');

  let reason = $state('');
  let blockedUntil = $state('');
  let evidenceFile = $state<File | null>(null);
  let evidencePreview = $state<string | null>(null);

  let isBlock = $derived(nextLevel === 'gate_block');

  function toLocalInput(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const minBlockUntil = toLocalInput(new Date(Date.now() + 60 * 1000));

  function formatDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  $effect(() => {
    const id = registrationId;
    loading = true;
    error = '';
    fetch(`/api/violations?registration_id=${id}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to load violation history');
        history = body.history || [];
        nextLevel = body.next_level;
      })
      .catch((e) => (error = e.message || 'Failed to load violation history'))
      .finally(() => (loading = false));
  });

  $effect(() => {
    return () => {
      if (evidencePreview) URL.revokeObjectURL(evidencePreview);
    };
  });

  function onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] || null;
    if (evidencePreview) URL.revokeObjectURL(evidencePreview);
    evidencePreview = null;
    evidenceFile = null;
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      error = 'The evidence must be an image file.';
      return;
    }
    error = '';
    evidenceFile = f;
    evidencePreview = URL.createObjectURL(f);
  }

  async function submit() {
    if (saving) return;
    if (!reason.trim()) {
      error = 'Please enter the violation reason.';
      return;
    }
    if (isBlock && !blockedUntil) {
      error = 'Please set the date and time the gate block ends.';
      return;
    }
    saving = true;
    error = '';
    try {
      const form = new FormData();
      form.append('registration_id', String(registrationId));
      form.append('reason', reason.trim());
      if (isBlock) form.append('blocked_until', new Date(blockedUntil).toISOString());
      if (evidenceFile) form.append('evidence', evidenceFile);
      const res = await fetch('/api/violations', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) {
        if (body.next_level) nextLevel = body.next_level;
        throw new Error(body.error || 'Failed to record violation');
      }
      onrecorded?.();
      onclose();
    } catch (e: any) {
      error = e.message || 'Failed to record violation';
    } finally {
      saving = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={() => { if (!saving) onclose(); }} onkeydown={(e) => { if (e.key === 'Escape' && !saving) onclose(); }} role="dialog" aria-modal="true" tabindex="-1">
  <div class="modal-content violation-modal" onclick={(e) => e.stopPropagation()}>
    <div class="vm-header">
      <h3>Record Violation</h3>
      <p>{applicantName || 'Applicant'}{plate ? ` · ${plate}` : ''}</p>
    </div>

    {#if loading}
      <p class="vm-muted">Loading violation history…</p>
    {:else}
      <div class="vm-level" class:vm-level-block={isBlock}>
        <span class="vm-level-label">This will be recorded as</span>
        <span class="vm-level-value">{VIOLATION_LEVEL_LABELS[nextLevel]}</span>
        <span class="vm-level-note">
          {#if nextLevel === 'first_warning'}The applicant is emailed a warning; 3 violations block the vehicle from the gate.
          {:else if nextLevel === 'second_warning'}Last warning: the next violation will block the vehicle from the gate.
          {:else}The vehicle will be denied entry at every campus gate until the date you set below.{/if}
        </span>
      </div>

      {#if history.length > 0}
        <div class="vm-history">
          <span class="vm-section-label">Previous violations ({history.length})</span>
          <ul>
            {#each history as v}
              <li>
                <span class="vm-chip" class:vm-chip-block={v.violation_level === 'gate_block'}>{VIOLATION_LEVEL_LABELS[v.violation_level as ViolationLevel]}</span>
                <span class="vm-history-reason">{v.reason}</span>
                <span class="vm-history-date">{formatDate(v.recorded_at)}{v.blocked_until ? ` · blocked until ${formatDate(v.blocked_until)}` : ''}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <label class="vm-section-label" for="violation-reason">Reason / warning message</label>
      <textarea id="violation-reason" class="vm-textarea" rows="3" bind:value={reason} placeholder="Describe the violation…" disabled={saving}></textarea>

      <label class="vm-section-label" for="violation-evidence">Photo evidence (optional)</label>
      <input id="violation-evidence" class="vm-file" type="file" accept="image/*" onchange={onFileChange} disabled={saving} />
      {#if evidencePreview}
        <img class="vm-preview" src={evidencePreview} alt="Violation evidence preview" />
      {/if}

      {#if isBlock}
        <div class="vm-block-card">
          <span class="vm-block-title">Gate block</span>
          <span class="vm-block-desc">Set when the block expires. Until then the vehicle is denied entry at Main, RNP and Paseo.</span>
          <label class="vm-section-label" for="violation-blocked-until">Blocked until</label>
          <input id="violation-blocked-until" class="vm-datetime" type="datetime-local" bind:value={blockedUntil} min={minBlockUntil} disabled={saving} />
        </div>
      {/if}
    {/if}

    {#if error}
      <p class="vm-error">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-cancel" onclick={onclose} disabled={saving}>Cancel</button>
      <button type="button" class="btn-confirm" class:btn-danger={isBlock} onclick={submit} disabled={saving || loading}>
        {#if saving}Saving…{:else if isBlock}Record &amp; Block Vehicle{:else}Record {VIOLATION_LEVEL_LABELS[nextLevel]}{/if}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
  }
  .violation-modal {
    background: var(--surface, #fff);
    border-radius: 14px;
    padding: 1.5rem;
    width: 100%;
    max-width: 520px;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  .vm-header h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--maroon, #6b1a2a);
  }
  .vm-header p {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    color: var(--text-secondary, #64748b);
  }
  .vm-muted {
    font-size: 0.85rem;
    color: var(--text-secondary, #64748b);
  }
  .vm-level {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    background: #fffbeb;
    border: 1.5px solid #fde68a;
  }
  .vm-level-block {
    background: #fef2f2;
    border-color: #fca5a5;
  }
  .vm-level-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #92400e;
  }
  .vm-level-block .vm-level-label { color: #991b1b; }
  .vm-level-value {
    font-size: 1.05rem;
    font-weight: 800;
    color: #b45309;
  }
  .vm-level-block .vm-level-value { color: #b91c1c; }
  .vm-level-note {
    font-size: 0.8rem;
    color: #78350f;
  }
  .vm-level-block .vm-level-note { color: #7f1d1d; }
  .vm-section-label {
    display: block;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary, #64748b);
  }
  .vm-history ul {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .vm-history li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .vm-chip {
    font-size: 0.66rem;
    font-weight: 800;
    text-transform: uppercase;
    padding: 0.1rem 0.45rem;
    border-radius: 99px;
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
    white-space: nowrap;
  }
  .vm-chip-block {
    background: #fef2f2;
    color: #b91c1c;
    border-color: #fca5a5;
  }
  .vm-history-reason { color: var(--text-primary, #1e293b); }
  .vm-history-date { color: var(--text-secondary, #64748b); font-size: 0.72rem; }
  .vm-textarea, .vm-datetime {
    width: 100%;
    font-family: inherit;
    font-size: 0.9rem;
  }
  .vm-textarea { resize: vertical; }
  .vm-file { font-size: 0.82rem; max-width: 100%; }
  .vm-preview {
    max-width: 200px;
    max-height: 200px;
    border-radius: 8px;
    border: 1px solid var(--border, #e5e7eb);
    object-fit: cover;
  }
  .vm-block-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.9rem;
    border-radius: 10px;
    border: 2px solid #dc2626;
    background: #fff5f5;
  }
  .vm-block-title {
    font-size: 0.95rem;
    font-weight: 800;
    color: #b91c1c;
  }
  .vm-block-desc {
    font-size: 0.8rem;
    color: #7f1d1d;
  }
  .vm-error {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #b91c1c;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .btn-cancel, .btn-confirm {
    min-height: 44px;
    padding: 0.6rem 1.1rem;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-cancel {
    background: var(--surface, #fff);
    color: var(--text-secondary, #475569);
    border: 1.5px solid var(--border, #e2e8f0);
  }
  .btn-confirm {
    background: var(--maroon, #6b1a2a);
    color: #fff;
    border: none;
  }
  .btn-confirm.btn-danger { background: #dc2626; }
  .btn-cancel:disabled, .btn-confirm:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
