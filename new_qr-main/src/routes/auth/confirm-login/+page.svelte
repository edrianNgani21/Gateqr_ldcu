<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  let submitting = $state(false);
  let result = $derived(form?.done ?? null);
  let view = $derived(result ?? data.request?.state ?? 'missing');
</script>

<svelte:head>
  <title>Confirm Sign-in — GateQR</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="confirm-page">
  <div class="confirm-card">
    <div class="brand">
      <img src="/liceo-logo.png" alt="" width="44" height="44" />
      <div>
        <div class="brand-uni">Liceo de Cagayan University</div>
        <div class="brand-app">GateQR Admin Sign-in</div>
      </div>
    </div>

    {#if view === 'approved'}
      <div class="state-icon ok" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h1>Sign-in confirmed</h1>
      <p class="lead">Go back to the GateQR login screen: it will open your dashboard automatically. This browser won't ask again for 30 days.</p>
      <p class="muted">You can close this page.</p>
    {:else if view === 'denied'}
      <div class="state-icon bad" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
      </div>
      <h1>Sign-in blocked</h1>
      <p class="lead">
        We cancelled that sign-in and locked the account{#if form?.lockedUntil} until <strong>{form.lockedUntil}</strong>{:else} for 15 minutes{/if}. The Office of Student Affairs has been alerted.
      </p>
      <div class="advice">
        <strong>Please change your password</strong> as soon as the lock ends. Someone knows it.
      </div>
    {:else if view === 'used'}
      <h1>Already confirmed</h1>
      <p class="lead">This sign-in was confirmed and has already been used. No further action is needed.</p>
    {:else if view === 'expired'}
      <div class="state-icon warn" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <h1>This request expired</h1>
      <p class="lead">Sign-in confirmations are valid for 10 minutes. Please sign in again to get a new email.</p>
      <a class="btn btn-primary" href="/login">Go to login</a>
    {:else if view === 'pending' && data.request}
      <h1>{data.choice === 'no' ? 'Block this sign-in?' : 'Is this you signing in?'}</h1>
      <p class="lead">Someone entered the correct password for <strong>{data.request.email}</strong>.</p>

      <dl class="details">
        <div><dt>When</dt><dd>{data.request.when}</dd></div>
        <div><dt>Device</dt><dd>{data.request.device}</dd></div>
        {#if data.request.ip}<div><dt>IP address</dt><dd>{data.request.ip}</dd></div>{/if}
      </dl>

      {#if form?.message}
        <p class="error" role="alert">{form.message}</p>
      {/if}

      <form method="POST" class="actions" use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }}>
        <input type="hidden" name="token" value={data.token} />
        {#if data.choice === 'no'}
          <button class="btn btn-danger" formaction="?/deny" disabled={submitting}>{submitting ? 'Blocking…' : 'This is not me — block it'}</button>
          <button class="btn btn-ghost" formaction="?/approve" disabled={submitting}>Actually, it was me</button>
        {:else}
          <button class="btn btn-success" formaction="?/approve" disabled={submitting}>{submitting ? 'Confirming…' : 'Yes, this is me'}</button>
          <button class="btn btn-ghost-danger" formaction="?/deny" disabled={submitting}>This is not me</button>
        {/if}
      </form>
      <p class="muted">Choosing "This is not me" cancels the sign-in, locks the account for 15 minutes and alerts OSA.</p>
    {:else}
      <h1>Link not valid</h1>
      <p class="lead">This confirmation link is invalid or has already been used. If you're trying to sign in, start again from the login page.</p>
      <a class="btn btn-primary" href="/login">Go to login</a>
    {/if}
  </div>
</div>

<style>
  .confirm-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background: linear-gradient(180deg, #4A121E 0%, #1E080E 100%);
  }
  .confirm-card {
    width: 100%;
    max-width: 460px;
    background: #ffffff;
    border-radius: 20px;
    border-top: 5px solid #D4AF37;
    padding: 1.75rem 1.5rem 1.5rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55);
    text-align: center;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    margin-bottom: 1.25rem;
    text-align: left;
  }
  .brand-uni {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #92400E;
  }
  .brand-app {
    font-size: 1rem;
    font-weight: 800;
    color: #6B1D2F;
  }
  .state-icon {
    width: 60px;
    height: 60px;
    margin: 0 auto 0.85rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .state-icon.ok { background: #f0fdf4; color: #16a34a; }
  .state-icon.bad { background: #fef2f2; color: #dc2626; }
  .state-icon.warn { background: #fffbeb; color: #d97706; }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 800;
    color: #1e293b;
  }
  .lead {
    margin: 0 0 1rem;
    font-size: 0.92rem;
    line-height: 1.55;
    color: #334155;
  }
  .muted {
    margin: 0.85rem 0 0;
    font-size: 0.78rem;
    color: #64748b;
  }
  .details {
    margin: 0 0 1.1rem;
    padding: 0.75rem 0.9rem;
    border-radius: 12px;
    background: #fbf7f8;
    border: 1px solid #ecdfe3;
    text-align: left;
  }
  .details div {
    display: flex;
    gap: 0.75rem;
    padding: 0.3rem 0;
    font-size: 0.85rem;
  }
  .details dt {
    width: 90px;
    flex-shrink: 0;
    color: #64748b;
  }
  .details dd {
    margin: 0;
    font-weight: 600;
    color: #1e293b;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .advice {
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #991b1b;
    font-size: 0.85rem;
    text-align: left;
  }
  .error {
    margin: 0 0 0.85rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #991b1b;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
    border: none;
  }
  .btn:disabled { opacity: 0.6; cursor: wait; }
  .btn-success { background: #16a34a; color: #ffffff; }
  .btn-danger { background: #dc2626; color: #ffffff; }
  .btn-primary { background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%); color: #ffffff; border: 1px solid #D4AF37; }
  .btn-ghost { background: #ffffff; color: #475569; border: 1.5px solid #e2e8f0; }
  .btn-ghost-danger { background: #ffffff; color: #dc2626; border: 1.5px solid #fca5a5; }
</style>
