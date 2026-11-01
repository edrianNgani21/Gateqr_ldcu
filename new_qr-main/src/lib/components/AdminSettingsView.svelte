<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';

    let {
        data,
        userRole = 'osa',
        showSidebar = true,
        pageTitle = 'Settings',
        roleLabel = ''
    }: {
        data: {
            userEmail: string;
            adminUser: {
                user_id: number;
                email: string;
                account_role: string;
                account_type: string;
                created_at: string | null;
                is_active: boolean;
                google_linked: boolean;
                department_name?: string;
            };
        };
        userRole?: string;
        showSidebar?: boolean;
        pageTitle?: string;
        roleLabel?: string;
    } = $props();

    let admin = $derived(data.adminUser);

    // Change Email: a confirmation link goes to the current email
    let newEmail = $state('');
    let emailLoading = $state(false);
    let emailError = $state('');
    let emailSuccess = $state('');

    async function handleChangeEmail(e: Event) {
        e.preventDefault();
        emailError = '';
        emailSuccess = '';

        const value = newEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            emailError = 'Please enter a valid email address.';
            return;
        }
        if (value === (admin.email || '').toLowerCase()) {
            emailError = 'That is already your current email.';
            return;
        }

        emailLoading = true;
        try {
            const res = await fetch('/api/auth/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'request_email_change', new_email: value })
            });
            const result = await res.json();
            if (res.ok) {
                emailSuccess = result.message || 'Confirmation email sent.';
                newEmail = '';
            } else {
                emailError = result.error || 'Could not request the email change.';
            }
        } catch {
            emailError = 'Network error occurred. Please try again.';
        } finally {
            emailLoading = false;
        }
    }

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

    let displayRoleName = $derived.by(() => {
        if (roleLabel) return roleLabel;
        const ut = (admin.account_role || '').toLowerCase();
        if (ut === 'osa') return 'Office of Student Affairs (OSA)';
        if (ut.includes('security') || ut === 'safety_security') return 'Security Administrator';
        if (userRole === 'dean') return 'Academic Department Head';
        if (userRole === 'administrative') return 'Administrative Department Head';
        return admin.account_role || 'Administrator';
    });
</script>

<svelte:head>
    <title>{pageTitle} — Administrator Account | GateQR</title>
</svelte:head>

<AppShell userEmail={data.userEmail} {showSidebar} {userRole}>
    <NavBar title={pageTitle} />

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
                            {displayRoleName}
                        </span>
                    </div>
                </div>

                {#if admin.department_name}
                    <div class="info-field">
                        <span class="field-label">Department</span>
                        <div class="field-value">
                            <span class="badge-dept">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                                {admin.department_name}
                            </span>
                        </div>
                    </div>
                {/if}

                <div class="info-field">
                    <span class="field-label">Identification Classification</span>
                    <div class="field-value">
                        <span class="badge-id">{admin.account_type || 'Administrator'}</span>
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
                    <span class="field-label">Sign-in Method</span>
                    <div class="field-value">
                        {#if admin.google_linked}
                            <span class="badge-linked">✓ Google account linked</span>
                        {:else}
                            <span class="badge-pending">Google (not signed in yet)</span>
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
                Sign-in & Email
            </span>
            <span class="scroll-line"></span>
        </div>

        <!-- Section 2: Google sign-in (left) and Change Email (right) -->
        <div class="security-grid">
            <div class="security-column-card left-card">
                <div class="col-header">
                    <div class="col-icon left-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <polyline points="9 12 11 14 15 10"/>
                        </svg>
                    </div>
                    <div>
                        <h3>Google Sign-In</h3>
                        <p>GateQR has no passwords. You sign in with the Google account of {admin.email}.</p>
                    </div>
                </div>

                <ul class="info-list">
                    <li>Google checks it's you each time you sign in on a new device.</li>
                    <li>Turn on <strong>2-Step Verification</strong> so a new sign-in needs your approval on your phone or any device signed in to your Google account.</li>
                    <li>Signing out of GateQR does not sign you out of Google.</li>
                </ul>

                <a class="submit-btn maroon-btn link-btn" href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener noreferrer">
                    Open Google 2-Step Verification
                </a>
            </div>

            <div class="security-column-card right-card">
                <div class="col-header">
                    <div class="col-icon right-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                    </div>
                    <div>
                        <h3>Change Email</h3>
                        <p>We send a confirmation link to your current email. The change happens only after you approve it there.</p>
                    </div>
                </div>

                {#if emailError}
                    <div class="alert-box error-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>{emailError}</span>
                    </div>
                {/if}

                {#if emailSuccess}
                    <div class="alert-box success-alert">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <span>{emailSuccess}</span>
                    </div>
                {/if}

                <form onsubmit={handleChangeEmail} class="form-body">
                    <div class="form-group">
                        <label for="cur-email">Current Email</label>
                        <input id="cur-email" type="email" value={admin.email} disabled class="input-field" />
                    </div>

                    <div class="form-group">
                        <label for="new-email">New Email <span class="required">*</span></label>
                        <input
                            id="new-email"
                            type="email"
                            inputmode="email"
                            autocomplete="email"
                            placeholder="Must be a Google account"
                            bind:value={newEmail}
                            required
                            class="input-field"
                        />
                        <span class="hint-text">After the change, only the Google account of the new email can sign in.</span>
                    </div>

                    <button type="submit" class="submit-btn maroon-btn" disabled={emailLoading}>
                        {#if emailLoading}
                            <span class="btn-spinner"></span> Sending...
                        {:else}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                            Send Confirmation
                        {/if}
                    </button>
                </form>
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

    .badge-dept {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: rgba(212, 166, 42, 0.1);
        color: #854d0e;
        border: 1px solid rgba(212, 166, 42, 0.3);
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

    .badge-linked {
        color: #059669;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        padding: 0.3rem 0.75rem;
        border-radius: 8px;
        font-size: 0.825rem;
        font-weight: 700;
    }

    .badge-pending {
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
    .info-list {
        margin: 0 0 1.25rem;
        padding: 0.9rem 1rem 0.9rem 1.9rem;
        border-radius: 12px;
        background: #fbf7f8;
        border: 1px solid #ecdfe3;
        font-size: 0.86rem;
        line-height: 1.55;
        color: #475569;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .link-btn {
        text-decoration: none;
    }

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
</style>
