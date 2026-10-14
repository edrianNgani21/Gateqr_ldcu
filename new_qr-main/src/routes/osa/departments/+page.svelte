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
    let formType = $state<'academic' | 'administrative'>('academic');
    let selectedTable = $state<'academic' | 'administrative'>('academic');
    let newDeptName = $state('');
    let loading = $state(false);
    let editingDeptId: number | null = $state(null);
    let statusFilter = $state<'active' | 'inactive'>('active');

    const navLinks = [];

    let filteredAcademicDepartments = $derived.by(() => {
        const list = departments.filter(d => d.type === 'academic');
        return list.filter(dept => 
            statusFilter === 'active' ? dept.is_active : !dept.is_active
        );
    });

    let filteredAdministrativeDepartments = $derived.by(() => {
        const list = departments.filter(d => d.type === 'administrative');
        return list.filter(dept => 
            statusFilter === 'active' ? dept.is_active : !dept.is_active
        );
    });

    async function handleSave() {
        if (!newDeptName.trim()) return;
        loading = true;
        try {
            const method = editingDeptId ? 'PUT' : 'POST';
            const body = editingDeptId 
                ? { auto_id: editingDeptId, name: newDeptName.trim(), type: formType }
                : { name: newDeptName.trim(), type: formType };

            const res = await fetch('/api/departments', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                selectedTable = formType;
                showForm = false;
                newDeptName = '';
                editingDeptId = null;
                await invalidateAll();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to save department');
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
  <meta name="description" content="Manage college departments and administrative offices for GateQR." />
</svelte:head>

<AppShell showSidebar={true} userEmail={userEmail}>
  <NavBar title="Departments" />

  <div class="departments-container">
    <!-- Header Section -->
    <div class="page-header" style="justify-content: flex-end;">
      <div class="header-actions">
        <!-- + Academic Department Button -->
        <button 
          type="button"
          class="dept-header-btn"
          class:active={showForm && formType === 'academic'}
          onclick={() => { 
            if (showForm && formType === 'academic') {
              showForm = false;
              editingDeptId = null; 
              newDeptName = '';
            } else {
              formType = 'academic'; 
              selectedTable = 'academic';
              editingDeptId = null; 
              newDeptName = ''; 
              showForm = true; 
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Academic Department
        </button>

        <!-- + Administrative Department Button -->
        <button 
          type="button"
          class="dept-header-btn"
          class:active={showForm && formType === 'administrative'}
          onclick={() => { 
            if (showForm && formType === 'administrative') {
              showForm = false;
              editingDeptId = null; 
              newDeptName = '';
            } else {
              formType = 'administrative'; 
              selectedTable = 'administrative';
              editingDeptId = null; 
              newDeptName = ''; 
              showForm = true; 
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Administrative Department
        </button>
      </div>
    </div>

    <!-- Form on Top (when clicked, moves list below it) -->
    {#if showForm}
      <div class="form-card top-form-card">
        <div class="form-header">
          <div class="form-header-content">
            <h2>
              {#if editingDeptId}
                Edit {formType === 'administrative' ? 'Administrative Department' : 'Academic Department'}
              {:else}
                Add {formType === 'administrative' ? 'Administrative Department' : 'Academic Department'}
              {/if}
            </h2>
            <p class="form-subtitle">Fill in the department details below</p>
          </div>
          <button class="close-button" title="Close" aria-label="Close form" onclick={() => { showForm = false; editingDeptId = null; newDeptName = ''; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="form-grid">
          <div class="form-group">
            <label for="dept-name">
              {formType === 'administrative' ? 'Administrative Department Name' : 'Academic Department Name'}
            </label>
            <div class="input-wrapper">
              <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <input 
                id="dept-name" 
                type="text" 
                placeholder={formType === 'administrative' ? 'e.g. Accounting, Human Resources, Registrar Office...' : 'e.g. College of Information Technology, College of Nursing...'} 
                bind:value={newDeptName} 
                disabled={loading}
                class="form-input"
              />
            </div>
            <p class="input-hint">
              Enter the official {formType === 'administrative' ? 'administrative department' : 'academic department'} name
            </p>
          </div>
        </div>

        <div class="form-actions">
          <button class="secondary-button" onclick={() => { showForm = false; editingDeptId = null; newDeptName = ''; }} disabled={loading}>
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

    <!-- Controls Row: Table Selector Button (Academic vs Administrative) & Status Filter (Active / Inactive) -->
    <div class="table-controls-row">
      <!-- Buttons for List Table: Academic and Administrative -->
      <div class="table-type-selector">
        <button 
          type="button"
          class="type-toggle-btn" 
          class:active={selectedTable === 'academic'}
          onclick={() => selectedTable = 'academic'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          Academic Department
          <span class="count-pill">{filteredAcademicDepartments.length}</span>
        </button>
        <button 
          type="button"
          class="type-toggle-btn" 
          class:active={selectedTable === 'administrative'}
          onclick={() => selectedTable = 'administrative'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
          Administrative Department
          <span class="count-pill">{filteredAdministrativeDepartments.length}</span>
        </button>
      </div>

      <!-- Status Filter (Only Active and Inactive) -->
      <div class="status-filter">
        <button 
          type="button"
          class={`filter-tab ${statusFilter === 'active' ? 'active' : ''}`}
          onclick={() => statusFilter = 'active'}
        >
          Active
        </button>
        <button 
          type="button"
          class={`filter-tab ${statusFilter === 'inactive' ? 'active' : ''}`}
          onclick={() => statusFilter = 'inactive'}
        >
          Inactive
        </button>
      </div>
    </div>

    <!-- List Table: Shows selected table (Academic or Administrative) -->
    {#if selectedTable === 'academic'}
      <div class="course-list-section">
        <div class="section-title-row">
          <h2>Academic Department List</h2>
          <span class="count-badge">{filteredAcademicDepartments.length}</span>
        </div>
        <div class="course-list-items">
          {#each filteredAcademicDepartments as dept}
            <div class="course-list-item">
              <span class="course-name">{dept.name}</span>
              <div class="course-actions">
                <span class="course-status-badge {dept.is_active ? 'active' : 'inactive'}">
                  {dept.is_active ? '🟢 Active' : '⚪ Inactive'}
                </span>
                <button class="course-action-btn edit-btn" onclick={() => { 
                  newDeptName = dept.name; 
                  editingDeptId = dept.auto_id; 
                  formType = 'academic';
                  selectedTable = 'academic';
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
          {#if filteredAcademicDepartments.length === 0}
            <p class="no-courses">No academic departments found ({statusFilter}).</p>
          {/if}
        </div>
      </div>
    {:else}
      <div class="course-list-section">
        <div class="section-title-row">
          <h2>Administrative Department List</h2>
          <span class="count-badge">{filteredAdministrativeDepartments.length}</span>
        </div>
        <div class="course-list-items">
          {#each filteredAdministrativeDepartments as dept}
            <div class="course-list-item">
              <span class="course-name">{dept.name}</span>
              <div class="course-actions">
                <span class="course-status-badge {dept.is_active ? 'active' : 'inactive'}">
                  {dept.is_active ? '🟢 Active' : '⚪ Inactive'}
                </span>
                <button class="course-action-btn edit-btn" onclick={() => { 
                  newDeptName = dept.name; 
                  editingDeptId = dept.auto_id; 
                  formType = 'administrative';
                  selectedTable = 'administrative';
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
          {#if filteredAdministrativeDepartments.length === 0}
            <p class="no-courses">No administrative departments found ({statusFilter}).</p>
          {/if}
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

  .dept-header-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    background: #ffffff;
    color: var(--text-primary, #0f172a);
    border: 1.5px solid var(--border, #e2e8f0);
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .dept-header-btn:hover {
    background: var(--surface-hover, #f8fafc);
    border-color: #cbd5e1;
    transform: translateY(-1px);
  }

  .dept-header-btn.active {
    background: var(--maroon, #6b1a2a);
    color: #ffffff;
    border-color: var(--maroon, #6b1a2a);
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.25);
  }

  .dept-header-btn.active:hover {
    background: var(--maroon-light, #822234);
    border-color: var(--maroon-light, #822234);
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

  /* Controls Row: Table selector & Status filter */
  .table-controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .table-type-selector {
    display: inline-flex;
    gap: 0.5rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    padding: 0.35rem;
  }

  .type-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 1.25rem;
    background: transparent;
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .type-toggle-btn:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .type-toggle-btn.active {
    background: var(--maroon);
    color: white;
    box-shadow: 0 2px 8px rgba(107, 26, 42, 0.25);
  }

  .type-toggle-btn .count-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.15rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.08);
    color: inherit;
  }

  .type-toggle-btn.active .count-pill {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }

  /* Status Filter */
  .status-filter {
    display: flex;
    gap: 0.5rem;
    padding: 0.35rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
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

  .section-title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .section-title-row h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.65rem;
    background: var(--maroon-muted);
    color: var(--maroon);
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
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