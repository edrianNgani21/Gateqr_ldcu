<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { invalidateAll } from '$app/navigation';

    let { data } = $props();
    let admin = $derived(data.adminUser);

    // Password State
    let currentPinForPassword = $state('');
    let newPassword = $state('');
    let confirmPassword = $state('');
    let showNewPassword = $state(false);
    let showConfirmPassword = $state(false);
    let passwordLoading = $state(false);
    let passwordError = $state('');
    let passwordSuccess = $state('');

    // PIN State
    let currentPin = $state('');
    let newPin = $state('');
    let confirmPin = $state('');
    let pinLoading = $state(false);
    let pinError = $state('');
    let pinSuccess = $state('');

    // PIN Verification tester
    let testPin = $state('');
    let testPinResult = $state<{ success: boolean; message: string } | null>(null);
    let testPinLoading = $state(false);

    function formatDate(dateStr: string | null): string {
        if (!dateStr) return 'Not Available';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    async function handleChangePassword(e: Event) {
        e.preventDefault();
        passwordError = '';
        passwordSuccess = '';

        if (!admin.has_pin) {
            passwordError = 'Please configure your 4-Digit Security PIN on the right first before changing your password.';
            return;
        }

        if (!currentPinForPassword || !/^\d{4}$/.test(currentPinForPassword)) {
            passwordError = 'Please enter your valid 4-digit security PIN.';
            return;
        }

        if (newPassword.length < 6) {
            passwordError = 'New password must be at least 6 characters long.';
            return;
        }

        if (newPassword !== confirmPassword) {
            passwordError = 'New password and confirmation do not match.';
            return;
        }

        passwordLoading = true;
        try {
            const res = await fetch('/api/auth/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'change_password',
                    pin: currentPinForPassword,
                    new_password: newPassword
                })
            });

            const result = await res.json();
            if (res.ok) {
                passwordSuccess = 'Password updated successfully!';
                currentPinForPassword = '';
                newPassword = '';
                confirmPassword = '';
                await invalidateAll();
            } else {
                passwordError = result.error || 'Failed to update password.';
            }
        } catch (err) {
            passwordError = 'Network error occurred. Please try again.';
        } finally {
            passwordLoading = false;
        }
    }

    async function handleSetPin(e: Event) {
        e.preventDefault();
        pinError = '';
        pinSuccess = '';

        if (!newPin || !/^\d{4}$/.test(newPin)) {
            pinError = 'PIN must be exactly 4 numeric digits.';
            return;
        }

        if (newPin !== confirmPin) {
            pinError = 'New PIN and confirmation PIN do not match.';
            return;
        }

        if (admin.has_pin && (!currentPin || !/^\d{4}$/.test(currentPin))) {
            pinError = 'Please enter your current 4-digit PIN to update.';
            return;
        }

        pinLoading = true;
        try {
            const res = await fetch('/api/auth/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'set_pin',
                    current_pin: admin.has_pin ? currentPin : undefined,
                    pin: newPin
                })
            });

            const result = await res.json();
            if (res.ok) {
                pinSuccess = admin.has_pin ? 'Security PIN updated successfully!' : '4-Digit Security PIN configured successfully!';
                currentPin = '';
                newPin = '';
                confirmPin = '';
                await invalidateAll();
            } else {
                pinError = result.error || 'Failed to save security PIN.';
            }
        } catch (err) {
            pinError = 'Network error occurred. Please try again.';
        } finally {
            pinLoading = false;
        }
    }

    async function handleVerifyPinTest() {
        if (!testPin || !/^\d{4}$/.test(testPin)) {
            testPinResult = { success: false, message: 'Please enter a 4-digit PIN.' };
            return;
        }

        testPinLoading = true;
        testPinResult = null;
        try {
            const res = await fetch('/api/auth/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'verify_pin',
                    pin: testPin
                })
            });

            const result = await res.json();
            if (res.ok) {
                testPinResult = { success: true, message: 'PIN is verified and valid!' };
            } else {
                testPinResult = { success: false, message: result.error || 'Incorrect PIN.' };
            }
        } catch {
            testPinResult = { success: false, message: 'Network error occurred.' };
        } finally {
            testPinLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Settings — Administrator Account | GateQR</title>
</svelte:head>

<AppShell userEmail={data.userEmail} showSidebar={true}>
    <NavBar title="Settings" />

    <div class="settings-page-wrapper">
        <!-- Section 1: Administrator Account Card -->
        <section class="admin-account-card">
            <div class="card-top-header">
                <div class="header-icon-box">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        <circle cx="12" cy="11" r="3"/>
                    </svg>
                </div>
                <div class="header-titles">
                    <h2>Administrator Account</h2>
                    <p>Current authorized administrator profile and database record</p>
                </div>
                <span class="status-pill active">
                    <span class="status-dot"></span> Active Session
                </span>
            </div>

            <div class="admin-info-grid">
                <div class="info-field">
                    <span class="field-label">Admin Email</span>
                    <div class="field-value email-value">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <span>{admin.email}</span>
                    </div>
                </div>

                <div class="info-field">
                    <span class="field-label">Assigned Role</span>
                    <div class="field-value">
                        <span class="badge-role">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="8" r="4"/>
                                <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
                            </svg>
                            {admin.user_type === 'Osa' ? 'Office of Student Affairs (OSA)' : admin.user_type}
                        </span>
                    </div>
                </div>

                <div class="info-field">
                    <span class="field-label">Identification Classification</span>
                    <div class="field-value">
                        <span class="badge-id">{admin.identification || 'Administrator'}</span>
                    </div>
                </div>

                <div class="info-field">
                    <span class="field-label">Account Created At</span>
                    <div class="field-value date-value">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <span>{formatDate(admin.created_at)}</span>
                    </div>
                </div>

                <div class="info-field">
                    <span class="field-label">4-Digit Security PIN</span>
                    <div class="field-value">
                        {#if admin.has_pin}
                            <span class="badge-pin-active">✓ PIN Configured</span>
                        {:else}
                            <span class="badge-pin-warning">⚠ PIN Not Configured</span>
                        {/if}
                    </div>
                </div>
            </div>
        </section>

        <!-- Scroll down indicator banner -->
        <div class="scroll-divider">
            <span class="scroll-line"></span>
            <span class="scroll-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                </svg>
                Security Credentials Management
            </span>
            <span class="scroll-line"></span>
        </div>

        <!-- Section 2: Two-column Security Settings (Password on Left, PIN on Right) -->
        <div class="security-grid">
            <!-- Left Column: Change Password -->
            <div class="security-column-card left-card">
                <div class="col-header">
                    <div class="col-icon left-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </div>
                    <div>
                        <h3>Change Password</h3>
                        <p>Authorize with your 4-digit security PIN to update account password</p>
                    </div>
                </div>

                {#if passwordError}
                    <div class="alert-box error-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>{passwordError}</span>
                    </div>
                {/if}

                {#if passwordSuccess}
                    <div class="alert-box success-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <span>{passwordSuccess}</span>
                    </div>
                {/if}

                <form onsubmit={handleChangePassword} class="form-body">
                    <div class="form-group">
                        <label for="pwd-pin">4-Digit Security PIN <span class="required">*</span></label>
                        <input
                            id="pwd-pin"
                            type="password"
                            maxlength="4"
                            inputmode="numeric"
                            placeholder="••••"
                            bind:value={currentPinForPassword}
                            required
                            class="input-field pin-masked"
                        />
                        <span class="hint-text">Your security PIN is required to authorize password modifications</span>
                    </div>

                    <div class="form-group">
                        <label for="new-pwd">New Password <span class="required">*</span></label>
                        <div class="input-with-toggle">
                            <input
                                id="new-pwd"
                                type={showNewPassword ? 'text' : 'password'}
                                placeholder="Enter at least 6 characters"
                                bind:value={newPassword}
                                required
                                class="input-field"
                            />
                            <button type="button" class="eye-toggle" onclick={() => showNewPassword = !showNewPassword} title="Toggle Visibility">
                                {#if showNewPassword}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                {:else}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                {/if}
                            </button>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="confirm-pwd">Confirm New Password <span class="required">*</span></label>
                        <div class="input-with-toggle">
                            <input
                                id="confirm-pwd"
                                type={showConfirmPassword ? 'text' : 'password'}
                                placeholder="Confirm your new password"
                                bind:value={confirmPassword}
                                required
                                class="input-field"
                            />
                            <button type="button" class="eye-toggle" onclick={() => showConfirmPassword = !showConfirmPassword} title="Toggle Visibility">
                                {#if showConfirmPassword}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                {:else}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                {/if}
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="submit-btn maroon-btn" disabled={passwordLoading}>
                        {#if passwordLoading}
                            <span class="btn-spinner"></span> Updating Password...
                        {:else}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            Save New Password
                        {/if}
                    </button>
                </form>
            </div>

            <!-- Right Column: 4-Digit Security PIN -->
            <div class="security-column-card right-card">
                <div class="col-header">
                    <div class="col-icon right-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                        </svg>
                    </div>
                    <div>
                        <h3>4-Digit Security PIN</h3>
                        <p>{admin.has_pin ? 'Update or manage your 4-digit administrative verification PIN' : 'Configure a 4-digit security PIN for authorized approvals'}</p>
                    </div>
                </div>

                {#if pinError}
                    <div class="alert-box error-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>{pinError}</span>
                    </div>
                {/if}

                {#if pinSuccess}
                    <div class="alert-box success-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <span>{pinSuccess}</span>
                    </div>
                {/if}

                <form onsubmit={handleSetPin} class="form-body">
                    {#if admin.has_pin}
                        <div class="form-group">
                            <label for="cur-pin">Current 4-Digit PIN <span class="required">*</span></label>
                            <input
                                id="cur-pin"
                                type="password"
                                maxlength="4"
                                inputmode="numeric"
                                placeholder="••••"
                                bind:value={currentPin}
                                required
                                class="input-field pin-masked"
                            />
                        </div>
                    {/if}

                    <div class="form-group">
                        <label for="new-pin">{admin.has_pin ? 'New 4-Digit PIN' : 'Set 4-Digit PIN'} <span class="required">*</span></label>
                        <input
                            id="new-pin"
                            type="password"
                            maxlength="4"
                            inputmode="numeric"
                            placeholder="••••"
                            bind:value={newPin}
                            required
                            class="input-field pin-masked"
                        />
                        <span class="hint-text">Must be exactly 4 digits (e.g. 1234)</span>
                    </div>

                    <div class="form-group">
                        <label for="confirm-pin">Confirm 4-Digit PIN <span class="required">*</span></label>
                        <input
                            id="confirm-pin"
                            type="password"
                            maxlength="4"
                            inputmode="numeric"
                            placeholder="••••"
                            bind:value={confirmPin}
                            required
                            class="input-field pin-masked"
                        />
                    </div>

                    <button type="submit" class="submit-btn gold-btn" disabled={pinLoading}>
                        {#if pinLoading}
                            <span class="btn-spinner"></span> Saving PIN...
                        {:else}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            {admin.has_pin ? 'Update Security PIN' : 'Save 4-Digit PIN'}
                        {/if}
                    </button>
                </form>

                {#if admin.has_pin}
                    <!-- Verification / PIN Test Box -->
                    <div class="pin-tester-section">
                        <h4>Test & Verify PIN</h4>
                        <div class="tester-input-row">
                            <input
                                type="password"
                                maxlength="4"
                                inputmode="numeric"
                                placeholder="Verify PIN..."
                                bind:value={testPin}
                                class="input-field tester-input"
                            />
                            <button
                                type="button"
                                class="tester-btn"
                                onclick={handleVerifyPinTest}
                                disabled={testPinLoading}
                            >
                                {testPinLoading ? 'Checking...' : 'Verify'}
                            </button>
                        </div>
                        {#if testPinResult}
                            <p class="test-feedback" class:test-pass={testPinResult.success} class:test-fail={!testPinResult.success}>
                                {testPinResult.message}
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</AppShell>

<style>
    .settings-page-wrapper {
        padding: 1.5rem 0 3rem 0;
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }

    /* ─── Administrator Account Card ─── */
    .admin-account-card {
        background: #ffffff;
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 18px;
        padding: 1.75rem 2rem;
        box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
    }

    .card-top-header {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid #f1f5f9;
    }

    .header-icon-box {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
        color: #E9C25E;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 14px rgba(122, 23, 52, 0.25);
        flex-shrink: 0;
    }

    .header-titles {
        flex: 1;
    }

    .header-titles h2 {
        font-size: 1.35rem;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 0.25rem 0;
        letter-spacing: -0.01em;
    }

    .header-titles p {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0;
    }

    .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.4rem 0.9rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 700;
        background: #ecfdf5;
        color: #059669;
        border: 1px solid #a7f3d0;
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
    }

    .admin-info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1.5rem;
        margin-top: 1.5rem;
    }

    .info-field {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }

    .field-label {
        font-size: 0.775rem;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .field-value {
        font-size: 0.95rem;
        font-weight: 600;
        color: #1e293b;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .email-value {
        color: #7A1734;
        font-weight: 700;
    }

    .badge-role {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: rgba(122, 23, 52, 0.08);
        color: #7A1734;
        border: 1px solid rgba(122, 23, 52, 0.2);
        padding: 0.3rem 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 700;
    }

    .badge-id {
        background: #f1f5f9;
        color: #334155;
        padding: 0.3rem 0.75rem;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 600;
    }

    .badge-pin-active {
        color: #059669;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        padding: 0.3rem 0.75rem;
        border-radius: 8px;
        font-size: 0.825rem;
        font-weight: 700;
    }

    .badge-pin-warning {
        color: #d97706;
        background: #fffbeb;
        border: 1px solid #fde68a;
        padding: 0.3rem 0.75rem;
        border-radius: 8px;
        font-size: 0.825rem;
        font-weight: 700;
    }

    /* ─── Scroll Down Divider ─── */
    .scroll-divider {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin: 0.5rem 0;
    }

    .scroll-line {
        flex: 1;
        height: 1px;
        background: #e2e8f0;
    }

    .scroll-label {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.825rem;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.35rem 1rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 999px;
    }

    /* ─── Two-Column Security Grid ─── */
    .security-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.75rem;
    }

    @media (max-width: 900px) {
        .security-grid {
            grid-template-columns: 1fr;
        }
    }

    .security-column-card {
        background: #ffffff;
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 18px;
        padding: 1.75rem;
        box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.04);
        display: flex;
        flex-direction: column;
    }

    .col-header {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #f1f5f9;
    }

    .col-icon {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .left-icon {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
    }

    .right-icon {
        background: #fefce8;
        color: #854d0e;
        border: 1px solid #fef08a;
    }

    .col-header h3 {
        font-size: 1.15rem;
        font-weight: 800;
        color: #0f172a;
        margin: 0 0 0.25rem 0;
    }

    .col-header p {
        font-size: 0.825rem;
        color: #64748b;
        margin: 0;
        line-height: 1.4;
    }

    .form-body {
        display: flex;
        flex-direction: column;
        gap: 1.15rem;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .form-group label {
        font-size: 0.825rem;
        font-weight: 700;
        color: #334155;
    }

    .required {
        color: #ef4444;
    }

    .input-field {
        width: 100%;
        padding: 0.75rem 1rem;
        border-radius: 10px;
        border: 1.5px solid #cbd5e1;
        background: #f8fafc;
        font-size: 0.95rem;
        color: #0f172a;
        transition: all 0.2s ease;
        box-sizing: border-box;
    }

    .input-field:focus {
        outline: none;
        background: #ffffff;
        border-color: #7A1734;
        box-shadow: 0 0 0 3px rgba(122, 23, 52, 0.12);
    }

    .pin-masked {
        letter-spacing: 0.35em;
        font-weight: 700;
        font-size: 1.1rem;
    }

    .input-with-toggle {
        position: relative;
        display: flex;
        align-items: center;
    }

    .eye-toggle {
        position: absolute;
        right: 12px;
        background: transparent;
        border: none;
        color: #64748b;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .eye-toggle:hover {
        color: #0f172a;
    }

    .hint-text {
        font-size: 0.75rem;
        color: #64748b;
    }

    .submit-btn {
        margin-top: 0.5rem;
        padding: 0.8rem 1.25rem;
        border-radius: 10px;
        font-size: 0.925rem;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
        border: none;
    }

    .maroon-btn {
        background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(122, 23, 52, 0.2);
    }

    .maroon-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(122, 23, 52, 0.3);
    }

    .gold-btn {
        background: linear-gradient(135deg, #D4A62A 0%, #B8860B 100%);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(212, 166, 42, 0.25);
    }

    .gold-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(212, 166, 42, 0.35);
    }

    .submit-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    /* Alerts */
    .alert-box {
        padding: 0.75rem 1rem;
        border-radius: 10px;
        font-size: 0.85rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }

    .error-alert {
        background: #fef2f2;
        color: #b91c1c;
        border: 1px solid #fecaca;
    }

    .success-alert {
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
    }

    /* PIN Tester Section */
    .pin-tester-section {
        margin-top: 1.5rem;
        padding-top: 1.25rem;
        border-top: 1px dashed #e2e8f0;
    }

    .pin-tester-section h4 {
        font-size: 0.85rem;
        font-weight: 700;
        color: #475569;
        margin: 0 0 0.5rem 0;
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }

    .tester-input-row {
        display: flex;
        gap: 0.5rem;
    }

    .tester-input {
        width: 130px;
        letter-spacing: 0.3em;
        font-weight: 700;
    }

    .tester-btn {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-weight: 700;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .tester-btn:hover:not(:disabled) {
        background: #e2e8f0;
        color: #0f172a;
    }

    .test-feedback {
        margin: 0.5rem 0 0 0;
        font-size: 0.8rem;
        font-weight: 700;
    }

    .test-pass {
        color: #059669;
    }

    .test-fail {
        color: #dc2626;
    }
</style>
