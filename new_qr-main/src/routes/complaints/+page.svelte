<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import { onMount } from 'svelte';
    import { supabaseClient } from '$lib/supabaseClient';
    
    let { data } = $props();

    let complaints: any[] = $state([]);
    let loading = $state(true);
    let message = $state('');
    let submitLoading = $state(false);

    async function loadComplaints() {
        loading = true;
        try {
            const res = await fetch('/api/complaints');
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
            .channel('user-complaints-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint' }, () => {
                loadComplaints();
            })
            .subscribe();

        return () => {
            supabaseClient.removeChannel(channel);
        };
    });

    async function submitComplaint() {
        if (!message || message.trim() === '') {
            alert('Please enter a message');
            return;
        }

        submitLoading = true;
        try {
            const res = await fetch('/api/complaints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            if (res.ok) {
                message = '';
                await loadComplaints(); // Refresh the list
            } else {
                const json = await res.json();
                alert(json.error || 'Failed to submit complaint');
            }
        } catch (e) {
            alert('Network error');
        }
        submitLoading = false;
    }

    async function deleteComplaint(id: number) {
        if (!confirm('Are you sure you want to delete this complaint?')) return;

        try {
            const res = await fetch(`/api/complaints/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                complaints = complaints.filter(c => c.complaint_id !== id);
            } else {
                const json = await res.json();
                alert(json.error || 'Failed to delete complaint');
            }
        } catch (e) {
            alert('Network error');
        }
    }
</script>

<svelte:head>
  <title>My Complaints — GateQR</title>
  <meta name="description" content="View and submit complaints." />
</svelte:head>

<AppShell>
  <div class="welcome-bar">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    <span>{data.userEmail}</span>
    <a href="/status" class="btn-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      Back to Status
    </a>
  </div>

  <div class="page-header">
    <div class="page-header-left">
      <div class="page-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      </div>
      <div>
        <h2 class="page-title">My Complaints</h2>
        <p class="page-subtitle">Submit and track your complaints to the security office</p>
      </div>
    </div>
  </div>

  {#if complaints.some(c => c.schedule && c.status !== 'resolved')}
    <div class="alert-schedule">
      <div class="alert-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <div>
        <strong>Meeting Scheduled</strong> — The security office has scheduled a meeting with you. Please check your complaint details below.
      </div>
    </div>
  {/if}

  <div class="layout-grid">
    <div class="submit-section">
      <div class="form-card">
        <div class="form-card-header">
          <h3>New Complaint</h3>
        </div>
        <div class="form-card-body">
          <p>Your message will be sent securely to the security office. They will review it and may schedule a meeting with you.</p>
          <textarea 
            bind:value={message} 
            placeholder="Describe your concern in detail…" 
            class="complaint-textarea" 
            rows="6"
            disabled={submitLoading}
          ></textarea>
          <button 
            class="btn-submit" 
            onclick={submitComplaint} 
            disabled={submitLoading || !message.trim()}
          >
            {#if submitLoading}
              <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
              </svg>
              Submitting…
            {:else}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Send to Security Office
            {/if}
          </button>
        </div>
      </div>
    </div>

    <div class="history-section">
      <h3 class="section-heading">Complaint History</h3>
      
      {#if loading}
        <div class="loading-state">
          <svg class="loading-spinner" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
          </svg>
          Loading…
        </div>
      {:else if complaints.length === 0}
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <p>No complaints submitted yet</p>
        </div>
      {:else}
        <div class="cards-list">
          {#each complaints as c}
            <div class="complaint-card" class:card-scheduled={c.schedule && c.status !== 'resolved'} class:card-resolved={c.status === 'resolved'}>
              <div class="card-header">
                <span class="date-time">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {new Date(c.created_at).toLocaleString()}
                </span>
                {#if c.status === 'resolved'}
                  <span class="status-badge resolved">✓ Resolved</span>
                {:else if c.schedule}
                  <span class="status-badge scheduled">📅 Scheduled</span>
                {:else}
                  <span class="status-badge pending">Pending Review</span>
                {/if}
              </div>

              <div class="card-body">{c.message}</div>

              {#if c.schedule && c.status !== 'resolved'}
                <div class="schedule-banner">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <div>
                    <span class="schedule-label">Meeting scheduled for</span>
                    <strong>{new Date(c.schedule).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                  </div>
                </div>
              {/if}

              <div class="card-footer">
                {#if c.status === 'resolved'}
                  <span class="resolved-note">This complaint has been resolved.</span>
                {:else if !c.schedule}
                  <span class="pending-note">Awaiting security review</span>
                {:else}
                  <span class="pending-note">Please attend your scheduled meeting</span>
                {/if}
                {#if c.status !== 'resolved'}
                  <button class="btn-delete" onclick={() => deleteComplaint(c.complaint_id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    Delete
                  </button>
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
  .welcome-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-weight: 500;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.875rem;
    margin-bottom: 1rem;
  }
  .welcome-bar svg { color: var(--maroon); flex-shrink: 0; }
  .welcome-bar span { flex: 1; }

  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.875rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .btn-back:hover { background: var(--maroon-muted); color: var(--maroon); border-color: var(--maroon); }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }
  .page-header-left {
    display: flex;
    align-items: center;
    gap: 0.875rem;
  }
  .page-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    background: linear-gradient(135deg, var(--maroon-dark), var(--maroon));
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(107,26,42,0.25);
  }
  .page-title {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 0.15rem;
    line-height: 1;
  }
  .page-subtitle {
    font-size: 0.78rem;
    color: var(--text-dim);
    margin: 0;
  }

  .alert-schedule {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: rgba(37,99,235,0.08);
    border: 1.5px solid rgba(37,99,235,0.25);
    border-left: 4px solid #2563eb;
    border-radius: var(--radius-sm);
    color: #1d4ed8;
    font-size: 0.85rem;
    margin-bottom: 1.25rem;
    animation: slide-in 0.3s ease;
  }
  .alert-icon {
    flex-shrink: 0;
    margin-top: 1px;
  }
  @keyframes slide-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .layout-grid {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 768px) {
    .layout-grid { grid-template-columns: 1fr; }
  }

  .form-card {
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .form-card-header {
    padding: 1rem 1.25rem;
    border-bottom: 1.5px solid var(--border);
    background: var(--background);
  }
  .form-card-header h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
  }
  .form-card-body {
    padding: 1.25rem;
  }
  .form-card-body p {
    font-size: 0.82rem;
    color: var(--text-secondary);
    margin: 0 0 1rem;
    line-height: 1.5;
  }

  .complaint-textarea {
    width: 100%;
    padding: 0.75rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.875rem;
    background: var(--background);
    color: var(--text);
    resize: vertical;
    margin-bottom: 0.875rem;
    box-sizing: border-box;
    transition: border-color 0.15s;
    line-height: 1.5;
  }
  .complaint-textarea:focus { border-color: var(--maroon); outline: none; }

  .btn-submit {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, var(--maroon-dark), var(--maroon));
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-family: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.15s;
    box-shadow: 0 4px 12px rgba(107,26,42,0.25);
  }
  .btn-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .btn-spinner {
    width: 15px; height: 15px;
    animation: spin 0.75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .section-heading {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 0.875rem;
  }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-dim);
    padding: 2rem;
    justify-content: center;
  }
  .loading-spinner {
    width: 18px; height: 18px;
    animation: spin 0.75s linear infinite;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--text-muted);
    background: var(--surface);
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .empty-state p { margin: 0; font-size: 0.875rem; }

  .cards-list {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .complaint-card {
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .complaint-card.card-scheduled {
    border-color: rgba(37,99,235,0.4);
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
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--background);
  }
  .date-time {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .status-badge {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .status-badge.pending { background: rgba(217,119,6,0.12); color: #d97706; }
  .status-badge.scheduled { background: rgba(37,99,235,0.12); color: #2563eb; }
  .status-badge.resolved { background: rgba(34,197,94,0.12); color: #16a34a; }

  .card-body {
    padding: 0.875rem 1rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .schedule-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    margin: 0 1rem 0.75rem;
    padding: 0.75rem;
    background: rgba(37,99,235,0.07);
    border: 1px solid rgba(37,99,235,0.2);
    border-radius: var(--radius-sm);
    color: #1d4ed8;
    font-size: 0.8rem;
  }
  .schedule-banner svg { flex-shrink: 0; margin-top: 1px; }
  .schedule-label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.1rem;
    opacity: 0.75;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .schedule-banner strong { display: block; font-weight: 700; font-size: 0.82rem; }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.625rem 1rem;
    border-top: 1px dashed var(--border);
    background: var(--background);
  }
  .resolved-note, .pending-note {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-style: italic;
  }

  .btn-delete {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: transparent;
    border: 1.5px solid rgba(220,38,38,0.25);
    color: #dc2626;
    padding: 0.4rem 0.875rem;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    font-family: inherit;
  }
  .btn-delete:hover { background: rgba(220,38,38,0.08); }
</style>
