<script lang="ts">
  import { goto } from "$app/navigation";

  // First to show is "apply" as requested: "the first to show is the Apply For Sticker"
  let activeMode = $state<'apply' | 'admin'>('apply');

  // Admin Login state
  let adminEmail = $state("");
  let adminPassword = $state("");
  let showPassword = $state(false);

  // Applicant Apply for Sticker state
  let applicantEmail = $state("");
  let alreadyRegisteredNotice = $state("");

  let loading = $state(false);
  let error = $state("");

  function switchMode(mode: 'apply' | 'admin') {
    activeMode = mode;
    error = "";
    alreadyRegisteredNotice = "";
  }

  // Handle Admin Login
  async function handleAdminLogin(e: Event) {
    e.preventDefault();
    if (!adminEmail || !adminPassword) return;

    loading = true;
    error = "";

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });

      const data = await res.json();
      if (res.ok) {
        goto(data.redirectUrl || "/osa");
      } else {
        error = data.error || "Invalid credentials. Please try again.";
      }
    } catch (err) {
      error = "A network error occurred. Please check your connection.";
    } finally {
      loading = false;
    }
  }

  // Handle Apply for Sticker / Register / Check Status
  async function handleApplicantRegister(e: Event) {
    e.preventDefault();
    if (!applicantEmail) return;

    loading = true;
    error = "";
    alreadyRegisteredNotice = "";

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: applicantEmail }),
      });

      const data = await res.json();
      if (res.ok) {
        if (data.requiresOtp) {
          goto(`/otp?email=${encodeURIComponent(applicantEmail.trim().toLowerCase())}`);
        } else if (data.hasExistingApplication || data.redirectUrl === "/status") {
          alreadyRegisteredNotice = "Already completed registration — redirecting to your application status...";
          setTimeout(() => {
            goto("/status");
          }, 1200);
        } else {
          goto(data.redirectUrl || "/");
        }
      } else {
        error = data.error || "Failed to proceed. Please try again.";
      }
    } catch (err) {
      error = "A network error occurred. Please check your connection.";
    } finally {
      if (!alreadyRegisteredNotice) {
        loading = false;
      }
    }
  }
</script>

<svelte:head>
  <title>GateQR — Liceo de Cagayan University | Apply Sticker & Sign In</title>
  <meta
    name="description"
    content="Apply for a vehicle sticker for gate pass or sign in to GateQR at Liceo de Cagayan University."
  />
</svelte:head>

<div class="login-page">
  <!-- Dynamic Maroon & Red-Gold Background Particles & Ambient Lighting -->
  <div class="bg-glow glow-top-left"></div>
  <div class="bg-glow glow-bottom-right"></div>
  <div class="bg-poly-texture"></div>

  <!-- Main Card Container Matching Screenshot Composition -->
  <div class="split-card">
    <!-- FORM SIDE (White Area on the left) -->
    <div class="card-form-side">
      {#if activeMode === 'apply'}
        <!-- VIEW 1: APPLY FOR STICKER (FIRST TO SHOW) -->
        <div class="form-header">
          <div class="header-badge">Gate Pass Portal</div>
          <h1 class="main-form-title">Apply For Sticker</h1>
          <p class="main-form-subtitle">
            Enter your university email to apply for a vehicle gate pass sticker or track your status.
          </p>
        </div>

        {#if error}
          <div class="alert-box alert-error">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{error}</span>
          </div>
        {/if}

        {#if alreadyRegisteredNotice}
          <div class="alert-box alert-success">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{alreadyRegisteredNotice}</span>
          </div>
        {/if}

        <form class="auth-form" onsubmit={handleApplicantRegister}>
          <div class="input-group">
            <label for="applicant-email" class="input-label">Applicant Email</label>
            <div class="input-field-wrap">
              <svg class="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input
                id="applicant-email"
                type="email"
                inputmode="email"
                bind:value={applicantEmail}
                placeholder="e.g. yourname@liceo.edu.ph"
                autocomplete="email"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div class="form-action-row">
            <button type="submit" class="btn-primary-pill" disabled={loading}>
              <span>{loading ? "Processing..." : "APPLY FOR STICKER"}</span>
              {#if !loading}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              {/if}
            </button>
          </div>
        </form>

        <!-- Divider with Switch Button Below for Admin Login -->
        <div class="switch-section">
          <div class="divider-line">
            <span>OR</span>
          </div>
          <button
            type="button"
            class="btn-admin-switch"
            onclick={() => switchMode('admin')}
          >
            <div class="switch-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="switch-label-group">
              <span class="switch-primary">Admin Login</span>
              <span class="switch-secondary">Sign in for Security, OSA & Deans</span>
            </div>
            <svg class="switch-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      {:else}
        <!-- VIEW 2: ADMIN LOGIN (REPLACES THE WHOLE LOGIN FORM) -->
        <div class="form-header">
          <div class="header-badge admin-badge">Administrator Access</div>
          <h1 class="main-form-title">Admin Login</h1>
          <p class="main-form-subtitle">
            Enter your institutional administrator or officer credentials to access the dashboard.
          </p>
        </div>

        {#if error}
          <div class="alert-box alert-error">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{error}</span>
          </div>
        {/if}

        <form class="auth-form" onsubmit={handleAdminLogin}>
          <div class="input-group">
            <label for="admin-email" class="input-label">Admin Email</label>
            <div class="input-field-wrap">
              <svg class="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input
                id="admin-email"
                type="email"
                inputmode="email"
                bind:value={adminEmail}
                placeholder="e.g. admin@liceo.edu.ph"
                autocomplete="email"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div class="input-group">
            <label for="admin-password" class="input-label">Password</label>
            <div class="input-field-wrap">
              <svg class="field-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                bind:value={adminPassword}
                placeholder="Enter your password"
                autocomplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                class="btn-pwd-toggle"
                onclick={() => showPassword = !showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {#if showPassword}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          <div class="form-action-row">
            <button type="submit" class="btn-primary-pill" disabled={loading}>
              <span>{loading ? "Signing in..." : "LOG IN AS ADMIN"}</span>
              {#if !loading}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              {/if}
            </button>
          </div>
        </form>

        <!-- Divider with Switch Button Back to Apply for Sticker -->
        <div class="switch-section">
          <div class="divider-line">
            <span>OR</span>
          </div>
          <button
            type="button"
            class="btn-admin-switch"
            onclick={() => switchMode('apply')}
          >
            <div class="switch-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </div>
            <div class="switch-label-group">
              <span class="switch-primary">Apply for Sticker</span>
              <span class="switch-secondary">Return to applicant gate pass request</span>
            </div>
            <svg class="switch-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      {/if}
    </div>

    <!-- HERO SIDE (Diagonal Polygonal Cut with Rodelsa Image & Maroon-Gold Theme) -->
    <div class="card-hero-side">
      <!-- Image Layer using the existing rodelsa-image.png -->
      <div class="hero-image-bg"></div>

      <!-- Crystal / Poly Overlay with Maroon & Red-Gold Gradients -->
      <div class="hero-poly-overlay"></div>

      <!-- Content within the Hero Banner -->
      <div class="hero-content">
        <div class="hero-logo-wrap">
          <img src="/liceo-logo.png" alt="Liceo de Cagayan University" class="hero-logo" />
        </div>

        <div class="hero-text-block">
          <span class="hero-tagline-pill">OFFICIAL GATE PASS PORTAL</span>
          <h2 class="hero-title">GateQR</h2>
          <p class="hero-university">Liceo de Cagayan University</p>
          
          <div class="hero-highlight-card">
            <div class="highlight-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <circle cx="17.5" cy="17.5" r="2.5"/>
              </svg>
            </div>
            <div class="highlight-info">
              <span class="highlight-title">Apply Sticker for Gate Pass</span>
            </div>
          </div>
        </div>

        <div class="hero-footer-note">
          <span>Office of Student Affairs &bull; Safety &amp; Security Office</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Page Layout & Maroon-Gold Theme ────────────────────────────────────────── */
  .login-page {
    min-height: 100vh;
    min-height: 100dvh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(1rem, 3vh, 2.5rem) clamp(0.75rem, 2vw, 1.5rem);
    background: radial-gradient(circle at 15% 20%, #4a0e1c 0%, #300812 45%, #180309 100%);
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
    overflow: hidden;
    max-width: 100vw;
    touch-action: pan-y;
    font-family: inherit;
    box-sizing: border-box;
  }

  /* Shimmering Gold Ambient Glows */
  .bg-glow {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    z-index: 1;
    filter: blur(80px);
  }

  .glow-top-left {
    width: min(500px, 80vw);
    height: min(500px, 80vw);
    background: radial-gradient(circle, rgba(233, 194, 94, 0.18) 0%, rgba(139, 26, 60, 0.25) 50%, transparent 70%);
    top: -120px;
    left: -120px;
    animation: pulse-glow 6s ease-in-out infinite alternate;
  }

  .glow-bottom-right {
    width: min(600px, 90vw);
    height: min(600px, 90vw);
    background: radial-gradient(circle, rgba(212, 166, 42, 0.15) 0%, rgba(107, 26, 42, 0.35) 60%, transparent 70%);
    bottom: -160px;
    right: -120px;
    animation: pulse-glow 7s ease-in-out infinite alternate-reverse;
  }

  .bg-poly-texture {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(240, 207, 114, 0.08) 1px, transparent 1px);
    background-size: 32px 32px;
    opacity: 0.6;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes pulse-glow {
    0% { transform: scale(1) translate(0, 0); opacity: 0.7; }
    100% { transform: scale(1.12) translate(20px, 15px); opacity: 1; }
  }

  /* ── Split Card Container (Matches Screenshot Layout) ────────────────────────── */
  .split-card {
    position: relative;
    z-index: 10;
    width: 100%;
    min-width: 0;
    max-width: min(1040px, 100%);
    min-height: 560px;
    background: #ffffff;
    border-radius: 28px;
    box-shadow:
      0 25px 60px -12px rgba(0, 0, 0, 0.65),
      0 0 0 1px rgba(255, 255, 255, 0.15);
    display: flex;
    overflow: hidden;
    margin: auto 0;
  }

  /* ── Form Side (Left Portion) ────────────────────────────────────────────────── */
  .card-form-side {
    flex: 1 1 52%;
    max-width: 55%;
    padding: 3.25rem 3.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    background: #ffffff;
    z-index: 2;
    box-sizing: border-box;
  }

  .form-header {
    margin-bottom: 1.75rem;
  }

  .header-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: rgba(107, 26, 42, 0.08);
    color: #6b1a2a;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-radius: 999px;
    margin-bottom: 0.75rem;
    border: 1px solid rgba(107, 26, 42, 0.15);
  }

  .header-badge.admin-badge {
    background: rgba(184, 134, 11, 0.12);
    color: #92690d;
    border-color: rgba(184, 134, 11, 0.25);
  }

  .main-form-title {
    font-size: 2.15rem;
    font-weight: 800;
    color: #1e293b;
    letter-spacing: -0.03em;
    margin: 0 0 0.45rem 0;
    line-height: 1.15;
  }

  .main-form-subtitle {
    font-size: 0.92rem;
    color: #64748b;
    margin: 0;
    line-height: 1.5;
  }

  /* ── Form Inputs & Controls ────────────────────────────────────────────────── */
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .input-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #475569;
    letter-spacing: 0.02em;
  }

  .input-field-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .field-icon {
    position: absolute;
    left: 1rem;
    color: #94a3b8;
    pointer-events: none;
    transition: color 0.2s;
  }

  .input-field-wrap input {
    width: 100%;
    height: 50px;
    padding: 0 1rem 0 2.85rem;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    font-size: 1rem;
    font-family: inherit;
    color: #0f172a;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
  }

  .input-field-wrap input:focus {
    background: #ffffff;
    border-color: #6b1a2a;
    box-shadow: 0 0 0 4px rgba(107, 26, 42, 0.12);
    outline: none;
  }

  .input-field-wrap input:focus + .field-icon,
  .input-field-wrap:focus-within .field-icon {
    color: #6b1a2a;
  }

  .btn-pwd-toggle {
    position: absolute;
    right: 0.85rem;
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 0.35rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: color 0.2s;
  }

  .btn-pwd-toggle:hover {
    color: #6b1a2a;
  }

  .form-action-row {
    margin-top: 0.5rem;
  }

  /* Pill button like screenshot */
  .btn-primary-pill {
    width: 100%;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    background: linear-gradient(135deg, #6b1a2a 0%, #8B1A3C 60%, #a32247 100%);
    color: #ffffff;
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    box-shadow: 0 8px 20px -4px rgba(107, 26, 42, 0.45);
    transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .btn-primary-pill:hover:not(:disabled) {
    background: linear-gradient(135deg, #e9c25e 0%, #d4a62a 50%, #b8860b 100%);
    color: #2b060f;
    transform: translateY(-2px);
    box-shadow: 0 10px 25px -4px rgba(212, 166, 42, 0.5);
  }

  .btn-primary-pill:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-primary-pill:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  /* ── Switch Mode Section (Admin Login button below) ────────────────────────── */
  .switch-section {
    margin-top: 1.75rem;
  }

  .divider-line {
    display: flex;
    align-items: center;
    text-align: center;
    color: #94a3b8;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin-bottom: 1rem;
  }

  .divider-line::before,
  .divider-line::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #e2e8f0;
  }

  .divider-line span {
    padding: 0 0.85rem;
  }

  .btn-admin-switch {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 1rem;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 14px;
    cursor: pointer;
    text-align: left;
    transition: all 0.22s ease;
  }

  .btn-admin-switch:hover {
    background: #ffffff;
    border-color: #d4a62a;
    box-shadow: 0 4px 14px rgba(212, 166, 42, 0.15);
    transform: translateY(-1px);
  }

  .switch-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(107, 26, 42, 0.08);
    color: #6b1a2a;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .btn-admin-switch:hover .switch-icon {
    background: linear-gradient(135deg, #6b1a2a, #8B1A3C);
    color: #ffffff;
  }

  .switch-label-group {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .switch-primary {
    font-size: 0.88rem;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.25;
  }

  .switch-secondary {
    font-size: 0.74rem;
    color: #64748b;
  }

  .switch-arrow {
    color: #94a3b8;
    transition: transform 0.2s;
  }

  .btn-admin-switch:hover .switch-arrow {
    transform: translateX(3px);
    color: #6b1a2a;
  }

  /* ── Alert Messages ───────────────────────────────────────────────────────── */
  .alert-box {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 1.15rem;
  }

  .alert-error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1.5px solid #fecaca;
  }

  .alert-success {
    background: #fdf2f4;
    color: #6b1a2a;
    border: 1.5px solid #fbcfe8;
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.1);
  }

  /* ── Hero Side (Right Portion - Diagonal Polygon Cut) ──────────────────────── */
  .card-hero-side {
    flex: 1 1 48%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 3.5rem 3rem 3rem 4rem;
    box-sizing: border-box;

    /* Diagonal polygon cut matching the user's reference screenshot */
    clip-path: polygon(14% 0%, 100% 0%, 100% 100%, 0% 100%);
  }

  /* Campus Rodelsa Hall image background layer */
  .hero-image-bg {
    position: absolute;
    inset: 0;
    background-image: url("/rodelsa-image.png");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    z-index: 1;
    transform: scale(1.05);
  }

  /* Rich Maroon & Red-Gold Crystal/Poly Overlay */
  .hero-poly-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(74, 14, 28, 0.94) 0%,
      rgba(107, 26, 42, 0.90) 45%,
      rgba(139, 26, 60, 0.86) 80%,
      rgba(212, 166, 42, 0.75) 100%
    );
    z-index: 2;
  }

  /* Additional geometric gradient facets to match the screenshot */
  .hero-poly-overlay::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 80% 20%, rgba(240, 207, 114, 0.28) 0%, transparent 50%),
      linear-gradient(220deg, rgba(233, 194, 94, 0.22) 0%, transparent 60%);
    pointer-events: none;
  }

  /* Content inside the hero area */
  .hero-content {
    position: relative;
    z-index: 3;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    color: #ffffff;
  }

  .hero-logo-wrap {
    display: flex;
    align-items: center;
  }

  .hero-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
    background: rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    padding: 6px;
    backdrop-filter: blur(10px);
    border: 1.5px solid rgba(240, 207, 114, 0.4);
  }

  .hero-text-block {
    margin: auto 0;
    padding: 1.5rem 0;
  }

  .hero-tagline-pill {
    display: inline-block;
    padding: 0.28rem 0.85rem;
    background: rgba(240, 207, 114, 0.2);
    color: #F0CF72;
    border: 1px solid rgba(240, 207, 114, 0.45);
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin-bottom: 0.85rem;
    backdrop-filter: blur(8px);
  }

  .hero-title {
    font-size: 3.25rem;
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.03em;
    margin: 0 0 0.45rem 0;
    color: #ffffff;
    text-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .hero-university {
    font-size: 1.05rem;
    font-weight: 700;
    color: #F0CF72;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 1.65rem 0;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .hero-highlight-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
  }

  .highlight-icon {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, #F0CF72, #D4A62A);
    color: #3b0713;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  }

  .highlight-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .highlight-title {
    font-size: 0.96rem;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 0.01em;
  }

  .highlight-desc {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.88);
    line-height: 1.4;
  }

  .hero-footer-note {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.7);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* ── Responsive Adaptations for Laptops, Tablets & Mobile Phones ───────────── */
  
  /* Laptops and Small Desktops (901px - 1180px) */
  @media (max-width: 1180px) {
    .split-card {
      max-width: 920px;
      min-height: 520px;
    }

    .card-form-side {
      padding: 2.75rem 2.5rem;
      flex: 1 1 54%;
    }

    .card-hero-side {
      padding: 2.75rem 2.25rem 2.25rem 3.25rem;
      flex: 1 1 46%;
    }

    .hero-title {
      font-size: 2.75rem;
    }

    .main-form-title {
      font-size: 1.95rem;
    }
  }

  /* Tablets & Phablets (601px - 900px) */
  @media (max-width: 900px) {
    .login-page {
      padding: 1.5rem 1rem;
      align-items: flex-start;
    }

    .split-card {
      flex-direction: column;
      max-width: 540px;
      min-height: auto;
      border-radius: 24px;
      margin: 1rem auto;
    }

    .card-hero-side {
      flex: none;
      order: 1;
      padding: 2.75rem 2rem 2.25rem;
      clip-path: polygon(0 0, 100% 0, 100% 92%, 0 100%);
      min-height: auto;
    }

    .card-form-side {
      max-width: 100%;
      flex: none;
      order: 2;
      padding: 2.25rem 2rem 2.5rem;
    }

    .hero-text-block {
      padding: 1rem 0;
    }

    .hero-title {
      font-size: 2.4rem;
    }

    .main-form-title {
      font-size: 1.8rem;
    }
  }

  /* Standard Mobile Phones (481px - 600px) */
  @media (max-width: 600px) {
    .login-page {
      padding: 1rem 0.75rem;
    }

    .split-card {
      border-radius: 22px;
      margin: 0.5rem auto;
    }

    .card-hero-side {
      padding: 2.25rem 1.5rem 1.75rem;
      clip-path: polygon(0 0, 100% 0, 100% 93%, 0 100%);
    }

    .card-form-side {
      padding: 2rem 1.5rem;
    }

    .hero-title {
      font-size: 2.15rem;
    }

    .hero-university {
      font-size: 0.95rem;
      margin-bottom: 1.25rem;
    }

    .main-form-title {
      font-size: 1.65rem;
    }
  }

  /* Small Mobile Phones (< 480px) */
  @media (max-width: 480px) {
    .login-page {
      padding: 0.75rem 0.5rem;
    }

    .split-card {
      border-radius: 20px;
      box-shadow: 0 15px 40px -10px rgba(0, 0, 0, 0.65);
      margin: 0.25rem auto;
    }

    .card-hero-side {
      padding: 1.75rem 1.15rem 1.5rem;
      clip-path: polygon(0 0, 100% 0, 100% 94%, 0 100%);
    }

    .hero-logo {
      width: 52px;
      height: 52px;
    }

    .hero-title {
      font-size: 1.85rem;
    }

    .hero-university {
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }

    .hero-highlight-card {
      padding: 0.75rem 0.95rem;
      gap: 0.75rem;
    }

    .highlight-icon {
      width: 34px;
      height: 34px;
    }

    .highlight-title {
      font-size: 0.88rem;
    }

    .card-form-side {
      padding: 1.75rem 1.15rem 2rem;
    }

    .main-form-title {
      font-size: 1.55rem;
    }

    .main-form-subtitle {
      font-size: 0.85rem;
    }

    .input-field-wrap input {
      height: 48px;
    }

    .btn-primary-pill {
      height: 48px;
      font-size: 0.88rem;
    }

    .btn-admin-switch {
      padding: 0.65rem 0.85rem;
    }

    .switch-primary {
      font-size: 0.82rem;
    }

    .switch-secondary {
      font-size: 0.7rem;
    }
  }
</style>
