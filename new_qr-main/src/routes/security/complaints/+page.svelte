<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import { onMount } from 'svelte';
    import { supabaseClient } from '$lib/supabaseClient';

    let { data } = $props();
    let userRole = $derived(data.userRole || 'security');

    let complaints: any[] = $state([]);
    let loading = $state(true);
    let searchQuery = $state('');
    let statusFilter = $state('all');
    let confirmLoading = $state(false);

    async function loadComplaints() {
        loading = true;
        try {
            const res = await fetch('/api/security/complaints');
            if (res.ok) {
                const json = await res.json();
                complaints = json.complaints || [];
            }
        } catch (e) {
            console.error(e);
        }
        loading = false;
    }

    onMount(() => {
        loadComplaints();
    });

    // Realtime subscription for complaints
    $effect(() => {
        const channel = supabaseClient
            .channel('security-complaints-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint' }, () => {
                loadComplaints();
            })
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    });

    async function updateComplaintStatus(id: number, status: string) {
        try {
            const res = await fetch(`/api/security/complaints/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });

            if (res.ok) {
                complaints = complaints.map(c => c.complaint_id === id ? { ...c, status } : c);
            } else {
                const json = await res.json();
                alert(json.error || 'Failed to update complaint');
            }
        } catch (e) {
            alert('Network error');
        }
    }

    async function scheduleMeeting(id: number, schedule: string) {
        try {
            const res = await fetch(`/api/security/complaints/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule })
            });

            if (res.ok) {
                complaints = complaints.map(c => c.complaint_id === id ? { ...c, schedule } : c);
            } else {
                const json = await res.json();
                alert(json.error || 'Failed to schedule meeting');
            }
        } catch (e) {
            alert('Network error');
        }
    }

    async function confirmSchedule(id: number, schedule: string) {
        if (!schedule) {
            alert('Please select a date and time first');
            return;
        }

        confirmLoading = true;
        try {
            const res = await fetch(`/api/security/complaints/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule, send_email: true })
            });

            if (res.ok) {
                alert('Schedule confirmation email sent to complainant');
            } else {
                const json = await res.json();
                alert(json.error || 'Failed to send confirmation email');
            }
        } catch (e) {
            alert('Network error');
        } finally {
            confirmLoading = false;
        }
    }

    const filteredComplaints = $derived.by(() => {
        let filtered = complaints;

        if (statusFilter !== 'all') {
            filtered = filtered.filter(c => c.status.toLowerCase() === statusFilter.toLowerCase());
        }

        if (searchQuery) {
            const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
            filtered = filtered.filter(c => {
                const fullString = Object.values(c)
                    .filter(val => val !== null && val !== undefined)
                    .map(val => String(val).toLowerCase())
                    .join(' ');
                return terms.every(term => fullString.includes(term));
            });
        }

        return filtered;
    });
</script>

<svelte:head>
  <title>Complaints Dashboard — Security | GateQR</title>
  <meta name="description" content="Security complaints management dashboard for Liceo de Cagayan University." />
</svelte:head>

<AppShell showSidebar={true} userEmail={data.userEmail} userRole={userRole}>
  <NavBar title="Complaints" />

  <div class="controls-row">
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        placeholder="Search complaints…"
        bind:value={searchQuery}
        class="search-input"
      />
      {#if searchQuery}
        <button class="search-clear" onclick={() => { searchQuery = ''; }}>×</button>
      {/if}
    </div>

    <div class="filters">
      <select bind:value={statusFilter} class="filter-select">
        <option value="all">All Status</option>
        <option value="Pending">Pending</option>
        <option value="Resolved">Resolved</option>
      </select>
    </div>
  </div>

  {#if loading}
    <div class="loading-state">
      <svg class="loading-spinner" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
      </svg>
      Loading complaints…
    </div>
  {:else if filteredComplaints.length === 0}
    <div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      <p>No complaints found</p>
    </div>
  {:else}
    <div class="complaints-list">
      {#each filteredComplaints as complaint}
        <div class="complaint-card" class:card-scheduled={complaint.schedule && complaint.status !== 'Resolved'} class:card-resolved={complaint.status === 'Resolved'}>
          <div class="card-header">
            <div class="header-left">
              <span class="complaint-email">{complaint.sender_email || complaint.user_email}</span>
              <span class="complaint-date">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {new Date(complaint.created_at).toLocaleString()}
              </span>
            </div>
            <div class="header-right">
              {#if complaint.status === 'Resolved'}
                <span class="status-badge resolved">✓ Resolved</span>
              {:else if complaint.schedule}
                <span class="status-badge scheduled">📅 Scheduled</span>
              {:else}
                <span class="status-badge pending">Pending</span>
              {/if}
            </div>
          </div>

          <div class="card-body">
            <p class="complaint-message">{complaint.message}</p>
          </div>

          {#if complaint.schedule && complaint.status !== 'Resolved'}
            <div class="schedule-banner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <div>
                <span class="schedule-label">Meeting scheduled for</span>
                <strong>{new Date(complaint.schedule).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
              </div>
            </div>
          {/if}

          <div class="card-actions">
            {#if complaint.status !== 'Resolved'}
              <div class="action-group">
                <input 
                  type="datetime-local" 
                  class="schedule-input"
                  value={complaint.schedule || ''}
                  onchange={(e) => scheduleMeeting(complaint.complaint_id, (e.target as HTMLInputElement).value)}
                />
                <button 
                  class="btn-action btn-confirm" 
                  onclick={() => confirmSchedule(complaint.complaint_id, complaint.schedule)}
                  disabled={!complaint.schedule || confirmLoading}
                >
                  {#if confirmLoading}
                    Sending…
                  {:else}
                    Confirm & Send Email
                  {/if}
                </button>
                <button 
                  class="btn-action btn-resolve" 
                  onclick={() => updateComplaintStatus(complaint.complaint_id, 'Resolved')}
                >
                  Mark Resolved
                </button>
              </div>
            {:else}
              <span class="resolved-note">This complaint has been resolved.</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</AppShell>

<style>
  .page-header {
    margin-bottom: 1.5rem;
  }

  .page-header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .page-subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0.25rem 0 0 0;
    font-weight: 400;
  }

  .controls-row {
    padding: 1rem;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 12px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }

  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 250px;
    display: flex;
    align-items: center;
  }
  .search-icon { position: absolute; left: 0.875rem; color: var(--text-secondary); pointer-events: none; flex-shrink: 0; }
  .search-input {
    width: 100%;
    height: 40px;
    padding: 0 2rem 0 2.5rem;
    border: 1px solid #e2e8f0; border-radius: 8px;
    background: #ffffff; color: var(--text-primary); font-size: 0.875rem;
    font-family: inherit; outline: none; transition: all 0.2s;
    box-sizing: border-box;
  }
  .search-input:focus { border-color: var(--maroon); box-shadow: 0 0 0 2px rgba(107,26,42,0.1); }
  .search-clear {
    position: absolute; right: 0.75rem;
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary); font-size: 1rem; line-height: 1; padding: 0;
  }
  .search-clear:hover { color: var(--text-primary); }

  .filters { display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0; }

  .filter-select {
    height: 40px;
    padding: 0 1rem;
    border: 1px solid #e2e8f0; border-radius: 8px;
    background: #ffffff; color: var(--text-primary);
    font-size: 0.875rem; font-family: inherit; outline: none;
    cursor: pointer; transition: all 0.2s;
    box-sizing: border-box;
  }
  .filter-select:focus { border-color: var(--maroon); box-shadow: 0 0 0 2px rgba(107,26,42,0.1); }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    padding: 2rem;
    justify-content: center;
  }
  .loading-spinner {
    width: 20px; height: 20px;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 3rem 1rem;
    color: var(--text-secondary);
    background: #f8fafc;
    border: 1px dashed #e2e8f0;
    border-radius: 12px;
  }
  .empty-state p { margin: 0; font-size: 0.875rem; }

  .complaints-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .complaint-card {
    background: #ffffff;
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }
  .complaint-card:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }
  .complaint-card.card-scheduled {
    border-color: rgba(37,99,235,0.3);
    border-left: 4px solid #2563eb;
  }
  .complaint-card.card-resolved {
    border-color: rgba(34,197,94,0.3);
    border-left: 4px solid #16a34a;
    opacity: 0.8;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .complaint-email {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .complaint-date {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
  }
  .status-badge.pending { background: rgba(217,119,6,0.1); color: #d97706; }
  .status-badge.scheduled { background: rgba(37,99,235,0.1); color: #2563eb; }
  .status-badge.resolved { background: rgba(34,197,94,0.1); color: #16a34a; }

  .card-body {
    padding: 1.25rem;
  }

  .complaint-message {
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.6;
    white-space: pre-wrap;
    margin: 0;
  }

  .schedule-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 0 1.25rem 1rem;
    padding: 0.875rem;
    background: rgba(37,99,235,0.05);
    border: 1px solid rgba(37,99,235,0.2);
    border-radius: 8px;
    color: #1d4ed8;
    font-size: 0.875rem;
  }
  .schedule-banner svg { flex-shrink: 0; margin-top: 1px; }
  .schedule-label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
    opacity: 0.75;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .schedule-banner strong { display: block; font-weight: 700; font-size: 0.875rem; }

  .card-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1.25rem;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .action-group {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .schedule-input {
    height: 36px;
    padding: 0 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.875rem;
    font-family: inherit;
    background: #ffffff;
    color: var(--text-primary);
  }

  .btn-action {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-resolve {
    background: rgba(34,197,94,0.1);
    color: #16a34a;
    border: 1px solid rgba(34,197,94,0.3);
  }
  .btn-resolve:hover { background: rgba(34,197,94,0.2); }

  .btn-confirm {
    background: rgba(37,99,235,0.1);
    color: #2563eb;
    border: 1px solid rgba(37,99,235,0.3);
  }
  .btn-confirm:hover:not(:disabled) { background: rgba(37,99,235,0.2); }
  .btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; }

  .resolved-note {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-style: italic;
  }
</style>