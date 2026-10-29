<script lang="ts">
  import { dialogState, closeDialog } from '$lib/utils/dialog';

  let confirmBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if ($dialogState && confirmBtn) confirmBtn.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (!$dialogState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog(false);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if $dialogState}
  {@const d = $dialogState}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dlg-overlay" onclick={() => { if (d.kind === 'alert') closeDialog(false); }}>
    <div
      class="dlg-card tone-{d.tone}"
      role={d.kind === 'confirm' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      aria-describedby="app-dialog-message"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="dlg-icon" aria-hidden="true">
        {#if d.tone === 'error'}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {:else if d.tone === 'success'}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>
        {:else if d.tone === 'warning'}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        {:else}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        {/if}
      </div>
      <h2 id="app-dialog-title" class="dlg-title">{d.title}</h2>
      <p id="app-dialog-message" class="dlg-message">{d.message}</p>
      {#if d.detail}
        <p class="dlg-detail">{d.detail}</p>
      {/if}
      <div class="dlg-actions">
        {#if d.kind === 'confirm'}
          <button type="button" class="dlg-btn dlg-cancel" onclick={() => closeDialog(false)}>{d.cancelLabel}</button>
        {/if}
        <button type="button" class="dlg-btn dlg-confirm" bind:this={confirmBtn} onclick={() => closeDialog(true)}>{d.confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dlg-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(30, 8, 14, 0.55);
    backdrop-filter: blur(2px);
    animation: dlg-fade 0.15s ease;
  }
  .dlg-card {
    --tone: #6b1d2f;
    --tone-soft: rgba(107, 29, 47, 0.08);
    width: 100%;
    max-width: 420px;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    background: #ffffff;
    border-radius: 18px;
    border-top: 5px solid var(--tone);
    padding: 1.75rem 1.5rem 1.25rem;
    text-align: center;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
    animation: dlg-pop 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tone-error { --tone: #dc2626; --tone-soft: #fef2f2; }
  .tone-success { --tone: #16a34a; --tone-soft: #f0fdf4; }
  .tone-warning { --tone: #d97706; --tone-soft: #fffbeb; }
  .tone-info { --tone: #6b1d2f; --tone-soft: rgba(107, 29, 47, 0.08); }

  .dlg-icon {
    width: 56px;
    height: 56px;
    margin: 0 auto 0.85rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tone);
    background: var(--tone-soft);
  }
  .dlg-title {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
    font-weight: 800;
    color: #1e293b;
  }
  .dlg-message {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.55;
    color: #334155;
    white-space: pre-line;
  }
  .dlg-detail {
    margin: 0.85rem 0 0;
    padding: 0.7rem 0.85rem;
    font-size: 0.82rem;
    line-height: 1.5;
    color: #475569;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    text-align: left;
  }
  .dlg-actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1.35rem;
  }
  .dlg-btn {
    flex: 1;
    min-height: 44px;
    padding: 0.65rem 1rem;
    border-radius: 10px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.15s;
  }
  .dlg-btn:hover { opacity: 0.9; transform: translateY(-1px); }
  .dlg-cancel {
    background: #ffffff;
    color: #475569;
    border: 1.5px solid #e2e8f0;
  }
  .dlg-confirm {
    background: var(--tone);
    color: #ffffff;
    border: none;
  }
  .tone-info .dlg-confirm { background: linear-gradient(135deg, #7a1734 0%, #4a121e 100%); }

  @media (max-width: 400px) {
    .dlg-actions { flex-direction: column-reverse; }
  }
  @keyframes dlg-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes dlg-pop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
</style>
