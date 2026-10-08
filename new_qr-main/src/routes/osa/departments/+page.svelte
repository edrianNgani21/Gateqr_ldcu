<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { invalidateAll } from '$app/navigation';
    import { supabaseClient } from '$lib/supabaseClient';

    let { data } = $props();
    let departments = $derived(data.departments);
    let userEmail = $derived(data.userEmail);

    // Realtime subscription for departments
    $effect(() => {
        const channel = supabaseClient
            .channel('osa-departments-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'department' }, () => {
                invalidateAll();
            })
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    });

    let showForm = $state(false);
    let newDeptName = $state('');
    let newDeptEmail = $state('');
    let loading = $state(false);
    let editingDeptId: number | null = $state(null);
    let statusFilter = $state('all'); // 'all', 'active', 'inactive'

    const navLinks = [];

    let filteredDepartments = $derived.by(() => {
        if (statusFilter === 'all') return departments;
        return departments.filter(dept => 
            statusFilter === 'active' ? dept.is_active : !dept.is_active
        );
    });

    async function handleSave() {
        if (!newDeptName) return;
        loading = true;
        try {
            const method = editingDeptId ? 'PUT' : 'POST';
            const body = editingDeptId 
                ? { auto_id: editingDeptId, name: newDeptName }
                : { name: newDeptName };

            const res = await fetch('/api/departments', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                showForm = false;
                newDeptName = '';
                editingDeptId = null;
                await invalidateAll();
            } else {
                alert('Failed to save department');
            }
        } catch(e) {
            alert('Network error');
        } finally {
            loading = false;
        }
    }

    async function handleDeactivate(auto_id: number) {
        if (!confirm('Are you sure you want to deactivate this department? This will hide it from new applications but preserve all existing data.')) return;
        try {
            const res = await fetch('/api/departments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auto_id })
            });
            if (res.ok) {
                await invalidateAll();
            } else {
                alert('Failed to deactivate department');
            }
        } catch(e) {
            alert('Network error');
        }
    }

    async function handleActivate(auto_id: number) {
        try {
            const res = await fetch('/api/departments', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auto_id })
            });
            if (res.ok) {
                await invalidateAll();
            } else {
                alert('Failed to activate department');
            }
        } catch(e) {
            alert('Network error');
        }
    }

</script>

<svelte:head>
  <title>Departments — OSA | GateQR</title>
  <meta name="description" content="Manage college departments and their dean access for GateQR." />
</svelte:head>

<AppShell showSidebar={true} userEmail={userEmail}>
  <NavBar title="Departments" />

  <div class="departments-container">
    <!-- Header Section -->
    <div class="page-header" style="justify-content: flex-end;">
      <div class="header-actions">
        <a href="/osa/deans" class="secondary-button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          Dean Management
        </a>
        <button class="primary-button" onclick={() => { showForm = !showForm; if (!showForm) { editingDeptId = null; newDeptName = ''; } }}>
          {#if showForm}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Cancel
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Department
          {/if}
        </button>
      </div>
    </div>

    <!-- Status Filter -->
    <div class="status-filter">
      <button 
        class={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
        onclick={() => statusFilter = 'all'}
      >
        All Departments
      </button>
      <button 
        class={`filter-tab ${statusFilter === 'active' ? 'active' : ''}`}
        onclick={() => statusFilter = 'active'}
      >
        Active
      </button>
      <button 
        class={`filter-tab ${statusFilter === 'inactive' ? 'active' : ''}`}
        onclick={() => statusFilter = 'inactive'}
      >
        Inactive
      </button>
    </div>

    <!-- Course List -->
    <div class="course-list-section">
      <h2>Course List</h2>
      <div class="course-list-items">
        {#each filteredDepartments as dept}
          <div class="course-list-item">
            <span class="course-name">{dept.name}</span>
            <div class="course-actions">
              <span class="course-status-badge {dept.is_active ? 'active' : 'inactive'}">
                {dept.is_active ? '🟢 Active' : '⚪ Inactive'}
              </span>
              <button class="course-action-btn edit-btn" onclick={() => { 
                newDeptName = dept.name; 
                editingDeptId = dept.auto_id; 
                showForm = true; 
              }}>
                Edit
              </button>
              {#if dept.is_active}
                <button class="course-action-btn hide-btn" onclick={() => handleDeactivate(dept.auto_id)}>
                  Hide
                </button>
              {:else}
                <button class="course-action-btn activate-btn" onclick={() => handleActivate(dept.auto_id)}>
                  Activate
                </button>
              {/if}
            </div>
          </div>
        {/each}
        {#if filteredDepartments.length === 0}
          <p class="no-courses">No departments found.</p>
        {/if}
      </div>
    </div>

    <!-- New department form -->
    {#if showForm}
      <div class="form-card">
        <div class="form-header">
          <div class="form-header-content">
            <h2>{editingDeptId ? 'Edit Department' : 'Add New Department'}</h2>
            <p class="form-subtitle">Fill in the department details below</p>
          </div>
          <button class="close-button" title="Close" aria-label="Close form" onclick={() => { showForm = false; editingDeptId = null; newDeptName = ''; newDeptEmail = ''; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="form-grid">
          <div class="form-group">
            <label for="dept-name">Department Name</label>
            <div class="input-wrapper">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <input 
                id="dept-name" 
                type="text" 
                placeholder="Enter department name..." 
                bind:value={newDeptName} 
                disabled={loading}
                class="form-input"
              />
            </div>
            <p class="input-hint">
              Enter the department name directly
            </p>
          </div>
        </div>

        <div class="form-actions">
          <button class="secondary-button" onclick={() => { showForm = false; editingDeptId = null; newDeptName = ''; newDeptEmail = ''; }} disabled={loading}>
            Cancel
          </button>
          <button class="primary-button" onclick={handleSave} disabled={loading}>
            {#if loading}
              <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Saving...
            {:else}
              {editingDeptId ? 'Update Department' : 'Save Department'}
            {/if}
          </button>
        </div>
      </div>
    {/if}
  </div>
</AppShell>

<style>
  .departments-container {
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

  /* Course List Section */
  .course-list-section {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.5rem;
  }

  .course-list-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: var(--text-primary);
  }

  .course-list-items {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .course-list-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: all 0.2s;
  }

  .course-list-item:hover {
    border-color: var(--maroon);
    background: var(--surface-hover);
  }

  .course-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .course-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .course-action-btn {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .edit-btn {
    background: var(--maroon-muted);
    color: var(--maroon);
  }

  .edit-btn:hover {
    background: var(--maroon);
    color: white;
  }

  .hide-btn {
    background: #fef3c7;
    color: #d97706;
  }

  .hide-btn:hover {
    background: #fde68a;
    color: #b45309;
  }

  .activate-btn {
    background: #d1fae5;
    color: #059669;
  }

  .activate-btn:hover {
    background: #a7f3d0;
    color: #047857;
  }

  .course-status-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
  }

  .course-status-badge.active {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #86efac;
  }

  .course-status-badge.inactive {
    background: #f3f4f6;
    color: #6b7280;
    border: 1px solid #d1d5db;
  }

  .no-courses {
    text-align: center;
    padding: 2rem;
    color: var(--text-dim);
    font-size: 0.875rem;
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
    
    .page-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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

  .header-actions .secondary-button {
    padding: 0.875rem 1.25rem;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Departments Grid */
  .departments-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

</style>