<script lang="ts">
  let { open = false, onclose = () => {} }: { open?: boolean; onclose?: () => void } = $props();

  let hasPin = $state(false);
  let loadingInfo = $state(false);

  // Active sub-tab inside settings: 'password' | 'pin'
  let activeTab = $state<'password' | 'pin'>('password');

  // PIN Form State
  let currentPin = $state('');
  let newPin = $state('');
  let confirmPin = $state('');
  let pinLoading = $state(false);
  let pinError = $state('');
  let pinSuccess = $state('');

  // Password Form State
  let authPin = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let passwordLoading = $state(false);
  let passwordError = $state('');
  let passwordSuccess = $state('');

  // Load user PIN status whenever modal opens
  $effect(() => {
    if (open) {
      loadSettingsInfo();
    }
  });

  async function loadSettingsInfo() {
    loadingInfo = true;
    try {
      const res = await fetch('/api/auth/settings');
      if (res.ok) {
        const data = await res.json();
        hasPin = data.has_pin;
        // If they don't have a PIN yet, default to the PIN tab so they set one up
        if (!hasPin) {
          activeTab = 'pin';
        }
      }
    } catch (e) {
      console.error('Failed to load settings info:', e);
    } finally {
      loadingInfo = false;
    }
  }

  async function handleSetPin(e: Event) {
    e.preventDefault();
    pinError = '';
    pinSuccess = '';

    if (!/^\d{4}$/.test(newPin)) {
      pinError = 'PIN must be exactly 4 numbers (0-9)';
      return;
    }

    if (newPin !== confirmPin) {
      pinError = 'PINs do not match';
      return;
    }

    if (hasPin && !currentPin) {
      pinError = 'Please enter your current 4-digit PIN';
      return;
    }

    pinLoading = true;
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_pin',
          pin: newPin,
          current_pin: currentPin || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        pinSuccess = data.message || 'Security PIN saved successfully!';
        hasPin = true;
        currentPin = '';
        newPin = '';
        confirmPin = '';
      } else {
        pinError = data.error || 'Failed to save PIN';
      }
    } catch (err) {
      pinError = 'Network error occurred. Please try again.';
    } finally {
      pinLoading = false;
    }
  }

  async function handleChangePassword(e: Event) {
    e.preventDefault();
    passwordError = '';
    passwordSuccess = '';

    if (!hasPin) {
      passwordError = 'You must set a 4-digit security PIN first before changing your password.';
      activeTab = 'pin';
      return;
    }

    if (!/^\d{4}$/.test(authPin)) {
      passwordError = 'Please enter your 4-digit security PIN';
      return;
    }

    if (newPassword.length < 6) {
      passwordError = 'New password must be at least 6 characters long';
      return;
    }

    if (newPassword !== confirmPassword) {
      passwordError = 'Passwords do not match';
      return;
    }

    passwordLoading = true;
    try {
      const res = await fetch('/api/auth/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_password',
          pin: authPin,
          new_password: newPassword
        })
      });

      const data = await res.json();
      if (res.ok) {
        passwordSuccess = data.message || 'Password changed successfully!';
        authPin = '';
        newPassword = '';
        confirmPassword = '';
      } else {
        passwordError = data.error || 'Failed to update password';
      }
    } catch (err) {
      passwordError = 'Network error occurred. Please try again.';
    } finally {
      passwordLoading = false;
    }
  }
</script>

{#if open}
  <div class="modal-backdrop" onclick={() => onclose()}>
    <div class="modal-card" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <div class="header-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <div class="header-titles">
          <h3>Admin Security Settings</h3>
          <p>Recreate your password and manage your 4-digit security PIN</p>
        </div>
        <button class="close-btn" onclick={() => onclose()} aria-label="Close settings">✕</button>
      </div>

      <!-- Segmented Navigation inside modal -->
      <div class="settings-tabs">
        <button
          type="button"
          class="settings-tab"
          class:active={activeTab === 'password'}
          onclick={() => activeTab = 'password'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Change Password
        </button>

        <button
          type="button"
          class="settings-tab"
          class:active={activeTab === 'pin'}
          onclick={() => activeTab = 'pin'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <circle cx="9" cy="9" r="1.5"/>
            <circle cx="15" cy="9" r="1.5"/>
            <circle cx="9" cy="15" r="1.5"/>
            <circle cx="15" cy="15" r="1.5"/>
          </svg>
          4-Digit PIN
          {#if hasPin}
            <span class="pin-badge set">Active</span>
          {:else}
            <span class="pin-badge missing">Required</span>
          {/if}
        </button>
      </div>

      <div class="modal-body">
        <!-- TAB 1: CHANGE PASSWORD -->
        {#if activeTab === 'password'}
          <form onsubmit={handleChangePassword} class="form-stack">
            {#if !hasPin}
              <div class="alert alert-warning">
                <strong>PIN Required:</strong> You must create a 4-digit Security PIN first before changing your password.
                <button type="button" class="link-btn" onclick={() => activeTab = 'pin'}>Set PIN Now &rarr;</button>
              </div>
            {/if}

            {#if passwordError}
              <div class="alert alert-error">{passwordError}</div>
            {/if}

            {#if passwordSuccess}
              <div class="alert alert-success">{passwordSuccess}</div>
            {/if}

            <div class="field">
              <label for="auth-pin">4-Digit Security PIN <span class="required">*</span></label>
              <input
                id="auth-pin"
                type="password"
                maxlength="4"
                pattern="[0-9]*"
                inputmode="numeric"
                placeholder="Enter 4-digit PIN to authorize"
                bind:value={authPin}
                required
                disabled={passwordLoading}
                class="form-input code-input"
              />
              <span class="field-hint">Required to confirm and authorize your password change.</span>
            </div>

            <div class="field">
              <label for="new-pwd">New Password <span class="required">*</span></label>
              <div class="pwd-wrap">
                <input
                  id="new-pwd"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 6 characters"
                  bind:value={newPassword}
                  required
                  disabled={passwordLoading}
                  class="form-input"
                />
                <button
                  type="button"
                  class="pwd-toggle"
                  onclick={() => showPassword = !showPassword}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div class="field">
              <label for="confirm-pwd">Confirm New Password <span class="required">*</span></label>
              <input
                id="confirm-pwd"
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter new password"
                bind:value={confirmPassword}
                required
                disabled={passwordLoading}
                class="form-input"
              />
            </div>

            <button type="submit" class="submit-btn" disabled={passwordLoading || !hasPin}>
              {passwordLoading ? "Updating Password..." : "Update Password"}
            </button>
          </form>
        {/if}

        <!-- TAB 2: 4-DIGIT SECURITY PIN -->
        {#if activeTab === 'pin'}
          <form onsubmit={handleSetPin} class="form-stack">
            <div class="info-banner">
              Your 4-digit Security PIN is stored securely (one-way hashed with bcrypt in the database). Nobody, not even database admins, can view your plain PIN.
            </div>

            {#if pinError}
              <div class="alert alert-error">{pinError}</div>
            {/if}

            {#if pinSuccess}
              <div class="alert alert-success">{pinSuccess}</div>
            {/if}

            {#if hasPin}
              <div class="field">
                <label for="cur-pin">Current 4-Digit PIN <span class="required">*</span></label>
                <input
                  id="cur-pin"
                  type="password"
                  maxlength="4"
                  pattern="[0-9]*"
                  inputmode="numeric"
                  placeholder="••••"
                  bind:value={currentPin}
                  required
                  disabled={pinLoading}
                  class="form-input code-input"
                />
              </div>
            {/if}

            <div class="field">
              <label for="set-new-pin">{hasPin ? "New 4-Digit PIN" : "Create 4-Digit PIN"} <span class="required">*</span></label>
              <input
                id="set-new-pin"
                type="password"
                maxlength="4"
                pattern="[0-9]*"
                inputmode="numeric"
                placeholder="e.g. 1234"
                bind:value={newPin}
                required
                disabled={pinLoading}
                class="form-input code-input"
              />
            </div>

            <div class="field">
              <label for="conf-new-pin">Confirm 4-Digit PIN <span class="required">*</span></label>
              <input
                id="conf-new-pin"
                type="password"
                maxlength="4"
                pattern="[0-9]*"
                inputmode="numeric"
                placeholder="Re-enter 4-digit PIN"
                bind:value={confirmPin}
                required
                disabled={pinLoading}
                class="form-input code-input"
              />
            </div>

            <button type="submit" class="submit-btn" disabled={pinLoading}>
              {pinLoading ? "Saving PIN..." : (hasPin ? "Update Security PIN" : "Save Security PIN")}
            </button>
          </form>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-md);
    z-index: 9999;
  }

  .modal-card {
    background: #ffffff;
    border-radius: var(--radius-xl);
    width: 100%;
    max-width: 480px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    border: 1px solid var(--border);
    overflow: hidden;
    animation: popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: #fafafa;
    border-bottom: 1px solid var(--border);
  }

  .header-icon {
    width: 42px;
    height: 42px;
    border-radius: var(--radius-md);
    background: var(--gradient-maroon);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: var(--shadow-gold-sm);
  }

  .header-titles {
    flex: 1;
  }

  .header-titles h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .header-titles p {
    margin: 2px 0 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 1.2rem;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: #e2e8f0;
  }

  /* Segmented tabs */
  .settings-tabs {
    display: flex;
    background: #f1f5f9;
    padding: 6px;
    gap: 6px;
    border-bottom: 1px solid var(--border);
  }

  .settings-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 0.825rem;
    font-weight: 700;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .settings-tab.active {
    background: #ffffff;
    color: var(--maroon);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  }

  .pin-badge {
    font-size: 0.65rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 10px;
    text-transform: uppercase;
  }

  .pin-badge.set {
    background: #dcfce7;
    color: #166534;
  }

  .pin-badge.missing {
    background: #fee2e2;
    color: #991b1b;
  }

  .modal-body {
    padding: var(--space-lg);
  }

  .form-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .required {
    color: #dc2626;
  }

  .field-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .form-input {
    height: 44px;
    border-radius: var(--radius-md);
    border: 1.5px solid var(--border);
    padding: 0 12px;
    font-size: 0.95rem;
    transition: all 0.2s;
    background: #fff;
  }

  .form-input:focus {
    border-color: var(--gold);
    outline: none;
    box-shadow: 0 0 0 3px rgba(212, 166, 42, 0.2);
  }

  .code-input {
    letter-spacing: 6px;
    font-weight: 800;
    font-size: 1.1rem;
    font-family: monospace;
  }

  .pwd-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .pwd-wrap input {
    width: 100%;
    padding-right: 60px;
  }

  .pwd-toggle {
    position: absolute;
    right: 10px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
  }

  .pwd-toggle:hover {
    color: var(--maroon);
  }

  .alert {
    padding: 10px 14px;
    border-radius: var(--radius-md);
    font-size: 0.825rem;
    line-height: 1.4;
  }

  .alert-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }

  .alert-success {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .alert-warning {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .link-btn {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--maroon);
    font-weight: 800;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }

  .info-banner {
    font-size: 0.8rem;
    color: var(--text-secondary);
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    line-height: 1.45;
  }

  .submit-btn {
    height: 46px;
    border-radius: var(--radius-md);
    background: var(--gradient-maroon);
    color: white;
    font-weight: 700;
    font-size: 0.9rem;
    border: none;
    box-shadow: var(--shadow-gold-md);
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 4px;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--gradient-gold);
    color: var(--text-primary);
    transform: translateY(-1px);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
