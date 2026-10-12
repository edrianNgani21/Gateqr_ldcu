<script lang="ts">
  let {
    tab,
    status = '',
    expiresAt = null,
    onaction
  }: {
    tab: string;
    status?: string;
    expiresAt?: string | null;
    onaction?: (action: string, schedule: string) => Promise<void> | void;
  } = $props();

  let isExpired = $derived(expiresAt ? new Date(expiresAt) < new Date() : false);
  let loadingAction = $state<string | null>(null);

  async function act(action: string, schedule: string = '') {
    if (loadingAction) return; // prevent double-click
    loadingAction = action;
    try {
      await onaction?.(action, schedule);
    } finally {
      loadingAction = null;
    }
  }
</script>

<!-- Inline spinner SVG snippet -->
{#snippet spinner()}
  <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
  </svg>
{/snippet}

<div class="action-bar">
  {#if tab === 'validation'}
    <button
      class="action-btn btn-reject"
      onclick={() => act('reject')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'reject'}
    >
      {#if loadingAction === 'reject'}
        {@render spinner()}
        Rejecting…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Reject
      {/if}
    </button>
    <button
      class="action-btn btn-accept"
      onclick={() => act('accept')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'accept'}
    >
      {#if loadingAction === 'accept'}
        {@render spinner()}
        Scheduling…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Accept
      {/if}
    </button>

  {:else if tab === 'distribution'}
    <button
      class="action-btn btn-deliver"
      onclick={() => act('check_hardcopy')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'check_hardcopy'}
    >
      {#if loadingAction === 'check_hardcopy'}
        {@render spinner()}
        Checking…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Check
      {/if}
    </button>

  {:else if tab === 'overdue'}
    <button
      class="action-btn btn-deliver"
      onclick={() => act('proceed_overdue')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'proceed_overdue'}
    >
      {#if loadingAction === 'proceed_overdue'}
        {@render spinner()}
        Processing…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Proceed process
      {/if}
    </button>
    <button
      class="action-btn btn-reschedule"
      onclick={() => act('reschedule')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'reschedule'}
    >
      {#if loadingAction === 'reschedule'}
        {@render spinner()}
        Opening…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Reschedule
      {/if}
    </button>

  {:else if tab === 'Document Review'}
    <button
      class="action-btn btn-deliver"
      onclick={() => act('security_check')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'security_check'}
    >
      {#if loadingAction === 'security_check'}
        {@render spinner()}
        Checking…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Checked
      {/if}
    </button>

  {:else if tab === 'Sticker Installation'}
    <button
      class="action-btn btn-deliver"
      onclick={() => act('install_sticker')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'install_sticker'}
    >
      {#if loadingAction === 'install_sticker'}
        {@render spinner()}
        Updating…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Done Installed
      {/if}
    </button>
    <button
      class="action-btn btn-reschedule"
      onclick={() => act('reschedule')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'reschedule'}
    >
      {#if loadingAction === 'reschedule'}
        {@render spinner()}
        Opening…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Reschedule
      {/if}
    </button>

  {:else if tab === 'release'}
    <button
      class="action-btn btn-deliver"
      onclick={() => act('release_sticker')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'release_sticker'}
    >
      {#if loadingAction === 'release_sticker'}
        {@render spinner()}
        Releasing…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Sticker Released
      {/if}
    </button>

  {:else if tab.toLowerCase() === 'registered'}
    <button
      class="action-btn btn-revoke"
      onclick={() => act('revoke')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'revoke'}
    >
      {#if loadingAction === 'revoke'}
        {@render spinner()}
        Revoking…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Revoke Access
      {/if}
    </button>
    <button
      class="action-btn btn-delete"
      onclick={() => act('delete')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'delete'}
    >
      {#if loadingAction === 'delete'}
        {@render spinner()}
        Deleting…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        Delete
      {/if}
    </button>

  {:else if tab.toLowerCase() === 'revoked' || tab.toLowerCase() === 'revoked registered'}
    {#if status !== 'rejected' && status !== 'revoked'}
      <button
        class="action-btn btn-revoke"
        onclick={() => act('retract')}
        disabled={!!loadingAction}
        class:btn-loading={loadingAction === 'retract'}
      >
        {#if loadingAction === 'retract'}
          {@render spinner()}
          Retracting…
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          Retract Approval
        {/if}
      </button>
    {/if}
    {#if status === 'revoked' && !isExpired}
      <button
        class="action-btn btn-unrevoke"
        onclick={() => act('unrevoke')}
        disabled={!!loadingAction}
        class:btn-loading={loadingAction === 'unrevoke'}
      >
        {#if loadingAction === 'unrevoke'}
          {@render spinner()}
          Restoring…
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          Unrevoke
        {/if}
      </button>
    {/if}
    <button
      class="action-btn btn-delete"
      onclick={() => act('delete')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'delete'}
    >
      {#if loadingAction === 'delete'}
        {@render spinner()}
        Deleting…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        Delete
      {/if}
    </button>

  {:else if tab.toLowerCase() === 'rejected'}
    <button
      class="action-btn btn-revoke"
      onclick={() => act('retract')}
      disabled={!!loadingAction}
      class:btn-loading={loadingAction === 'retract'}
    >
      {#if loadingAction === 'retract'}
        {@render spinner()}
        Reconsidering…
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        Reconsider Application
      {/if}
    </button>
  {/if}
</div>

<style>
  .action-bar {
    display: flex;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.75rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
  }

  .action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .action-btn:not(:disabled):hover {
    opacity: 0.88;
    transform: translateY(-1px);
  }

  .action-btn:active {
    transform: translateY(0);
  }

  /* Loading state: full opacity, no hover lift */
  .btn-loading {
    opacity: 1 !important;
    cursor: wait !important;
  }

  /* Spinning icon */
  .btn-spinner {
    width: 14px;
    height: 14px;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .btn-reject {
    background: #fef2f2;
    color: #b91c1c;
    border: 1.5px solid #fca5a5;
  }
  .btn-reject:not(:disabled):hover { background: #fee2e2; box-shadow: 0 2px 8px rgba(185,28,28,0.15); }

  .btn-accept {
    background: var(--maroon);
    color: #fff;
    box-shadow: 0 2px 8px rgba(107,26,42,0.3);
  }
  .btn-accept:not(:disabled):hover { background: var(--maroon-light); }

  .btn-deliver {
    background: #f5f3ff;
    color: #6d28d9;
    border: 1.5px solid #c4b5fd;
  }
  .btn-deliver:not(:disabled):hover { background: #ede9fe; }



  .btn-reschedule {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1.5px solid #bfdbfe;
  }
  .btn-reschedule:not(:disabled):hover { background: #dbeafe; }

  .btn-revoke {
    background: #fffbeb;
    color: #b45309;
    border: 1.5px solid #fde68a;
  }
  .btn-revoke:not(:disabled):hover { background: #fef3c7; }

  .btn-unrevoke {
    background: #ecfdf5;
    color: #047857;
    border: 1.5px solid #a7f3d0;
  }
  .btn-unrevoke:not(:disabled):hover { background: #d1fae5; }

  .btn-delete {
    background: #fef2f2;
    color: #b91c1c;
    border: 1.5px solid #fca5a5;
  }
  .btn-delete:not(:disabled):hover { background: #fee2e2; }

  @media (max-width: 640px) {
    .action-bar {
      gap: 0.5rem;
    }
    .action-btn {
      flex: 1 1 calc(50% - 0.5rem);
      min-width: 130px;
    }
  }

  @media (max-width: 480px) {
    .action-bar {
      flex-direction: column;
      gap: 0.5rem;
    }
    .action-btn {
      width: 100%;
      padding: 0.65rem 0.75rem;
    }
  }
</style>
