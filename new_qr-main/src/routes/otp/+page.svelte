<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";

  let email = $state("");
  let digits = $state(["", "", "", "", "", ""]);
  let otp = $derived(digits.join(""));
  
  let loading = $state(false);
  let isShuffling = $state(false);
  let isSuccess = $state(false);
  let shuffleDisplay = $state(["1", "2", "3", "4", "5", "6"]);
  let shuffleTimer: any = null;

  let resending = $state(false);
  let error = $state("");
  let successMsg = $state("");
  let resendCooldown = $state(0);
  let cooldownTimer: any = null;

  let inputRefs: HTMLInputElement[] = [];

  onMount(() => {
    email = $page.url.searchParams.get("email") || "";
    if (!email) {
      goto("/login");
    } else {
      // Focus first input box automatically
      setTimeout(() => {
        if (inputRefs[0]) inputRefs[0].focus();
      }, 100);
    }
  });

  onDestroy(() => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    if (shuffleTimer) clearInterval(shuffleTimer);
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

  function startShuffleAnimation() {
    isShuffling = true;
    shuffleDisplay = digits.map(d => d || String(Math.floor(Math.random() * 10)));
    if (shuffleTimer) clearInterval(shuffleTimer);
    shuffleTimer = setInterval(() => {
      shuffleDisplay = shuffleDisplay.map(() => String(Math.floor(Math.random() * 10)));
    }, 60);
  }

  function stopShuffleAnimation() {
    if (shuffleTimer) {
      clearInterval(shuffleTimer);
      shuffleTimer = null;
    }
    isShuffling = false;
  }

  async function handleVerify(e: any = null) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!email || otp.length < 6 || loading) return;

    loading = true;
    error = "";
    successMsg = "";
    startShuffleAnimation();

    const startTime = Date.now();

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otp.trim() }),
      });

      const data = await res.json();
      
      // Ensure the circular shuffle plays briefly so the animation is visible, but snappy (~550ms min)
      const elapsed = Date.now() - startTime;
      const minAnimationDuration = 550;
      if (elapsed < minAnimationDuration) {
        await new Promise(resolve => setTimeout(resolve, minAnimationDuration - elapsed));
      }

      stopShuffleAnimation();

      if (res.ok) {
        isSuccess = true;
        successMsg = "Verified! Proceeding to application form...";
        setTimeout(() => {
          goto(data.redirectUrl || "/status");
        }, 650);
      } else {
        isSuccess = false;
        error = data.error || "Invalid verification code. Please check and try again.";
        // Reset focus to first box and select
        setTimeout(() => {
          if (inputRefs[0]) {
            inputRefs[0].focus();
            inputRefs[0].select();
          }
        }, 150);
      }
    } catch (err) {
      stopShuffleAnimation();
      isSuccess = false;
      error = "A network error occurred. Please check your connection.";
    } finally {
      if (!isSuccess) {
        loading = false;
      }
    }
  }

  function handleDigitInput(index: number, e: Event) {
    const input = e.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, "");

    if (val.length === 0) {
      digits[index] = "";
      return;
    }

    // If user pasted or typed multiple digits in one box
    if (val.length > 1) {
      const chars = val.split("");
      for (let i = 0; i < 6 && index + i < 6; i++) {
        if (chars[i]) digits[index + i] = chars[i];
      }
      const nextIdx = Math.min(5, index + chars.length);
      if (inputRefs[nextIdx]) inputRefs[nextIdx].focus();
      if (digits.every(d => d !== "")) {
        handleVerify();
      }
      return;
    }

    // Single digit input
    digits[index] = val;
    error = "";

    // Automatically shift to next box
    if (index < 5) {
      if (inputRefs[index + 1]) {
        inputRefs[index + 1].focus();
        inputRefs[index + 1].select();
      }
    } else if (index === 5 && digits.every(d => d !== "")) {
      // All 6 digits entered
      handleVerify();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent) {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        // Move to previous box if current is empty
        digits[index - 1] = "";
        if (inputRefs[index - 1]) inputRefs[index - 1].focus();
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
    const pastedText = e.clipboardData?.getData("text") || "";
    const cleanNumbers = pastedText.replace(/\D/g, "").slice(0, 6);
    if (!cleanNumbers) return;

    const chars = cleanNumbers.split("");
    for (let i = 0; i < 6; i++) {
      digits[i] = chars[i] || "";
    }

    const focusTarget = Math.min(chars.length, 5);
    if (inputRefs[focusTarget]) {
      inputRefs[focusTarget].focus();
    }

    if (cleanNumbers.length === 6) {
      handleVerify();
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
        digits = ["", "", "", "", "", ""];
        if (inputRefs[0]) inputRefs[0].focus();
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
    <div class="envelope-icon" class:pulse-icon={isShuffling}>
      {#if isSuccess}
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      {:else if isShuffling}
        <svg class="shuffle-spin-svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" stroke-dasharray="16 8" />
          <path d="M12 6v6l4 2" />
        </svg>
      {:else}
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
      {/if}
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
        <label for="digit-0" class="input-label">Enter 6-Digit Code</label>

        <!-- CIRCULAR SHUFFLE ANIMATION DISPLAY (Active when verifying) -->
        {#if isShuffling || isSuccess}
          <div class="circle-shuffle-stage" class:success-state={isSuccess}>
            <div class="orbit-glow-ring"></div>
            <div class="orbit-center-core">
              {#if isSuccess}
                <div class="core-check-icon">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              {:else}
                <div class="core-shuffling-text">VERIFYING</div>
              {/if}
            </div>

            <!-- 6 Orbiting Digit Nodes Shuffling in Circles -->
            <div class="orbit-carousel" class:orbit-converge={isSuccess}>
              {#each shuffleDisplay as char, idx}
                <div
                  class="orbit-node node-{idx}"
                  style="--node-deg: {idx * 60}deg; --node-delay: {idx * 0.08}s;"
                >
                  <span class="orbit-digit">{char}</span>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <!-- 6 INDIVIDUAL OTP INPUT BOXES (Standard Input Mode) -->
          <div class="otp-boxes-grid" onpaste={handlePaste} role="group" aria-label="6-digit verification code">
            {#each digits as digit, idx}
              <input
                id="digit-{idx}"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="1"
                value={digit}
                oninput={(e) => handleDigitInput(idx, e)}
                onkeydown={(e) => handleKeyDown(idx, e)}
                class="otp-box"
                class:has-val={digit !== ""}
                class:is-error={error !== ""}
                disabled={loading}
                autocomplete={idx === 0 ? "one-time-code" : "off"}
                bind:this={inputRefs[idx]}
                aria-label="Digit {idx + 1}"
              />
            {/each}
          </div>
        {/if}

        <span class="helper-text">
          {#if isShuffling}
            <span class="verifying-hint">Verifying your 6-digit security code...</span>
          {:else}
            Code expires in 5 minutes
          {/if}
        </span>
      </div>

      <button
        type="submit"
        class="verify-btn"
        class:btn-shuffling={isShuffling}
        class:btn-success={isSuccess}
        disabled={loading || otp.length < 6}
      >
        {#if isSuccess}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Verified! Opening Form...</span>
        {:else if isShuffling}
          <div class="shuffle-orb-loader"></div>
          <span>Validating Code...</span>
        {:else}
          <span>Confirm & Verify</span>
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
          disabled={resending || loading}
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
      rgba(74, 18, 30, 0.88) 0%,
      rgba(30, 8, 14, 0.94) 100%
    );
    z-index: 1;
  }

  @keyframes pulse {
    0% { opacity: 0.5; transform: scale(1); }
    100% { opacity: 0.9; transform: scale(1.15); }
  }

  .otp-card {
    background: rgba(255, 255, 255, 0.98);
    border-radius: var(--radius-2xl, 22px);
    padding: 2.25rem;
    width: 100%;
    max-width: 460px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(212, 175, 55, 0.35);
    position: relative;
    z-index: 10;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .envelope-icon {
    width: 68px;
    height: 68px;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    border: 3px solid #D4AF37;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #FDFBF7;
    margin-bottom: 0.85rem;
    box-shadow: 0 8px 18px rgba(107, 29, 47, 0.35);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .pulse-icon {
    transform: scale(1.08);
    border-color: #F59E0B;
    box-shadow: 0 0 24px rgba(212, 175, 55, 0.6);
  }

  .shuffle-spin-svg {
    animation: rotateSvg 2s linear infinite;
  }

  @keyframes rotateSvg {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .header-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 1.25rem;
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
    font-size: 1.55rem;
    font-weight: 800;
    color: #6B1D2F;
    letter-spacing: -0.02em;
    margin: 0;
  }

  .otp-main {
    font-size: 0.88rem;
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
    margin-top: 0.2rem;
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
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
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
    gap: 0.5rem;
    text-align: left;
    width: 100%;
  }

  .input-label {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #475569;
    text-align: center;
  }

  /* 6 INDIVIDUAL OTP INPUT BOXES */
  .otp-boxes-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.5rem;
    width: 100%;
    margin: 0.25rem 0;
  }

  .otp-box {
    width: 100%;
    height: 60px;
    text-align: center;
    font-size: 1.75rem;
    font-weight: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #6B1D2F;
    background: #FFFFFF;
    border: 2px solid #E2E8F0;
    border-radius: 12px;
    outline: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  }

  .otp-box:hover:not(:disabled) {
    border-color: #CBD5E1;
  }

  .otp-box:focus {
    border-color: #6B1D2F;
    background: #FFFAF7;
    box-shadow: 0 0 0 3px rgba(107, 29, 47, 0.15), 0 4px 10px rgba(107, 29, 47, 0.1);
    transform: translateY(-2px);
  }

  .otp-box.has-val {
    border-color: #D4AF37;
    background: #FFFDF9;
    color: #4A121E;
  }

  .otp-box.is-error {
    border-color: #EF4444;
    animation: shakeBox 0.35s ease-in-out;
  }

  @keyframes shakeBox {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    50% { transform: translateX(4px); }
    75% { transform: translateX(-2px); }
  }

  /* CIRCULAR SHUFFLE STAGE ANIMATION */
  .circle-shuffle-stage {
    position: relative;
    width: 100%;
    height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0.25rem 0;
  }

  .orbit-glow-ring {
    position: absolute;
    width: 125px;
    height: 125px;
    border-radius: 50%;
    border: 2px dashed rgba(212, 175, 55, 0.45);
    animation: spinRing 4s linear infinite;
    box-shadow: inset 0 0 20px rgba(212, 175, 55, 0.12), 0 0 25px rgba(212, 175, 55, 0.2);
  }

  @keyframes spinRing {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .orbit-center-core {
    position: absolute;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6B1D2F 0%, #4A121E 100%);
    border: 2px solid #D4AF37;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    box-shadow: 0 4px 14px rgba(107, 29, 47, 0.4);
    animation: pulseCore 1s ease-in-out infinite alternate;
  }

  @keyframes pulseCore {
    0% { transform: scale(0.96); box-shadow: 0 0 10px rgba(212, 175, 55, 0.3); }
    100% { transform: scale(1.04); box-shadow: 0 0 20px rgba(212, 175, 55, 0.7); }
  }

  .core-shuffling-text {
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #FDFBF7;
  }

  .core-check-icon {
    animation: popCheck 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }

  @keyframes popCheck {
    0% { transform: scale(0) rotate(-45deg); opacity: 0; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }

  /* The 6 nodes rotating in circles */
  .orbit-carousel {
    position: absolute;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    animation: shuffleOrbit 0.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes shuffleOrbit {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .orbit-converge {
    animation: convergeNodes 0.4s ease-out forwards !important;
  }

  @keyframes convergeNodes {
    0% { transform: scale(1) rotate(0deg); opacity: 1; }
    100% { transform: scale(0.2) rotate(180deg); opacity: 0; }
  }

  .orbit-node {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 34px;
    height: 34px;
    margin: -17px 0 0 -17px;
    background: #FFFFFF;
    border: 2px solid #D4AF37;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    /* Circular trigonometry placement: radius is 58px */
    transform: rotate(var(--node-deg)) translate(58px) rotate(calc(-1 * var(--node-deg)));
    animation: counterSpin 0.7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes counterSpin {
    0% { transform: rotate(var(--node-deg)) translate(58px) rotate(calc(-1 * var(--node-deg) - 0deg)); }
    100% { transform: rotate(var(--node-deg)) translate(58px) rotate(calc(-1 * var(--node-deg) - 360deg)); }
  }

  .orbit-digit {
    font-size: 1.05rem;
    font-weight: 800;
    color: #6B1D2F;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .verifying-hint {
    color: #D4AF37;
    font-weight: 700;
    animation: blinkText 1s ease-in-out infinite;
  }

  @keyframes blinkText {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
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
    border-radius: 12px;
    border: 1px solid #D4AF37;
    cursor: pointer;
    transition: all 0.25s ease;
    height: 52px;
    box-shadow: 0 4px 14px rgba(107, 29, 47, 0.25);
  }

  .verify-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #D4AF37 0%, #AA820A 100%);
    color: #1E293B;
    border-color: #AA820A;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(212, 175, 55, 0.38);
  }

  .verify-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-shuffling {
    background: linear-gradient(135deg, #4A121E 0%, #2A0910 100%) !important;
    border-color: #D4AF37 !important;
    color: #FDFBF7 !important;
  }

  .btn-success {
    background: linear-gradient(135deg, #16A34A 0%, #15803D 100%) !important;
    border-color: #86EFAC !important;
    color: #FFFFFF !important;
  }

  .shuffle-orb-loader {
    width: 18px;
    height: 18px;
    border: 2.5px solid rgba(212, 175, 55, 0.3);
    border-top-color: #D4AF37;
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .resend-section {
    margin-top: 1.25rem;
    padding-top: 1.1rem;
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
    margin-top: 1.1rem;
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
      padding: 1.75rem 1rem;
    }

    .otp-boxes-grid {
      gap: 0.35rem;
    }

    .otp-box {
      height: 52px;
      font-size: 1.45rem;
      border-radius: 9px;
    }

    .circle-shuffle-stage {
      height: 125px;
    }

    .orbit-carousel {
      width: 115px;
      height: 115px;
    }

    .orbit-node {
      width: 30px;
      height: 30px;
      margin: -15px 0 0 -15px;
      transform: rotate(var(--node-deg)) translate(50px) rotate(calc(-1 * var(--node-deg)));
    }
  }
</style>
