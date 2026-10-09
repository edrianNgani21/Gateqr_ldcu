<script lang="ts">
  import { goto } from "$app/navigation";

  let activeTab = $state<'login' | 'register'>('login');

  // Admin / Staff Login state (UNTOUCHED)
  let adminEmail = $state("");
  let adminPassword = $state("");
  let showPassword = $state(false);

  // Applicant Register / Check Status state
  let applicantEmail = $state("");
  let alreadyRegisteredNotice = $state("");

  let loading = $state(false);
  let error = $state("");

  function switchTab(tab: 'login' | 'register') {
    activeTab = tab;
    error = "";
    alreadyRegisteredNotice = "";
  }

  // Handle Admin / Staff Login (UNTOUCHED)
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

  // Handle Applicant Access / Register / Status (Email only, no password needed)
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
  <title>Sign In & Register — GateQR | Liceo de Cagayan University</title>
  <meta
    name="description"
    content="Sign in, apply for a sticker, or check status for GateQR vehicle sticker system at Liceo de Cagayan University."
  />
</svelte:head>

<div class="login-page">
  <div class="bg-glow"></div>
  <div class="bg-image"></div>
  <div class="bg-overlay"></div>

  <div class="login-card">
    <div class="login-brand">
      <div class="login-logo">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <circle cx="17.5" cy="17.5" r="2.5" />
        </svg>
      </div>
      <div>
        <h1 class="login-title">GateQR</h1>
        <p class="login-university">Liceo de Cagayan University</p>
      </div>
    </div>

    <!-- Segmented Tab Navigation: Admin Login vs Apply / Check Status -->
    <div class="auth-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'login'}
        class="tab-btn"
        class:active={activeTab === 'login'}
        onclick={() => switchTab('login')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>ADMIN LOGIN</span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'register'}
        class="tab-btn"
        class:active={activeTab === 'register'}
        onclick={() => switchTab('register')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="8.5" cy="7" r="4"/>
          <line x1="20" y1="8" x2="20" y2="14"/>
          <line x1="23" y1="11" x2="17" y2="11"/>
        </svg>
        <span>Apply Sticker</span>
      </button>
    </div>

    {#if error}
      <div class="error-msg">{error}</div>
    {/if}

    {#if alreadyRegisteredNotice}
      <div class="already-registered-badge">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <span>{alreadyRegisteredNotice}</span>
      </div>
    {/if}

    <!-- TAB 1: ADMIN LOGIN (EMAIL + PASSWORD) - UNTOUCHED -->
    {#if activeTab === 'login'}
      <form class="login-form" onsubmit={handleAdminLogin}>
        <div class="field-group">
          <label class="field-label" for="admin-email">Admin Email</label>
          <div class="input-wrap">
            <svg
              class="input-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <input
              id="admin-email"
              type="email"
              bind:value={adminEmail}
              placeholder="e.g. aluban98304@liceo.edu.ph"
              autocomplete="email"
              required
              disabled={loading}
            />
          </div>
        </div>

        <div class="field-group">
          <label class="field-label" for="admin-password">Password</label>
          <div class="input-wrap">
            <svg
              class="input-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
              class="toggle-pwd-btn"
              onclick={() => showPassword = !showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>

        <button type="submit" class="login-btn" disabled={loading}>
          <span>{loading ? "Signing in..." : "Log In as Admin"}</span>
          {#if !loading}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          {/if}
        </button>
      </form>
    {/if}

    <!-- TAB 2: APPLICANT REGISTRATION & STATUS (EMAIL ONLY) -->
    {#if activeTab === 'register'}
      <form class="login-form" onsubmit={handleApplicantRegister}>
        <div class="field-group">
          <label class="field-label" for="applicant-email">Applicant Email</label>
          <div class="input-wrap">
            <svg
              class="input-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <input
              id="applicant-email"
              type="email"
              bind:value={applicantEmail}
              placeholder="e.g. student@liceo.edu.ph or visitor@gmail.com"
              autocomplete="email"
              required
              disabled={loading}
            />
          </div>
        </div>

        <button type="submit" class="login-btn" disabled={loading}>
          <span>{loading ? "Proceeding..." : "Apply Sticker"}</span>
          {#if !loading}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          {/if}
        </button>
      </form>
    {/if}

    <p class="login-footer">
      Office of Student Affairs (OSA) &bull; Liceo de Cagayan University<br>
      <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>
    </p>
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xl);
    background: var(--bg-gradient);
    position: relative;
    overflow: hidden;
  }

  .bg-glow {
    position: absolute;
    width: 600px;
    height: 600px;
    background: radial-gradient(
      circle,
      rgba(212, 166, 42, 0.15) 0%,
      transparent 70%
    );
    top: -150px;
    right: -150px;
    pointer-events: none;
    animation: pulse 4s ease-in-out infinite;
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
      rgba(0, 0, 0, 0.6) 0%,
      rgba(0, 0, 0, 0.4) 50%,
      rgba(0, 0, 0, 0.7) 100%
    );
    z-index: 1;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.6;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.1);
    }
  }

  .login-card {
    background: rgba(255, 255, 255, 0.95);
    border-radius: var(--radius-2xl);
    padding: var(--space-2xl);
    width: 100%;
    max-width: 460px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    position: relative;
    z-index: 10;
    border: 2px solid rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .login-brand {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    margin-bottom: var(--space-lg);
  }

  .login-logo {
    width: 60px;
    height: 60px;
    background: var(--gradient-maroon);
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: var(--shadow-gold-md);
    border: 3px solid white;
    flex-shrink: 0;
  }

  .login-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--maroon);
    letter-spacing: -0.02em;
    margin: 0;
    background: var(--gradient-maroon);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .login-university {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.2rem 0 0;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Segmented Toggle Tabs */
  .auth-tabs {
    display: flex;
    background: #f1f5f9;
    border-radius: var(--radius-lg);
    padding: 4px;
    gap: 4px;
    margin-bottom: var(--space-lg);
    border: 1px solid var(--border);
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 12px;
    border-radius: calc(var(--radius-lg) - 2px);
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-btn:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.6);
  }

  .tab-btn.active {
    background: #ffffff;
    color: var(--maroon);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .error-msg {
    color: #b91c1c;
    background: #fef2f2;
    border: 2px solid #fca5a5;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: var(--space-md);
  }

  .already-registered-badge {
    color: #8B1A3C;
    background: #fdf2f4;
    border: 2px solid #fecdd3;
    box-shadow: 0 0 14px rgba(139, 26, 60, 0.15);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-size: 0.86rem;
    font-weight: 700;
    margin-bottom: var(--space-md);
    display: flex;
    align-items: center;
    gap: 8px;
    animation: fadeInBadge 0.3s ease;
  }

  @keyframes fadeInBadge {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .field-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-icon {
    position: absolute;
    left: var(--space-md);
    color: var(--text-muted);
    pointer-events: none;
  }

  .input-wrap input {
    width: 100%;
    padding-left: 2.75rem;
    padding-right: 2.75rem;
    height: 48px;
    border-radius: var(--radius-md);
    border: 2px solid var(--border);
    font-size: 0.95rem;
    background: #fff;
    transition: all 0.25s ease;
  }

  .input-wrap input:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 4px rgba(212, 166, 42, 0.15);
    outline: none;
  }

  .toggle-pwd-btn {
    position: absolute;
    right: 12px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.2s;
  }

  .toggle-pwd-btn:hover {
    color: var(--maroon);
  }

  .login-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-xl);
    background: var(--gradient-maroon);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 700;
    border-radius: var(--radius-md);
    border: none;
    box-shadow: var(--shadow-gold-md);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    height: 50px;
    cursor: pointer;
    margin-top: var(--space-xs);
  }

  .login-btn:hover:not(:disabled) {
    background: var(--gradient-gold);
    color: var(--text-primary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-gold-lg);
  }

  .login-btn.register-variant {
    background: var(--gradient-maroon);
  }

  .login-btn.register-variant:hover:not(:disabled) {
    background: var(--gradient-gold);
    color: var(--text-primary);
  }

  .login-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .login-footer {
    margin-top: var(--space-lg);
    font-size: 0.78rem;
    color: var(--text-muted);
    text-align: center;
    line-height: 1.5;
    font-weight: 500;
  }

  .footer-link {
    color: var(--maroon);
    font-weight: 700;
    text-decoration: none;
  }

  .footer-link:hover {
    color: var(--gold);
  }

  @media (max-width: 480px) {
    .login-card {
      padding: var(--space-lg);
      border-radius: var(--radius-xl);
    }

    .login-brand {
      flex-direction: column;
      text-align: center;
      gap: 8px;
    }

    .auth-tabs {
      flex-direction: column;
    }
  }
</style>
