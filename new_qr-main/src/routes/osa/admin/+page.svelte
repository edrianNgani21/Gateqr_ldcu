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
    let adminType = $state('Office of Student Affairs');
    let selectedDepartmentId = $state('');
    let loading = $state(false);
    let error = $state('');
    let success = $state('');
    let admins = $state<any[]>([]);
    let loadingAdmins = $state(false);
    let hasPin = $state(false);
    let checkingPin = $state(true);

    const isPrimaryAdmin = $derived((data?.userEmail || '').trim().toLowerCase() === 'aluban98304@liceo.edu.ph');

    const adminTypes = [
        'Office of Student Affairs',
        'Safety and Security',
        'Academic Department Head',
        'Administrative Department'
    ];

    const adminTypeCategories = [
        { 
            key: 'Office of Student Affairs', 
            label: 'Office of Student Affairs',
            badgeBg: 'rgba(107, 26, 42, 0.1)',
            badgeColor: '#6b1a2a',
            icon: 'osa'
        },
        { 
            key: 'Safety and Security', 
            label: 'Safety and Security',
            badgeBg: 'rgba(30, 64, 175, 0.1)',
            badgeColor: '#1e40af',
            icon: 'security'
        },
        { 
            key: 'Academic Department Head', 
            label: 'Academic Department Head',
            badgeBg: 'rgba(21, 128, 61, 0.1)',
            badgeColor: '#15803d',
            icon: 'academic'
        },
        { 
            key: 'Administrative Department', 
            label: 'Administrative Department',
            badgeBg: 'rgba(180, 83, 9, 0.1)',
            badgeColor: '#b45309',
            icon: 'administrative'
        }
    ];

    function getAdminCategoryKey(admin: any): string {
        const ut = (admin?.user_type || '').toLowerCase();
        const id = (admin?.identification || '').toLowerCase();
        const dept = admin?.department;
        const isAdminDept = id === 'staff' || (dept && (dept.administrative_department || dept['Administrative Department']));

        if (ut === 'osa') return 'Office of Student Affairs';
        if (ut === 'safety_security' || ut.includes('security')) return 'Safety and Security';
        if (ut === 'dean' || id === 'faculty' || id === 'staff') {
            if (isAdminDept) return 'Administrative Department';
            return 'Academic Department Head';
        }
        return 'Office of Student Affairs';
    }

    function getDepartmentDisplay(admin: any): string {
        return admin?.department?.academic_department || 
               admin?.department?.['Academic Department'] || 
               admin?.department?.administrative_department || 
               admin?.department?.['Administrative Department'] || 
               admin?.department?.department_name || 
               '—';
    }

    function formatRole(admin: any) {
        const ut = (admin?.user_type || '').toLowerCase();
        const id = (admin?.identification || '').toLowerCase();
        const deptName = getDepartmentDisplay(admin);

        if (ut === 'osa') return 'Office of Student Affairs';
        if (ut === 'safety_security' || ut.includes('security')) return 'Safety and Security';
        if (ut === 'dean' || id === 'faculty' || id === 'staff') {
            if (id === 'staff' || (admin?.department?.administrative_department || admin?.department?.['Administrative Department'])) {
                return deptName !== '—' ? `Administrative Department (${deptName})` : 'Administrative Department';
            }
            return deptName !== '—' ? `Academic Department Head (${deptName})` : 'Academic Department Head';
        }
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

        if ((adminType === 'Academic Department Head' || adminType === 'Administrative Department') && !selectedDepartmentId) {
            error = `Please select an ${adminType === 'Administrative Department' ? 'Administrative Department' : 'Academic Department'}`;
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
                    pin: adminPin.trim(),
                    department_id: selectedDepartmentId ? parseInt(selectedDepartmentId) : null
                })
            });

            if (res.ok) {
                success = 'Admin added successfully!';
                adminEmail = '';
                adminPassword = '';
                adminPin = '';
                selectedDepartmentId = '';
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
        selectedDepartmentId = '';
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

<svelte:head>
    <title>Accounts — OSA | GateQR</title>
    <meta name="description" content="Manage administrative and department head accounts in GateQR." />
</svelte:head>

<AppShell userEmail={data.userEmail} showSidebar={true}>
    <NavBar title="Accounts" />
    
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
                            <select id="adminType" bind:value={adminType} onchange={() => selectedDepartmentId = ''} disabled={loading} class="form-input">
                                {#each adminTypes as type}
                                    <option value={type}>{type}</option>
                                {/each}
                            </select>
                        </div>
                    </div>

                    {#if adminType === 'Academic Department Head'}
                        <div class="form-group full-width">
                            <label for="academicDept">
                                <span class="label-text">Academic Department</span>
                                <span class="label-required">*</span>
                            </label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                                <select id="academicDept" bind:value={selectedDepartmentId} disabled={loading} class="form-input">
                                    <option value="" disabled selected>Select an academic department...</option>
                                    {#each (data.academicDepartments || []) as dept}
                                        <option value={String(dept.id)}>{dept.name}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                    {:else if adminType === 'Administrative Department'}
                        <div class="form-group full-width">
                            <label for="adminDept">
                                <span class="label-text">Administrative Department</span>
                                <span class="label-required">*</span>
                            </label>
                            <div class="input-wrapper">
                                <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                    <polyline points="9 22 9 12 15 12 15 22"/>
                                </svg>
                                <select id="adminDept" bind:value={selectedDepartmentId} disabled={loading} class="form-input">
                                    <option value="" disabled selected>Select an administrative department...</option>
                                    {#each (data.administrativeDepartments || []) as dept}
                                        <option value={String(dept.id)}>{dept.name}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                    {/if}

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
                <div class="admin-type-sections">
                    {#each adminTypeCategories as category}
                        {@const groupAdmins = admins.filter(a => getAdminCategoryKey(a) === category.key)}
                        <div class="admin-type-section-card">
                            <div class="admin-type-section-header">
                                <div class="type-header-left">
                                    <span class="type-icon-bubble" style="background: {category.badgeBg}; color: {category.badgeColor};">
                                        {#if category.key === 'Office of Student Affairs'}
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                            </svg>
                                        {:else if category.key === 'Safety and Security'}
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                            </svg>
                                        {:else if category.key === 'Academic Department Head'}
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                                                <path d="M6 12v5c3 3 9 3 12 0v-5"/>
                                            </svg>
                                        {:else}
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                                            </svg>
                                        {/if}
                                    </span>
                                    <h3>{category.label}</h3>
                                    <span class="type-count-badge">{groupAdmins.length}</span>
                                </div>
                            </div>

                            {#if groupAdmins.length === 0}
                                <div class="empty-category-row">
                                    <span>No accounts currently registered under {category.label}.</span>
                                </div>
                            {:else}
                                {@const hasDeptCol = category.key !== 'Office of Student Affairs' && category.key !== 'Safety and Security'}
                                <div class="admin-row-table" class:no-dept={!hasDeptCol}>
                                    <div class="row-table-header">
                                        <span class="col-account">Account Email</span>
                                        {#if hasDeptCol}
                                            <span class="col-dept">Department / Affiliation</span>
                                        {/if}
                                        <span class="col-date">Date Created</span>
                                        <span class="col-status">Status</span>
                                        <span class="col-actions">Actions</span>
                                    </div>

                                    <div class="row-table-body">
                                        {#each groupAdmins as admin}
                                            <div class="admin-table-row">
                                                <!-- Col 1: Account Email & Avatar -->
                                                <div class="col-account">
                                                    <div class="admin-avatar" class:active={admin.is_active} class:inactive={!admin.is_active}>
                                                        {admin.email.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div class="account-meta">
                                                        <span class="account-email" title={admin.email}>{admin.email}</span>
                                                    </div>
                                                </div>

                                                {#if hasDeptCol}
                                                    <!-- Col 2: Department / Affiliation -->
                                                    <div class="col-dept">
                                                        <span class="dept-text">{getDepartmentDisplay(admin)}</span>
                                                    </div>
                                                {/if}

                                                <!-- Col 3: Created Date -->
                                                <div class="col-date">
                                                    <span class="date-text">{new Date(admin.created_at).toLocaleDateString()}</span>
                                                </div>

                                                <!-- Col 4: Status Badge -->
                                                <div class="col-status">
                                                    <span class="status-pill" class:active={admin.is_active} class:inactive={!admin.is_active}>
                                                        <span class="status-dot"></span>
                                                        {admin.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </div>

                                                <!-- Col 5: Actions -->
                                                <div class="col-actions">
                                                    {#if isPrimaryAdmin}
                                                        <button 
                                                            class="row-action-btn toggle-btn"
                                                            class:activate={!admin.is_active}
                                                            class:deactivate={admin.is_active}
                                                            onclick={() => toggleAdminStatus(admin.user_id, admin.is_active)}
                                                            title={admin.is_active ? 'Deactivate account' : 'Activate account'}
                                                        >
                                                            {admin.is_active ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                        <button 
                                                            class="row-action-btn delete-btn" 
                                                            onclick={() => deleteAdmin(admin.user_id)}
                                                            title="Delete admin"
                                                        >
                                                            Delete
                                                        </button>
                                                    {:else}
                                                        <span class="read-only-badge">View Only</span>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
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

    /* Admin Type Sections & By-Row List */
    .admin-type-sections {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .admin-type-section-card {
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
    }

    .admin-type-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.9rem 1.25rem;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
    }

    .type-header-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .type-icon-bubble {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .type-header-left h3 {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .type-count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.15rem 0.6rem;
        font-size: 0.75rem;
        font-weight: 700;
        border-radius: 999px;
        background: var(--surface-hover);
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }

    .empty-category-row {
        padding: 1.75rem 1.25rem;
        text-align: center;
        color: var(--text-dim);
        font-size: 0.875rem;
        font-style: italic;
    }

    .admin-row-table {
        width: 100%;
        display: flex;
        flex-direction: column;
    }

    .row-table-header {
        display: grid;
        grid-template-columns: 2.2fr 1.8fr 1fr 1fr 1.4fr;
        gap: 1rem;
        padding: 0.75rem 1.25rem;
        background: var(--surface-hover);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-secondary);
        border-bottom: 1px solid var(--border);
    }

    .row-table-body {
        display: flex;
        flex-direction: column;
    }

    .admin-table-row {
        display: grid;
        grid-template-columns: 2.2fr 1.8fr 1fr 1fr 1.4fr;
        gap: 1rem;
        align-items: center;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--border-light, #f1f5f9);
        transition: background 0.15s;
    }

    .admin-row-table.no-dept .row-table-header,
    .admin-row-table.no-dept .admin-table-row {
        grid-template-columns: 3fr 1.2fr 1.2fr 1.4fr;
    }

    .admin-table-row:last-child {
        border-bottom: none;
    }

    .admin-table-row:hover {
        background: var(--surface-hover);
    }

    .col-account {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
    }

    .admin-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--maroon);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
        font-weight: 700;
        flex-shrink: 0;
        transition: all 0.2s;
    }

    .admin-avatar.active {
        background: #10b981;
    }

    .admin-avatar.inactive {
        background: #6b7280;
    }

    .account-meta {
        min-width: 0;
    }

    .col-account .account-email {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: block;
    }

    .col-dept .dept-text {
        font-size: 0.85rem;
        color: var(--text-secondary);
        font-weight: 500;
    }

    .col-date .date-text {
        font-size: 0.825rem;
        color: var(--text-dim);
    }

    .col-status .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.65rem;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
    }

    .status-pill.active {
        background: #d1fae5;
        color: #065f46;
    }

    .status-pill.inactive {
        background: #f1f5f9;
        color: #64748b;
    }

    .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }

    .col-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        justify-content: flex-end;
    }

    .row-action-btn {
        padding: 0.35rem 0.75rem;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        border: 1px solid transparent;
    }

    .row-action-btn.toggle-btn.deactivate {
        background: #fff1f2;
        color: #be123c;
        border-color: #fecdd3;
    }

    .row-action-btn.toggle-btn.deactivate:hover {
        background: #ffe4e6;
    }

    .row-action-btn.toggle-btn.activate {
        background: #ecfdf5;
        color: #047857;
        border-color: #a7f3d0;
    }

    .row-action-btn.toggle-btn.activate:hover {
        background: #d1fae5;
    }

    .row-action-btn.delete-btn {
        background: var(--surface);
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }

    .row-action-btn.delete-btn:hover {
        background: #ef4444;
        color: white;
        border-color: #ef4444;
    }

    .read-only-badge {
        font-size: 0.75rem;
        color: var(--text-dim);
        font-style: italic;
    }

    @media (max-width: 840px) {
        .row-table-header {
            display: none;
        }

        .admin-table-row {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
            padding: 1rem;
        }

        .col-actions {
            width: 100%;
            justify-content: flex-start;
            margin-top: 0.5rem;
        }
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