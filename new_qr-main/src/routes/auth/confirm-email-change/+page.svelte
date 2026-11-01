<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  let submitting = $state(false);
  let done = $derived(form?.done || data.state === 'done');
  let newEmail = $derived(form?.newEmail || data.newEmail || '');
</script>

<svelte:head>
  <title>Confirm Email Change — GateQR</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="confirm-page">
  <div class="confirm-card">
    <div class="brand">
      <img src="/liceo-logo.png" alt="" width="44" height="44" />
      <div>
        <div class="brand-uni">Liceo de Cagayan University</div>
        <div class="brand-app">GateQR Account</div>
      </div>
    </div>

    {#if done}
      <div class="state-icon ok" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h1>Email changed</h1>
      <p class="lead">Your GateQR sign-in email is now <strong>{newEmail}</strong>. Sign in with the Google account of that email.</p>
      <a class="btn btn-primary" href="/login">Go to login</a>
    {:else if data.state === 'invalid'}
      <div class="state-icon warn" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h1>Link can't be used</h1>
      <p class="lead">{data.message}</p>
      <a class="btn btn-primary" href="/login">Go to login</a>
    {:else}
      <h1>Change your sign-in email?</h1>
      <p class="lead">Approve this only if you asked for it in GateQR Settings.</p>

      <dl class="details">
        <div><dt>Current</dt><dd>{data.oldEmail}</dd></div>
        <div><dt>New</dt><dd>{data.newEmail}</dd></div>
      </dl>
      <p class="note">After the change, only the Google account of the new email can sign in.</p>

      {#if form?.error}<p class="error">{form.error}</p>{/if}

      <form
        method="POST"
        class="actions"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <button class="btn btn-success" type="submit" disabled={submitting}>
          {submitting ? 'Changing...' : 'Yes, change my email'}
        </button>
        <a class="btn btn-ghost" href="/login">No, keep my current email</a>
      </form>
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
  .note {
    margin: 0 0 1rem;
    font-size: 0.82rem;
    color: #64748b;
  }
  .details {
    margin: 0 0 0.85rem;
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
    width: 70px;
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
  .btn-primary { background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%); color: #ffffff; border: 1px solid #D4AF37; }
  .btn-ghost { background: #ffffff; color: #475569; border: 1.5px solid #e2e8f0; }
</style>
