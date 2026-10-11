<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { supabaseClient } from '$lib/supabaseClient';

    let { data } = $props();

    const navLinks = [
        { label: 'Applications', href: '/osa' },
        { label: 'Add Admin', href: '/osa/admin' },
        { label: 'Departments', href: '/osa/departments' }
    ];

    let showForm = $state(false);
    let adminEmail = $state('');
    let adminPassword = $state('');
    let adminPin = $state('');
    let adminType = $state('OSA');
    let loading = $state(false);
    let error = $state('');
    let success = $state('');
    let admins = $state<any[]>([]);
    let loadingAdmins = $state(false);
    let hasPin = $state(false);
    let checkingPin = $state(true);

    const isPrimaryAdmin = $derived((data?.userEmail || '').trim().toLowerCase() === 'aluban98304@liceo.edu.ph');

    const adminTypes = ['OSA', 'Safety Security', 'Dean'];

    function formatRole(admin: any) {
        const ut = (admin?.user_type || '').toLowerCase();
        const id = (admin?.identification || '').toLowerCase();
        if (ut === 'osa') return 'OSA Admin';
        if (ut === 'safety_security' || ut.includes('security')) return 'Safety Security';
        if (ut === 'dean' || id === 'faculty') return 'Dean';
        return admin?.user_type || 'Admin';
    }

    async function checkPinStatus() {
        checkingPin = true;
        try {
            const res = await fetch('/api/auth/settings');
            if (res.ok) {
                const sData = await res.json();
                hasPin = Boolean(sData.has_pin);
            }
        } catch (err) {
            console.error('Error checking PIN status:', err);
        } finally {
            checkingPin = false;
        }
    }

    async function loadAdmins() {
        loadingAdmins = true;
        try {
            const res = await fetch('/api/osa/admin');
            if (res.ok) {
                const data = await res.json();
                admins = data.users || [];
            }
        } catch (err) {
            console.error('Error loading admins:', err);
        } finally {
            loadingAdmins = false;
        }
    }

    // Load admins & check PIN on component mount & subscribe to realtime updates
    $effect(() => {
        loadAdmins();
        checkPinStatus();
        const channel = supabaseClient
            .channel('osa-admins-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
                loadAdmins();
            })
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    });

    async function handleSubmit() {
        if (!isPrimaryAdmin) {
            error = 'Permission denied. Only the primary OSA administrator (aluban98304@liceo.edu.ph) is authorized to add new admins.';
            return;
        }

        if (!adminEmail || !adminType) {
            error = 'Please enter an email and select an Admin Type';
            return;
        }

        if (adminPassword && adminPassword.length < 6) {
            error = 'Password must be at least 6 characters long';
            return;
        }

        if (hasPin && (!adminPin || !/^\d{4}$/.test(adminPin.trim()))) {
            error = 'Please enter your 4-digit security PIN to authorize adding this admin account';
            return;
        }

        loading = true;
        error = '';
        success = '';

        try {
            const res = await fetch('/api/osa/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: adminEmail.trim(),
                    user_type: adminType,
                    password: adminPassword.trim() || 'Admin123!',
                    pin: adminPin.trim()
                })
            });

            if (res.ok) {
                success = 'Admin added successfully!';
                adminEmail = '';
                adminPassword = '';
                adminPin = '';
                showForm = false;
                loadAdmins(); // Reload admin list
            } else {
                const data = await res.json();
                error = data.error || 'Failed to add admin';
            }
        } catch (err) {
            error = 'An error occurred. Please try again.';
        } finally {
            loading = false;
        }
    }

    function cancelForm() {
        showForm = false;
        adminEmail = '';
        adminPassword = '';
        adminPin = '';
        error = '';
        success = '';
    }

    async function deleteAdmin(userId: number) {
        if (!confirm('Are you sure you want to delete this admin account?')) {
            return;
        }

        try {
            const res = await fetch('/api/osa/admin', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId })
            });

            if (res.ok) {
                success = 'Admin deleted successfully!';
                loadAdmins(); // Reload admin list
            } else {
                const data = await res.json();
                error = data.error || 'Failed to delete admin';
            }
        } catch (err) {
            error = 'An error occurred. Please try again.';
        }
    }

    async function toggleAdminStatus(userId: number, currentStatus: boolean) {
        const action = currentStatus ? 'deactivate' : 'activate';
        if (!confirm(`Are you sure you want to ${action} this admin account?`)) {
            return;
        }

        try {
            const res = await fetch('/api/osa/admin', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, is_active: !currentStatus })
            });

            if (res.ok) {
                success = `Admin ${action}d successfully!`;
                loadAdmins(); // Reload admin list
            } else {
                const data = await res.json();
                error = data.error || `Failed to ${action} admin`;
            }
        } catch (err) {
            error = 'An error occurred. Please try again.';
        }
    }
</script>

<AppShell userEmail={data.userEmail} showSidebar={true}>
    <NavBar title="Add Admin" />
    
    <div class="admin-container">

        {#if success}
            <div class="alert alert-success">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                {success}
            </div>
        {/if}

        {#if error}
            <div class="alert alert-error">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
            </div>
        {/if}

        {#if !isPrimaryAdmin}
            <div class="restriction-notice-card">
                <div class="restriction-badge">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <span>RESTRICTED ACCESS</span>
                </div>
                <h2>Admin Management Restricted</h2>
                <p>
                    Only the primary OSA administrator (<strong>aluban98304@liceo.edu.ph</strong>) is authorized to create, activate, deactivate, or delete administrator accounts. You have view-only access to the administrator directory below.
                </p>
            </div>
        {:else if !showForm}
            {#if !checkingPin && !hasPin}
                <div class="pin-warning-alert">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    <div>
                        <strong>4-Digit Security PIN Required:</strong>
                        <span>You must create your 4-digit Security PIN first in Admin Settings before adding new admin accounts.</span>
                    </div>
                </div>
            {/if}

            <div class="empty-state-card">
                <div class="empty-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="8.5" cy="7" r="4"/>
                        <line x1="20" y1="8" x2="20" y2="14"/>
                        <line x1="23" y1="11" x2="17" y2="11"/>
                    </svg>
                </div>
                <h2>No Admin Creation in Progress</h2>
                <p>Click the button below to create a new admin account (4-digit PIN required)</p>
                <button class="primary-btn" onclick={() => showForm = true} disabled={!hasPin}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add New Admin
                </button>
            </div>
        {:else}
            <div class="form-card">
                <div class="form-header">
                    <h2>New Admin Details</h2>
                    <p class="form-subtitle">Fill in the information below and authorize with your 4-digit security PIN to proceed</p>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label for="adminEmail">
                            <span class="label-text">Email Address</span>
                            <span class="label-required">*</span>
                        </label>
                        <div class="input-wrapper">
                            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                                <polyline points="22,6 12,13 2,6"/>
                            </svg>
                            <input 
                                id="adminEmail" 
                                type="email" 
                                bind:value={adminEmail} 
                                placeholder="admin@liceo.edu.ph"
                                disabled={loading}
                                class="form-input"
                            />
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="adminType">
                            <span class="label-text">Admin Type</span>
                            <span class="label-required">*</span>
                        </label>
                        <div class="input-wrapper">
                            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                            </svg>
                            <select id="adminType" bind:value={adminType} disabled={loading} class="form-input">
                                {#each adminTypes as type}
                                    <option value={type}>{type}</option>
                                {/each}
                            </select>
                        </div>
                    </div>

                    <div class="form-group full-width">
                        <label for="adminPassword">
                            <span class="label-text">Account Password</span>
                            <span class="label-optional">(optional - default: Admin123!)</span>
                        </label>
                        <div class="input-wrapper">
                            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            <input 
                                id="adminPassword" 
                                type="password" 
                                bind:value={adminPassword} 
                                placeholder="Default: Admin123! (or set custom password)"
                                disabled={loading}
                                class="form-input"
                            />
                        </div>
                    </div>

                    {#if hasPin}
                    <div class="form-group full-width">
                        <label for="adminPin">
                            <span class="label-text">Authorize with Your 4-Digit Security PIN</span>
                            <span class="label-required">*</span>
                        </label>
                        <div class="input-wrapper">
                            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <circle cx="12" cy="16" r="1.5"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            <input 
                                id="adminPin" 
                                type="password" 
                                maxlength="4"
                                pattern="[0-9]*"
                                inputmode="numeric"
                                bind:value={adminPin} 
                                placeholder="••••"
                                disabled={loading}
                                class="form-input pin-input"
                            />
                        </div>
                        <span class="field-hint">Enter your 4-digit security PIN set on your account to authorize creating this admin.</span>
                    </div>
                    {/if}
                </div>

                <div class="form-actions">
                    <button class="btn-secondary" onclick={cancelForm} disabled={loading}>
                        Cancel
                    </button>
                    <button class="btn-primary" onclick={handleSubmit} disabled={loading || !adminEmail || (hasPin && adminPin.length < 4)}>
                        {#if loading}
                            <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                            </svg>
                            Authorizing...
                        {:else}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"/>
                                <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            Authorize & Add Admin
                        {/if}
                    </button>
                </div>
            </div>
        {/if}

        <!-- Admin List Section -->
        <div class="admin-list-section">
            <div class="section-header">
                <h2>Active Admin Accounts</h2>
                <button class="refresh-btn" onclick={loadAdmins} disabled={loadingAdmins}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M23 4v6h-6"/>
                        <path d="M1 20v-6h6"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Refresh
                </button>
            </div>

            {#if loadingAdmins}
                <div class="loading-state">
                    <svg class="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    <p>Loading admin accounts...</p>
                </div>
            {:else if admins.length === 0}
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <line x1="23" y1="11" x2="17" y2="11"/>
                        <line x1="20" y1="8" x2="20" y2="14"/>
                    </svg>
                    <p>No admin accounts found.</p>
                </div>
            {:else}
                <div class="admin-grid">
                    {#each admins as admin}
                        <div class="admin-card">
                            <div class="admin-header">
                                <div class="admin-avatar" class:active={admin.is_active} class:inactive={!admin.is_active}>
                                    {admin.email.charAt(0).toUpperCase()}
                                </div>
                                <div class="admin-info">
                                    <h3>{admin.email}</h3>
                                    <div class="badges">
                                        <span class="admin-type-badge">{formatRole(admin)}</span>
                                        <span class="status-badge" class:active={admin.is_active} class:inactive={!admin.is_active}>
                                            {admin.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="admin-details">
                                <div class="detail-item">
                                    <span class="detail-label">Role:</span>
                                    <span class="detail-value">{formatRole(admin)}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Created:</span>
                                    <span class="detail-value">{new Date(admin.created_at).toLocaleDateString()}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Status:</span>
                                    <span class="detail-value status-text" class:active={admin.is_active} class:inactive={!admin.is_active}>
                                        {admin.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                            </div>
                            <div class="admin-actions">
                                {#if isPrimaryAdmin}
                                    <button 
                                        class="toggle-btn"
                                        class:activate={!admin.is_active}
                                        class:deactivate={admin.is_active}
                                        onclick={() => toggleAdminStatus(admin.user_id, admin.is_active)}
                                        title={admin.is_active ? 'Deactivate account' : 'Activate account'}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            {#if admin.is_active}
                                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                <line x1="9" y1="9" x2="15" y2="15"/>
                                                <line x1="15" y1="9" x2="9" y2="15"/>
                                            {:else}
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                                <polyline points="22 4 12 14.01 9 11.01"/>
                                            {/if}
                                        </svg>
                                        {admin.is_active ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button 
                                        class="delete-btn" 
                                        onclick={() => deleteAdmin(admin.user_id)}
                                        title="Delete admin"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                        Delete
                                    </button>
                                {:else}
                                    <span class="read-only-badge">View Only</span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</AppShell>

<style>
    .admin-container {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .page-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
    }

    .header-content h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0 0 0.5rem 0;
        color: var(--text-primary);
    }

    .header-subtitle {
        font-size: 0.9rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .header-icon {
        padding: 1rem;
        background: var(--maroon-muted);
        border-radius: 12px;
        color: var(--maroon);
    }

    .alert {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        border-radius: 12px;
        font-size: 0.875rem;
        font-weight: 500;
    }

    .alert-success {
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
    }

    .alert-error {
        background: #fef2f2;
        color: #b91c1c;
        border: 1px solid #fca5a5;
    }

    .empty-state-card {
        background: var(--card-bg);
        border: 2px dashed var(--border);
        border-radius: 16px;
        padding: 3rem 2rem;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
    }

    .empty-icon {
        color: var(--text-dim);
        margin-bottom: 0.5rem;
    }

    .empty-state-card h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .empty-state-card p {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .primary-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.875rem 1.75rem;
        background: var(--maroon);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, transform 0.2s;
    }

    .primary-btn:hover {
        background: var(--maroon-light);
        transform: translateY(-2px);
    }

    .form-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .form-header {
        margin-bottom: 2rem;
        padding-bottom: 1.5rem;
        border-bottom: 1px solid var(--border);
    }

    .form-header h2 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
        color: var(--text-primary);
    }

    .form-subtitle {
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin: 0;
    }

    .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
    }

    .full-width {
        grid-column: 1 / -1;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .label-text {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
    }

    .label-required {
        color: #dc2626;
        margin-left: 0.25rem;
    }

    .label-optional {
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 400;
        margin-left: 0.4rem;
    }

    .input-wrapper {
        position: relative;
    }

    .input-icon {
        position: absolute;
        left: 1rem;
        top: 50%;
        transform: translateY(-50%);
        color: var(--text-dim);
        pointer-events: none;
    }

    .form-input {
        width: 100%;
        padding: 0.875rem 1rem 0.875rem 2.75rem;
        border: 1.5px solid var(--border);
        border-radius: 10px;
        font-size: 0.875rem;
        font-family: inherit;
        background: var(--surface);
        color: var(--text-primary);
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .form-input:focus {
        outline: none;
        border-color: var(--maroon);
        box-shadow: 0 0 0 3px rgba(107, 26, 42, 0.1);
    }

    .form-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .form-actions {
        display: flex;
        gap: 1rem;
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--border);
    }

    .btn-secondary,
    .btn-primary {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.875rem 1.5rem;
        border: none;
        border-radius: 10px;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .btn-secondary {
        background: var(--surface);
        color: var(--text-primary);
        border: 1.5px solid var(--border);
    }

    .btn-secondary:hover {
        background: var(--surface-hover);
        border-color: var(--text-dim);
    }

    .btn-primary {
        background: var(--maroon);
        color: white;
    }

    .btn-primary:hover {
        background: var(--maroon-light);
        transform: translateY(-1px);
    }

    .btn-secondary:disabled,
    .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .spinner {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
        .form-grid {
            grid-template-columns: 1fr;
        }

        .page-header {
            flex-direction: column;
        }

        .header-icon {
            display: none;
        }

        .admin-grid {
            grid-template-columns: 1fr;
        }
    }

    /* Admin List Styles */
    .admin-list-section {
        margin-top: 2rem;
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
    }

    .section-header h2 {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
    }

    .refresh-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--surface);
        color: var(--text-primary);
        border: 1.5px solid var(--border);
        border-radius: 8px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .refresh-btn:hover:not(:disabled) {
        background: var(--surface-hover);
        border-color: var(--text-dim);
    }

    .refresh-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .loading-state,
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 2rem;
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        gap: 1rem;
        color: var(--text-secondary);
    }

    .loading-state svg {
        color: var(--maroon);
    }

    .empty-state svg {
        color: var(--text-dim);
    }

    .admin-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1rem;
    }

    .admin-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1.25rem;
        transition: all 0.2s;
    }

    .admin-card:hover {
        border-color: var(--maroon);
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .admin-header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
    }

    .admin-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--maroon);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.25rem;
        font-weight: 600;
        transition: all 0.2s;
    }

    .admin-avatar.active {
        background: #10b981;
    }

    .admin-avatar.inactive {
        background: #6b7280;
    }

    .admin-info {
        flex: 1;
        min-width: 0;
    }

    .admin-info h3 {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 0.25rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .badges {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .admin-type-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        background: var(--maroon-muted);
        color: var(--maroon);
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
    }

    .status-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 500;
    }

    .status-badge.active {
        background: #d1fae5;
        color: #059669;
    }

    .status-badge.inactive {
        background: #f3f4f6;
        color: #6b7280;
    }

    .admin-details {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--border);
    }

    .detail-item {
        display: flex;
        justify-content: space-between;
        font-size: 0.875rem;
    }

    .detail-label {
        color: var(--text-secondary);
        font-weight: 500;
    }

    .detail-value {
        color: var(--text-primary);
        font-weight: 500;
    }

    .status-text.active {
        color: #059669;
        font-weight: 600;
    }

    .status-text.inactive {
        color: #6b7280;
        font-weight: 600;
    }

    .admin-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
    }

    .toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border: 1px solid;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .toggle-btn.activate {
        background: #d1fae5;
        color: #059669;
        border-color: #10b981;
    }

    .toggle-btn.activate:hover {
        background: #a7f3d0;
    }

    .toggle-btn.deactivate {
        background: #fef3c7;
        color: #d97706;
        border-color: #f59e0b;
    }

    .toggle-btn.deactivate:hover {
        background: #fde68a;
    }

    .delete-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: #fef2f2;
        color: #dc2626;
        border: 1px solid #fca5a5;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }

    .delete-btn:hover {
        background: #fee2e2;
        border-color: #f87171;
    }

    .pin-input {
        letter-spacing: 0.35rem;
        font-family: monospace;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .field-hint {
        font-size: 0.78rem;
        color: var(--text-secondary);
        margin-top: 0.25rem;
    }

    .pin-warning-alert {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 1rem 1.25rem;
        background: #FFFBEB;
        border: 1px solid #FCD34D;
        border-left: 4px solid #D97706;
        border-radius: 12px;
        color: #92400E;
        font-size: 0.88rem;
        margin-bottom: 0.5rem;
    }

    .pin-warning-alert strong {
        display: block;
        color: #78350F;
        font-weight: 700;
        margin-bottom: 0.15rem;
    }

    .restriction-notice-card {
        background: var(--card-bg, #ffffff);
        border: 1.5px solid rgba(107, 29, 47, 0.2);
        border-radius: 16px;
        padding: 2.25rem 2rem;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.85rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
    }

    .restriction-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.85rem;
        background: #FEF2F2;
        border: 1px solid #FCA5A5;
        border-radius: 9999px;
        color: #991B1B;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.06em;
    }

    .restriction-notice-card h2 {
        font-size: 1.35rem;
        font-weight: 800;
        color: var(--maroon, #6B1D2F);
        margin: 0;
    }

    .restriction-notice-card p {
        font-size: 0.92rem;
        color: var(--text-secondary, #64748B);
        max-width: 580px;
        line-height: 1.6;
        margin: 0;
    }

    .read-only-badge {
        display: inline-block;
        padding: 0.35rem 0.75rem;
        background: #F1F5F9;
        color: #64748B;
        border-radius: 6px;
        font-size: 0.78rem;
        font-weight: 600;
    }
</style>