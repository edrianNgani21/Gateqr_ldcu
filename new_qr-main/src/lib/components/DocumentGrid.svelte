<script lang="ts">
  let { role, owner, clickable = true, documents = {}, onopen }: {
    role: string;
    owner: string;
    clickable?: boolean;
    documents?: Record<string, string | null>;
    onopen?: (url: string) => void;
  } = $props();

  const ltoFull = $derived(!(role === 'visitor' && owner === 'yes'));

  function isValidDoc(url: string | null | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    const t = url.trim().toLowerCase();
    if (['pending_or', 'pending_cr', 'pending_license', 'pending_enrollment', 'n/a', 'pending', 'null', 'undefined', 'not specified', '-', ''].includes(t)) {
      return false;
    }
    // Prevent treating raw student/employee ID numbers (e.g. 2021-00123) as URLs
    if (/^\d{4}-\d+$/.test(t) || /^\d+$/.test(t)) {
      return false;
    }
    return t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:') || t.startsWith('/');
  }

  function open(url: string | null | undefined) {
    if (url && isValidDoc(url) && onopen) onopen(url);
  }
</script>

<div class="doc-section">
  <!-- Liceo documents for non-visitors/concessionaires (always shown for student/employee) -->
  {#if role !== 'visitor' && role !== 'concessionaire'}
    <div class="doc-grid" style="--cols: {owner === 'no' ? 3 : 2}">
      <button class="doc-tile" class:has-doc={isValidDoc(documents.id)} disabled={!clickable || !isValidDoc(documents.id)} onclick={() => open(documents.id)} title={isValidDoc(documents.id) ? 'View ID Document' : 'ID Document Not Uploaded'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
        <span>(Liceo) {role === 'student' ? 'Student ID' : 'Employee ID'}</span>
      </button>
      <button class="doc-tile" class:has-doc={isValidDoc(documents.enrollment)} disabled={!clickable || !isValidDoc(documents.enrollment)} onclick={() => open(documents.enrollment)} title={isValidDoc(documents.enrollment) ? 'View Enrollment Form' : 'Enrollment Form Not Uploaded'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>(Liceo) {role === 'student' ? 'Enrollment Form' : 'Load Sheet / DTR'}</span>
      </button>
      {#if owner === 'yes'}
        <button class="doc-tile" class:has-doc={isValidDoc(documents.letter)} disabled={!clickable || !isValidDoc(documents.letter)} onclick={() => open(documents.letter)} title={isValidDoc(documents.letter) ? 'View Signed Letter' : 'Authorization Letter Not Uploaded'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
          <span>Signed Letter / DOAS</span>
        </button>
      {/if}
    </div>
  {/if}

  <!-- Visitor + registered under someone else -->
  {#if role === 'visitor' && owner === 'yes'}
    <div class="doc-grid" style="--cols: 2">
      <button class="doc-tile" class:has-doc={isValidDoc(documents.license)} disabled={!clickable || !isValidDoc(documents.license)} onclick={() => open(documents.license)} title={isValidDoc(documents.license) ? 'View Driver License' : 'Driver License Not Uploaded'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        <span>(LTO) Driver's License</span>
      </button>
      <button class="doc-tile" class:has-doc={isValidDoc(documents.letter)} disabled={!clickable || !isValidDoc(documents.letter)} onclick={() => open(documents.letter)} title={isValidDoc(documents.letter) ? 'View Signed Letter' : 'Authorization Letter Not Uploaded'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
        <span>Signed Letter / DOAS</span>
      </button>
    </div>
  {/if}

  <!-- LTO documents (always shown) -->
  <div class="doc-grid" style="--cols: {ltoFull ? 3 : 2}">
    {#if ltoFull}
      <button class="doc-tile" class:has-doc={isValidDoc(documents.license)} disabled={!clickable || !isValidDoc(documents.license)} onclick={() => open(documents.license)} title={isValidDoc(documents.license) ? 'View Driver License' : 'Driver License Not Uploaded'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        <span>(LTO) Driver's License</span>
      </button>
    {/if}
    <button class="doc-tile" class:has-doc={isValidDoc(documents.or)} disabled={!clickable || !isValidDoc(documents.or)} onclick={() => open(documents.or)} title={isValidDoc(documents.or) ? 'View Vehicle OR' : 'Vehicle OR Not Uploaded'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span>(LTO) Vehicle OR</span>
    </button>
    <button class="doc-tile" class:has-doc={isValidDoc(documents.cr)} disabled={!clickable || !isValidDoc(documents.cr)} onclick={() => open(documents.cr)} title={isValidDoc(documents.cr) ? 'View Vehicle CR' : 'Vehicle CR Not Uploaded'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span>(LTO) Vehicle CR</span>
    </button>
  </div>

  <!-- Hardcopy Agreement Form to Park signed by the Department Head (uploaded by the applicant) -->
  {#if isValidDoc(documents.agreement)}
    <div class="doc-grid" style="--cols: 1">
      <button class="doc-tile has-doc" disabled={!clickable} onclick={() => open(documents.agreement)} title="View Signed Agreement Form to Park">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Signed Agreement Form to Park</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .doc-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .doc-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), 1fr);
    gap: 0.5rem;
  }

  .doc-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 72px;
    padding: 0.5rem;
    background: var(--maroon-muted);
    border: 1.5px solid var(--border-light);
    border-radius: var(--radius-sm);
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--maroon);
    font-family: inherit;
    cursor: pointer;
    text-align: center;
    line-height: 1.3;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }

  .doc-tile:hover:not(:disabled) {
    background: var(--maroon-tint);
    border-color: var(--maroon-light);
    transform: translateY(-1px);
  }

  .doc-tile:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .doc-tile.has-doc {
    border-color: var(--maroon-light);
    background: var(--maroon-tint);
  }

  .doc-tile svg {
    color: var(--maroon-light);
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .doc-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 0.45rem;
    }
    .doc-tile {
      height: auto;
      min-height: 64px;
      padding: 0.5rem 0.35rem;
      font-size: 0.68rem;
    }
  }

  @media (max-width: 380px) {
    .doc-grid {
      grid-template-columns: 1fr !important;
    }
  }
</style>
