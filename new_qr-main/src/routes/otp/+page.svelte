<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  let email = $state("");
  let otp = $state("");
  let loading = $state(false);
  let resending = $state(false);
  let error = $state("");
  let successMsg = $state("");
  let resendCooldown = $state(0);
  let cooldownTimer: any = null;

  onMount(() => {
    email = $page.url.searchParams.get("email") || "";
    if (!email) {
      goto("/login");
    }
  });

  function startCooldown(seconds = 60) {
    resendCooldown = seconds;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      resendCooldown -= 1;
      if (resendCooldown <= 0) {
        clearInterval(cooldownTimer);
      }
    }, 1000);
  }

  async function handleVerify(e: Event) {
    e.preventDefault();
    if (!email || !otp) return;

    loading = true;
    error = "";
    successMsg = "";

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otp.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        successMsg = "Email verified! Access granted...";
        setTimeout(() => {
          goto(data.redirectUrl || "/status");
        }, 800);
      } else {
        error = data.error || "Invalid verification code. Please check and try again.";
      }
    } catch (err) {
      error = "A network error occurred. Please check your connection.";
    } finally {
      if (!successMsg) {
        loading = false;
      }
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending || !email) return;

    resending = true;
    error = "";
    successMsg = "";

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (res.ok) {
        successMsg = "A new 6-digit verification code has been sent to your email!";
        startCooldown(60);
      } else {
        error = data.error || "Failed to resend code. Please try again.";
      }
    } catch (err) {
      error = "A network error occurred while resending. Please try again.";
    } finally {
      resending = false;
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    // Keep only numbers and max 6 chars
    otp = target.value.replace(/\D/g, "").slice(0, 6);
  }
</script>

<svelte:head>
  <title>Verify Email — GateQR | Liceo de Cagayan University</title>
  <meta
    name="description"
    content="Verify your applicant email address with a 6-digit OTP code to continue your vehicle sticker application."
  />
</svelte:head>

<div class="otp-page">
  <div class="bg-glow"></div>
  <div class="bg-image"></div>
  <div class="bg-overlay"></div>

  <div class="otp-card">
    <div class="envelope-icon">
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
      </svg>
    </div>

    <div class="header-text">
      <span class="sub-badge">APPLICANT VERIFICATION</span>
      <h1 class="otp-title">Verify Your Email</h1>
      <p class="otp-main">
        We sent a 6-digit verification code to
        <span class="user-email">{email}</span>
        to confirm your email is active.
      </p>
    </div>

    <form class="otp-form" onsubmit={handleVerify}>
      {#if error}
        <div class="alert alert-error">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{error}</span>
        </div>
      {/if}

      {#if successMsg}
        <div class="alert alert-success">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>{successMsg}</span>
        </div>
      {/if}

      <div class="field-group">
        <label for="otp-input" class="input-label">Enter 6-Digit Code</label>
        <input
          id="otp-input"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          value={otp}
          oninput={handleInput}
          placeholder="••••••"
          maxlength="6"
          required
          class="otp-input"
          disabled={loading}
          autocomplete="one-time-code"
          autofocus
        />
        <span class="helper-text">Code expires in 5 minutes</span>
      </div>

      <button
        type="submit"
        class="verify-btn"
        disabled={loading || otp.length < 6}
      >
        {#if loading}
          <div class="spinner"></div>
          <span>Verifying...</span>
        {:else}
          <span>Verify & Continue</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        {/if}
      </button>
    </form>

    <div class="resend-section">
      <p class="resend-text">Didn't receive the verification email?</p>
      {#if resendCooldown > 0}
        <span class="cooldown-badge">Resend available in {resendCooldown}s</span>
      {:else}
        <button
          type="button"
          class="resend-btn"
          onclick={handleResend}
          disabled={resending}
        >
          {resending ? "Sending new code..." : "Resend Verification Code"}
        </button>
      {/if}
    </div>

    <div class="card-footer">
      <a href="/login" class="back-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        <span>Change Email / Back to Sign In</span>
      </a>
    </div>
  </div>
</div>

<style>
  .otp-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xl);
    position: relative;
    overflow: hidden;
    background: #4A121E;
    font-family: inherit;
  }

  .bg-glow {
    position: absolute;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(212, 175, 55, 0.2) 0%, transparent 70%);
    bottom: -150px;
    left: -150px;
    pointer-events: none;
    animation: pulse 5s ease-in-out infinite alternate;
    z-index: 2;
  }

  .bg-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image: url("/rodelsa-image.png");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    z-index: 0;
  }

  .bg-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      180deg,
      rgba(74, 18, 30, 0.85) 0%,
      rgba(30, 8, 14, 0.9) 100%
    );
    z-index: 1;
  }

  @keyframes pulse {
    0% { opacity: 0.5; transform: scale(1); }
    100% { opacity: 0.9; transform: scale(1.15); }
  }

  .otp-card {
    background: rgba(255, 255, 255, 0.97);
    border-radius: var(--radius-2xl, 20px);
    padding: 2.5rem;
    width: 100%;
    max-width: 440px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(212, 175, 55, 0.3);
    position: relative;
    z-index: 10;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .envelope-icon {
    width: 72px;
    height: 72px;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    border: 3px solid #D4AF37;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #FDFBF7;
    margin-bottom: 1rem;
    box-shadow: 0 8px 16px rgba(107, 29, 47, 0.35);
  }

  .header-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 1.5rem;
  }

  .sub-badge {
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    color: #92400E;
    background: #FEF3C7;
    padding: 0.2rem 0.65rem;
    border-radius: 9999px;
    border: 1px solid rgba(212, 175, 55, 0.4);
  }

  .otp-title {
    font-size: 1.6rem;
    font-weight: 800;
    color: #6B1D2F;
    letter-spacing: -0.02em;
    margin: 0;
  }

  .otp-main {
    font-size: 0.9rem;
    color: #64748B;
    line-height: 1.5;
    margin: 0;
    padding: 0 0.5rem;
  }

  .user-email {
    display: block;
    color: #6B1D2F;
    font-weight: 700;
    word-break: break-all;
    margin-top: 0.25rem;
  }

  .otp-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: 100%;
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: left;
  }

  .alert-error {
    color: #991B1B;
    background: #FEF2F2;
    border: 1px solid #FCA5A5;
  }

  .alert-success {
    color: #166534;
    background: #F0FDF4;
    border: 1px solid #86EFAC;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-align: left;
  }

  .input-label {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #475569;
  }

  .otp-input {
    text-align: center;
    font-size: 2rem;
    letter-spacing: 0.75rem;
    padding: 0.75rem 1rem;
    border: 2px solid #E2E8F0;
    border-radius: 12px;
    outline: none;
    background: #FFFFFF;
    color: #1E293B;
    font-weight: 800;
    font-family: monospace;
    transition: all 0.2s ease;
    height: 60px;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.04);
  }

  .otp-input:focus {
    border-color: #6B1D2F;
    box-shadow: 0 0 0 4px rgba(107, 29, 47, 0.12), inset 0 2px 4px rgba(0, 0, 0, 0.02);
  }

  .helper-text {
    font-size: 0.75rem;
    color: #94A3B8;
    text-align: center;
    margin-top: 0.2rem;
  }

  .verify-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.85rem 1.5rem;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    color: #FFFFFF;
    font-size: 0.95rem;
    font-weight: 700;
    border-radius: 10px;
    border: 1px solid #D4AF37;
    cursor: pointer;
    transition: all 0.25s ease;
    height: 50px;
    box-shadow: 0 4px 12px rgba(107, 29, 47, 0.25);
  }

  .verify-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #D4AF37 0%, #AA820A 100%);
    color: #1E293B;
    border-color: #AA820A;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(212, 175, 55, 0.35);
  }

  .verify-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .resend-section {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid #F1F5F9;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
  }

  .resend-text {
    font-size: 0.82rem;
    color: #64748B;
    margin: 0;
  }

  .resend-btn {
    background: none;
    border: none;
    color: #6B1D2F;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    text-decoration: underline;
    text-underline-offset: 3px;
    transition: color 0.2s ease;
  }

  .resend-btn:hover:not(:disabled) {
    color: #D4AF37;
  }

  .cooldown-badge {
    font-size: 0.8rem;
    color: #94A3B8;
    font-weight: 600;
  }

  .card-footer {
    margin-top: 1.25rem;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: #64748B;
    text-decoration: none;
    font-weight: 600;
    transition: color 0.2s ease;
  }

  .back-link:hover {
    color: #6B1D2F;
  }

  @media (max-width: 480px) {
    .otp-card {
      padding: 1.75rem 1.25rem;
    }

    .otp-input {
      font-size: 1.6rem;
      letter-spacing: 0.5rem;
      height: 52px;
    }
  }
</style>
