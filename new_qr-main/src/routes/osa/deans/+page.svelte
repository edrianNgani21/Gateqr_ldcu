<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { invalidateAll } from '$app/navigation';
    import { supabaseClient } from '$lib/supabaseClient';

    let { data } = $props();
    let deans = $derived(data.deans);
    let userEmail = $derived(data.userEmail);

    // Realtime subscription for deans and departments
    $effect(() => {
        const channel = supabaseClient
            .channel('osa-deans-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'user' }, () => {
                invalidateAll();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'department' }, () => {
                invalidateAll();
            })
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    });

    let showForm = $state(false);
    let newDeanEmail = $state('');
    let newDeanPassword = $state('');
    let selectedDepartment = $state('');
    let loading = $state(false);
    let editingDeanId: number | null = $state(null);

    let statusFilter = $state('all'); // 'all', 'assigned', 'unassigned'

    let filteredDeans = $derived.by(() => {
        if (statusFilter === 'all') return deans;
        return deans.filter(dean => 
            statusFilter === 'assigned' ? dean.department_id != null : dean.department_id == null
        );
    });

    function getDepartmentName(departmentId: number | null): string {
        if (!departmentId) return '';
        const dept = data.departments.find(d => d.department_id === departmentId);
        return dept ? dept.department : '';
    }

    async function handleSave() {
        if (!newDeanEmail) return;

        if (!editingDeanId && (!newDeanPassword || newDeanPassword.length < 6)) {
            alert('Password is required for new dean accounts (minimum 6 characters)');
            return;
        }

        loading = true;
        try {
            const method = editingDeanId ? 'PUT' : 'POST';
            const body: any = editingDeanId
                ? { user_id: editingDeanId, email: newDeanEmail, department_id: selectedDepartment ? parseInt(selectedDepartment) : null }
                : { email: newDeanEmail, password: newDeanPassword, department_id: selectedDepartment ? parseInt(selectedDepartment) : null };

            if (editingDeanId && newDeanPassword) {
                body.password = newDeanPassword;
            }

            const res = await fetch('/api/deans', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                showForm = false;
                newDeanEmail = '';
                newDeanPassword = '';
                selectedDepartment = '';
                editingDeanId = null;
                await invalidateAll();
            } else {
                const data = await res.json();
                alert('Failed to save dean: ' + (data.error || 'Unknown error'));
            }
        } catch(e) {
            alert('Network error');
        } finally {
            loading = false;
        }
    }

    async function handleDelete(user_id: number) {
        if (!confirm('Are you sure you want to delete this dean account?')) return;
        try {
            const res = await fetch('/api/deans', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id })
            });
            if (res.ok) {
                await invalidateAll();
            } else {
                alert('Failed to delete dean');
            }
        } catch(e) {
            alert('Network error');
        }
    }
</script>

<svelte:head>
  <title>Dean Management — OSA | GateQR</title>
  <meta name="description" content="Manage dean accounts and department assignments for GateQR." />
</svelte:head>

<AppShell showSidebar={true} userEmail={userEmail}>
  <NavBar title="Dean Management" links={[]} />

  <div class="deans-container">
    <!-- Header Section -->
    <div class="page-header">
      <div class="header-content">
        <h1>Dean Management</h1>
        <p class="header-subtitle">Create dean accounts and assign them to departments</p>
      </div>
      <div class="header-actions">
        <a href="/osa/departments" class="secondary-button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          Department Management
        </a>
        <button class="primary-button" onclick={() => { showForm = true; editingDeanId = null; newDeanEmail = ''; newDeanPassword = ''; selectedDepartment = ''; }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Dean
        </button>
      </div>
    </div>

    <!-- Status Filter -->
    <div class="status-filter">
      <button 
        class={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
        onclick={() => statusFilter = 'all'}
      >
        All Deans
      </button>
      <button 
        class={`filter-tab ${statusFilter === 'assigned' ? 'active' : ''}`}
        onclick={() => statusFilter = 'assigned'}
      >
        Assigned
      </button>
      <button 
        class={`filter-tab ${statusFilter === 'unassigned' ? 'active' : ''}`}
        onclick={() => statusFilter = 'unassigned'}
      >
        Unassigned
      </button>
    </div>

    <!-- New dean form -->
    {#if showForm}
      <div class="form-card">
        <div class="form-header">
          <div class="form-header-content">
            <h2>{editingDeanId ? 'Edit Dean' : 'Add New Dean'}</h2>
            <p class="form-subtitle">Fill in the dean details below</p>
          </div>
          <button class="close-button" onclick={() => { showForm = false; editingDeanId = null; newDeanEmail = ''; newDeanPassword = ''; selectedDepartment = ''; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="form-grid">
          <div class="form-group">
            <label for="dean-email">Dean Email</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input 
                id="dean-email" 
                type="email" 
                placeholder="dean@liceo.edu.ph" 
                bind:value={newDeanEmail} 
                disabled={loading}
                class="form-input"
              />
            </div>
          </div>
          
          <div class="form-group">
            <label for="dean-password">Account Password</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input 
                id="dean-password" 
                type="password" 
                placeholder={editingDeanId ? "Leave blank to keep current password" : "Enter password (min. 6 characters)"}
                bind:value={newDeanPassword} 
                disabled={loading}
                class="form-input"
              />
            </div>
            <p class="input-hint">
              {editingDeanId ? "Only enter if you wish to reset this dean's password" : "Password used by dean to sign in at /login"}
            </p>
          </div>

          <div class="form-group">
            <label for="department">Assign to Department</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <select 
                id="department" 
                bind:value={selectedDepartment} 
                disabled={loading}
                class="form-input"
              >
                <option value="">No department (unassigned)</option>
                {#each data.departments as dept}
                  <option value={dept.department_id}>{dept.department}</option>
                {/each}
              </select>
            </div>
            <p class="input-hint">
              Leave empty to create dean without department assignment
            </p>
          </div>
        </div>

        <div class="form-actions">
          <button class="secondary-button" onclick={() => { showForm = false; editingDeanId = null; newDeanEmail = ''; newDeanPassword = ''; selectedDepartment = ''; }} disabled={loading}>
            Cancel
          </button>
          <button class="primary-button" onclick={handleSave} disabled={loading}>
            {#if loading}
              <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Saving...
            {:else}
              {editingDeanId ? 'Update Dean' : 'Save Dean'}
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <!-- Dean list -->
    <div class="deans-grid">
      {#each filteredDeans as dean}
        <div class="dean-card">
          <div class="card-header">
            <div class="dean-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div class="dean-info">
              <h3>{dean.email}</h3>
              <p>{dean.department_id ? getDepartmentName(dean.department_id) : 'Unassigned'}</p>
            </div>
            <div class="status-badge {dean.department_id ? 'assigned' : 'unassigned'}">
              {dean.department_id ? '✓ Assigned' : '○ Unassigned'}
            </div>
          </div>

          <div class="card-body">
            <div class="info-row">
              <span class="label">Status</span>
              <span class="value">{dean.department_id ? `🟢 ${getDepartmentName(dean.department_id)}` : '⚪ No Department'}</span>
            </div>
            <div class="info-row">
              <span class="label">Created</span>
              <span class="value">{new Date(dean.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          <div class="card-footer">
            <button class="action-button edit-button" onclick={() => { 
              newDeanEmail = dean.email; 
              selectedDepartment = dean.department_id?.toString() || ''; 
              editingDeanId = dean.user_id; 
              showForm = true; 
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
            <button class="action-button delete-button" onclick={() => handleDelete(dean.user_id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
</AppShell>

<style>
  .deans-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* Header Section */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .header-content h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
  }

  .header-subtitle {
    font-size: 0.95rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 0.75rem;
  }

  .primary-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: var(--maroon);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .primary-button:hover {
    background: var(--maroon-light);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.3);
  }

  .primary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  /* Status Filter */
  .status-filter {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 10px;
  }

  .filter-tab {
    flex: 1;
    padding: 0.625rem 1rem;
    background: transparent;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .filter-tab:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .filter-tab.active {
    background: var(--maroon);
    color: white;
    font-weight: 600;
  }

  /* Form Group */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
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

  .input-hint {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin-top: 0.25rem;
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

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
    }
    
    .header-actions {
      width: 100%;
      flex-direction: column;
    }
    
    .header-actions button {
      width: 100%;
      justify-content: center;
    }
  }

  /* Form Card */
  .form-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 2rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .form-header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .form-header-content {
    flex: 1;
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

  .close-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .close-button:hover {
    background: var(--surface-hover);
    border-color: var(--text-dim);
    color: var(--text-primary);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  @media (max-width: 768px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
  }

  .form-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .secondary-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: var(--surface);
    color: var(--text-primary);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .secondary-button:hover {
    background: var(--surface-hover);
    border-color: var(--text-dim);
  }

  .secondary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Deans Grid */
  .deans-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  @media (max-width: 768px) {
    .deans-grid {
      grid-template-columns: 1fr;
    }
  }

  .dean-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    transition: all 0.2s;
  }

  .dean-card:hover {
    border-color: var(--maroon);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-2px);
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .dean-icon {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, var(--maroon-tint), var(--maroon-muted));
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--maroon);
    flex-shrink: 0;
  }

  .dean-info {
    flex: 1;
    min-width: 0;
  }

  .dean-info h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.25rem 0;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dean-info p {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    white-space: nowrap;
  }

  .status-badge.assigned {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #86efac;
  }

  .status-badge.unassigned {
    background: #f3f4f6;
    color: #6b7280;
    border: 1px solid #d1d5db;
  }

  .card-body {
    padding: 1rem 1.5rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }

  .info-row .label {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .info-row .value {
    color: var(--text-primary);
    font-weight: 500;
  }

  .card-footer {
    display: flex;
    gap: 0;
    border-top: 1px solid var(--border);
  }

  .action-button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    background: transparent;
    transition: all 0.2s;
  }

  .edit-button {
    color: var(--text-secondary);
    border-right: 1px solid var(--border);
  }

  .edit-button:hover {
    background: var(--maroon-muted);
    color: var(--maroon);
  }

  .delete-button {
    color: #dc2626;
  }

  .delete-button:hover {
    background: #fef2f2;
    color: #b91c1c;
  }
</style>