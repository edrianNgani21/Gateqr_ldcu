<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy, tick } from "svelte";

  // How long the "Verified" state stays on screen before moving on
  const SUCCESS_HOLD_MS = 1500;

  let email = $state("");
  let digits = $state(["", "", "", "", "", ""]);
  let otp = $derived(digits.join(""));

  let loading = $state(false);
  let isSuccess = $state(false);
  let shaking = $state(false);

  let resending = $state(false);
  let error = $state("");
  let notice = $state("");
  let resendCooldown = $state(0);
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;
  let redirectTimer: ReturnType<typeof setTimeout> | null = null;

  let inputRefs: HTMLInputElement[] = [];

  onMount(() => {
    email = $page.url.searchParams.get("email") || "";
    if (!email) {
      goto("/login");
    } else {
      setTimeout(() => inputRefs[0]?.focus(), 100);
    }
  });

  onDestroy(() => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    if (redirectTimer) clearTimeout(redirectTimer);
  });

  function startCooldown(seconds = 60) {
    resendCooldown = seconds;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      resendCooldown -= 1;
      if (resendCooldown <= 0 && cooldownTimer) clearInterval(cooldownTimer);
    }, 1000);
  }

  async function shake() {
    shaking = false;
    await tick();
    shaking = true;
    setTimeout(() => (shaking = false), 450);
  }

  async function showError(message: string) {
    error = message;
    loading = false;
    shake();
    // Keep the digits so one wrong digit can be fixed; select the last box
    await tick();
    inputRefs[5]?.focus();
    inputRefs[5]?.select();
  }

  async function handleVerify(e: Event | null = null) {
    e?.preventDefault();
    if (!email || otp.length < 6 || loading || isSuccess) return;

    loading = true;
    error = "";
    notice = "";

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        isSuccess = true;
        (document.activeElement as HTMLElement | null)?.blur();
        redirectTimer = setTimeout(() => {
          goto(data.redirectUrl || "/status");
        }, SUCCESS_HOLD_MS);
      } else {
        showError(data.error || "Invalid code. Please check and try again.");
      }
    } catch {
      showError("Network error. Please check your connection.");
    }
  }

  function handleDigitInput(index: number, e: Event) {
    const input = e.target as HTMLInputElement;
    let val = input.value.replace(/\D/g, "");

    if (val.length === 0) {
      digits[index] = "";
      input.value = "";
      return;
    }

    error = "";

    // Typing over a filled box: keep only the newly typed digit
    if (val.length === 2 && digits[index]) {
      val = val[0] === digits[index] ? val[1] : val[0];
    }

    // Pasted, autofilled, or typed faster than focus moved: spread digits across the boxes
    if (val.length > 1) {
      const chars = val.split("");
      for (let i = 0; i < 6 && index + i < 6; i++) {
        if (chars[i]) digits[index + i] = chars[i];
      }
      input.value = digits[index];
      const nextIdx = Math.min(5, index + chars.length);
      inputRefs[nextIdx]?.focus();
      if (digits.every((d) => d !== "")) handleVerify();
      return;
    }

    // Submit once the row becomes complete, or when the last box is typed.
    // Fixing one digit in an already full row waits for the Verify button.
    const rowWasIncomplete = digits.some((d) => d === "");
    digits[index] = val;
    input.value = val;

    if (digits.every((d) => d !== "") && (rowWasIncomplete || index === 5)) {
      handleVerify();
    } else if (index < 5) {
      inputRefs[index + 1]?.focus();
      inputRefs[index + 1]?.select();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent) {
    if (e.key === "Backspace") {
      error = "";
      if (!digits[index] && index > 0) {
        digits[index - 1] = "";
        inputRefs[index - 1]?.focus();
        e.preventDefault();
      } else {
        digits[index] = "";
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs[index - 1].focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputRefs[index + 1].focus();
      e.preventDefault();
    }
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    if (loading || isSuccess) return;
    const cleanNumbers = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!cleanNumbers) return;

    error = "";
    const chars = cleanNumbers.split("");
    for (let i = 0; i < 6; i++) digits[i] = chars[i] || "";

    inputRefs[Math.min(chars.length, 5)]?.focus();
    if (cleanNumbers.length === 6) handleVerify();
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending || loading || !email) return;

    resending = true;
    error = "";
    notice = "";

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notice = "A new code has been sent.";
        digits = ["", "", "", "", "", ""];
        inputRefs[0]?.focus();
        startCooldown(60);
      } else {
        error = data.error || "Could not resend the code. Please try again.";
      }
    } catch {
      error = "Network error. Please try again.";
    } finally {
      resending = false;
    }
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
    <div class="seal-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
      </svg>
    </div>

    <h1 class="otp-title">Verify your email</h1>
    <p class="otp-sub">Code sent to <span class="user-email">{email}</span></p>

    <form class="otp-form" onsubmit={handleVerify}>
      <div class="code-stage" class:is-success={isSuccess}>
        <div
          class="otp-boxes-grid"
          class:is-checking={loading && !isSuccess}
          class:shake={shaking}
          onpaste={handlePaste}
          role="group"
          aria-label="6-digit verification code"
          aria-hidden={isSuccess}
        >
          {#each digits as digit, idx}
            <input
              id="digit-{idx}"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              value={digit}
              oninput={(e) => handleDigitInput(idx, e)}
              onkeydown={(e) => handleKeyDown(idx, e)}
              onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
              class="otp-box"
              class:has-val={digit !== ""}
              class:is-error={error !== ""}
              style="--i: {idx}"
              disabled={loading || isSuccess}
              autocomplete={idx === 0 ? "one-time-code" : "off"}
              bind:this={inputRefs[idx]}
              aria-label="Digit {idx + 1}"
            />
          {/each}
          <span class="sweep" aria-hidden="true"></span>
        </div>

        {#if isSuccess}
          <div class="verified-panel" role="status" aria-live="polite">
            <svg class="verified-mark" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
              <circle class="mark-ring" cx="26" cy="26" r="23" fill="none" />
              <path class="mark-check" fill="none" d="M15 27 l7.5 7.5 L37 19" />
            </svg>
            <div class="verified-text">
              <span class="verified-title">Verified</span>
              <span class="verified-sub">Proceeding to your application…</span>
            </div>
          </div>
        {/if}
      </div>

      <p class="status-line" class:is-error={error !== ""} aria-live="polite">
        {#if error}
          {error}
        {:else if notice}
          {notice}
        {/if}
      </p>

      <button
        type="submit"
        class="verify-btn"
        class:is-hidden={isSuccess}
        disabled={loading || isSuccess || otp.length < 6}
      >
        {#if loading && !isSuccess}
          <span class="btn-loader" aria-hidden="true"></span>
          <span>Checking…</span>
        {:else}
          <span>Verify</span>
        {/if}
      </button>
    </form>

    <div class="links-row" class:is-hidden={isSuccess}>
      {#if resendCooldown > 0}
        <span class="muted">Resend in {resendCooldown}s</span>
      {:else}
        <button
          type="button"
          class="link-btn"
          onclick={handleResend}
          disabled={resending || loading}
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      {/if}
      <span class="dot" aria-hidden="true">·</span>
      <a href="/login" class="link-btn">Change email</a>
    </div>
  </div>
</div>

<style>
  .otp-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xl, 1.5rem);
    position: relative;
    overflow: hidden;
    background: #4A121E;
    font-family: inherit;
  }

  .bg-glow {
    position: absolute;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(212, 175, 55, 0.25) 0%, transparent 70%);
    bottom: -150px;
    left: -150px;
    pointer-events: none;
    animation: pulse 5s ease-in-out infinite alternate;
    z-index: 2;
  }

  .bg-image {
    position: absolute;
    inset: 0;
    background-image: url("/rodelsa-image.png");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    z-index: 0;
  }

  .bg-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(74, 18, 30, 0.88) 0%, rgba(30, 8, 14, 0.94) 100%);
    z-index: 1;
  }

  @keyframes pulse {
    0% { opacity: 0.5; transform: scale(1); }
    100% { opacity: 0.9; transform: scale(1.15); }
  }

  .otp-card {
    background: rgba(255, 255, 255, 0.98);
    border-radius: var(--radius-2xl, 22px);
    padding: 2.25rem 2rem 1.75rem;
    width: 100%;
    max-width: 420px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(212, 175, 55, 0.35);
    position: relative;
    z-index: 10;
  }

  .seal-icon {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    border: 3px solid #D4AF37;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #FDFBF7;
    margin-bottom: 1rem;
    box-shadow: 0 8px 18px rgba(107, 29, 47, 0.35);
  }

  .otp-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: #6B1D2F;
    letter-spacing: -0.02em;
    margin: 0 0 0.3rem;
  }

  .otp-sub {
    font-size: 0.88rem;
    color: #64748B;
    margin: 0 0 1.5rem;
    word-break: break-all;
  }

  .user-email {
    color: #6B1D2F;
    font-weight: 700;
  }

  .otp-form {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* CODE AREA: boxes and the verified panel share the same space */
  .code-stage {
    position: relative;
    width: 100%;
    height: 64px;
    overflow: hidden;
  }

  .otp-boxes-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.5rem;
    width: 100%;
    height: 60px;
  }

  .otp-box {
    width: 100%;
    min-width: 0;
    height: 56px;
    /* The global input[type="text"] rule adds side padding that clipped the digit in narrow boxes */
    padding: 0;
    line-height: normal;
    -webkit-text-fill-color: currentColor;
    caret-color: #6B1D2F;
    text-align: center;
    font-size: 1.65rem;
    font-weight: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #6B1D2F;
    background: #FFFFFF;
    border: 2px solid #E2E8F0;
    border-radius: 12px;
    outline: none;
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  }

  .otp-box:hover:not(:disabled) {
    border-color: #CBD5E1;
  }

  .otp-box:focus {
    border-color: #6B1D2F;
    background: #FFFAF7;
    box-shadow: 0 0 0 3px rgba(107, 29, 47, 0.15);
  }

  .otp-box.has-val {
    border-color: #D4AF37;
    background: #FFFDF9;
    color: #4A121E;
  }

  .otp-box:disabled {
    opacity: 1;
    cursor: default;
  }

  .otp-box.is-error {
    border-color: #EF4444;
    background: #FEF2F2;
    color: #991B1B;
  }

  .shake {
    animation: shakeRow 0.4s ease-in-out;
  }

  @keyframes shakeRow {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(3px); }
  }

  /* While the server checks: boxes lock and a thin gold line sweeps underneath */
  .sweep {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: 30%;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, #D4AF37, transparent);
    opacity: 0;
    pointer-events: none;
  }

  .is-checking .sweep {
    opacity: 1;
    animation: sweep 1s ease-in-out infinite;
  }

  .is-checking .otp-box {
    border-color: #E9D9A6;
    color: #6B1D2F;
  }

  @keyframes sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(340%); }
  }

  /* SUCCESS: digits slide out to the right one after another */
  .is-success .otp-box {
    animation: slideOut 0.42s cubic-bezier(0.55, 0, 0.75, 0.2) forwards;
    animation-delay: calc((5 - var(--i)) * 55ms);
    border-color: #D4AF37;
  }

  @keyframes slideOut {
    0% { transform: translateX(0); opacity: 1; }
    100% { transform: translateX(260%); opacity: 0; }
  }

  .verified-panel {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    opacity: 0;
    animation: panelIn 0.35s ease-out 0.55s forwards;
  }

  @keyframes panelIn {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .verified-mark {
    flex-shrink: 0;
  }

  .mark-ring {
    stroke: #15803D;
    stroke-width: 2.5;
    stroke-dasharray: 145;
    stroke-dashoffset: 145;
    transform: rotate(-90deg);
    transform-origin: center;
    animation: draw 0.5s ease-out 0.6s forwards;
  }

  .mark-check {
    stroke: #15803D;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 34;
    stroke-dashoffset: 34;
    animation: draw 0.3s ease-out 1s forwards;
  }

  @keyframes draw {
    to { stroke-dashoffset: 0; }
  }

  .verified-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }

  .verified-title {
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: #14532D;
    line-height: 1.2;
  }

  .verified-sub {
    font-size: 0.8rem;
    color: #64748B;
    font-weight: 600;
  }

  .status-line {
    min-height: 1.2rem;
    margin: 0.6rem 0 0.9rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #15803D;
  }

  .status-line.is-error {
    color: #B91C1C;
  }

  .verify-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 50px;
    padding: 0 1.5rem;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    color: #FFFFFF;
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    border-radius: 12px;
    border: 1px solid #D4AF37;
    cursor: pointer;
    transition: background 0.25s ease, color 0.25s ease, opacity 0.3s ease, transform 0.25s ease;
    box-shadow: 0 4px 14px rgba(107, 29, 47, 0.25);
  }

  .verify-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #D4AF37 0%, #AA820A 100%);
    color: #1E293B;
    transform: translateY(-1px);
  }

  .verify-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-loader {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(212, 175, 55, 0.3);
    border-top-color: #D4AF37;
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .is-hidden {
    opacity: 0 !important;
    visibility: hidden;
    transition: opacity 0.3s ease, visibility 0s linear 0.3s;
  }

  .links-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid #F1F5F9;
    width: 100%;
    font-size: 0.83rem;
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0.2rem 0.25rem;
    color: #6B1D2F;
    font-size: inherit;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .link-btn:hover:not(:disabled) {
    color: #AA820A;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .link-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .muted {
    color: #94A3B8;
    font-weight: 600;
  }

  .dot {
    color: #CBD5E1;
  }

  @media (max-width: 480px) {
    .otp-page {
      padding: 1rem;
    }

    .otp-card {
      padding: 1.75rem 1rem 1.5rem;
    }

    .otp-boxes-grid {
      gap: 0.35rem;
    }

    .otp-box {
      height: 52px;
      font-size: 1.45rem;
      border-radius: 9px;
    }
  }

  @media (max-width: 360px) {
    .otp-boxes-grid {
      gap: 0.25rem;
    }

    .otp-box {
      height: 46px;
      font-size: 1.25rem;
    }
  }

  /* Reduced motion: digits fade instead of sliding, check appears without drawing, no shake */
  @media (prefers-reduced-motion: reduce) {
    .bg-glow,
    .shake,
    .is-checking .sweep {
      animation: none;
    }

    .is-checking .sweep {
      width: 100%;
      transform: none;
      background: #D4AF37;
      opacity: 0.6;
    }

    .is-success .otp-box {
      animation: fadeOut 0.25s linear forwards;
      animation-delay: 0s;
    }

    @keyframes fadeOut {
      to { opacity: 0; }
    }

    .verified-panel {
      animation: fadeIn 0.25s linear 0.25s forwards;
    }

    @keyframes fadeIn {
      to { opacity: 1; }
    }

    .mark-ring,
    .mark-check {
      animation: none;
      stroke-dashoffset: 0;
    }

    .verify-btn:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
