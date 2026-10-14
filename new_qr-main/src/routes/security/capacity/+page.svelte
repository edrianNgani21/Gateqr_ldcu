<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  import { invalidateAll } from '$app/navigation';
  import { supabaseClient } from '$lib/supabaseClient';

  let { data } = $props();
  let userRole = $derived(data.userRole || 'security');

  let campuses = $state(data.campuses);
  let loadingCampus = $state<string | null>(null);
  let editingCampus = $state<string | null>(null);

  // Sync state when data changes via invalidateAll
  $effect(() => {
    // Only update if we are not currently editing to avoid overriding user input
    if (!editingCampus) {
        campuses = data.campuses;
    }
  });

  // Realtime subscription
  $effect(() => {
    const channel = supabaseClient
        .channel('capacity-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'parking_capacity' }, () => {
            invalidateAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campus_event' }, () => {
            invalidateAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_log' }, () => {
            invalidateAll();
        })
        .subscribe();

    return () => {
        supabaseClient.removeChannel(channel);
    };
  });

  // Temp state for editing
  let editCapacity = $state(0);
  let editEventName = $state('');
  let editStartDate = $state('');
  let editEndDate = $state('');

  let showHistory = $state<Record<string, boolean>>({});

  function toggleHistory(campusName: string) {
      showHistory[campusName] = !showHistory[campusName];
  }

  function startEdit(campus: any) {
    editingCampus = campus.name;
    editCapacity = campus.capacity;
    editEventName = campus.event_name;
    // Format timestamp to datetime-local expected format (YYYY-MM-DDThh:mm)
    editStartDate = campus.event_start ? new Date(campus.event_start).toISOString().slice(0,16) : '';
    editEndDate = campus.event_end ? new Date(campus.event_end).toISOString().slice(0,16) : '';
  }

  function cancelEdit() {
    editingCampus = null;
  }

  async function removeEvent(campusName: string) {
    if (!confirm('Are you sure you want to remove the current event?')) return;
    loadingCampus = campusName;
    try {
        const res = await fetch('/api/security/capacity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campus: campusName, remove_event: true })
        });
        if (res.ok) {
            invalidateAll();
        } else {
            alert('Failed to remove event.');
        }
    } catch(e) {
        alert('Network error');
    } finally {
        loadingCampus = null;
    }
  }

  async function saveCapacity(campusName: string) {
    if (editCapacity < 0 || editCapacity > 10000) {
        alert('Capacity must be between 0 and 10000');
        return;
    }
    
    if (editEventName && (!editStartDate || !editEndDate)) {
        alert('Please specify both start and end date for the event');
        return;
    }

    loadingCampus = campusName;
    try {
        const res = await fetch('/api/security/capacity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campus: campusName,
                parking_capacity: editCapacity,
                event_name: editEventName,
                start_date: editStartDate || undefined,
                end_date: editEndDate || undefined
            })
        });

        if (res.ok) {
            invalidateAll();
            editingCampus = null;
            alert('Capacity updated successfully');
        } else {
            const json = await res.json();
            alert(json.error || 'Failed to update capacity. Did you run the SQL migration?');
        }
    } catch (e) {
        alert('Network error');
    } finally {
        loadingCampus = null;
    }
  }
</script>

<AppShell showSidebar={true} userEmail={data.userEmail} userRole={userRole}>
  <div class="capacity-wrapper">
    <div class="header">
      <h1>Parking Capacity Records</h1>
      <p>Total Count of Registered Vehicles per Campus and Parking Capacities</p>
    </div>

    <div class="campus-grid">
      {#each campuses as campus}
        <div class="campus-card">
          <h2>{campus.name}</h2>
          
          {#if editingCampus === campus.name}
            <div class="edit-form">
              <div class="form-group">
                <label for="cap-{campus.name}">Capacity Limit</label>
                <input id="cap-{campus.name}" type="number" bind:value={editCapacity} min="0" max="10000" disabled={loadingCampus === campus.name} />
              </div>
              <div class="form-group">
                <label for="evt-{campus.name}">Event Name (Optional)</label>
                <input id="evt-{campus.name}" type="text" placeholder="e.g. Intramurals" bind:value={editEventName} disabled={loadingCampus === campus.name} />
              </div>
              {#if editEventName}
              <div class="form-group">
                <label for="evt-start-{campus.name}">Start Date</label>
                <input id="evt-start-{campus.name}" type="datetime-local" bind:value={editStartDate} disabled={loadingCampus === campus.name} />
              </div>
              <div class="form-group">
                <label for="evt-end-{campus.name}">End Date</label>
                <input id="evt-end-{campus.name}" type="datetime-local" bind:value={editEndDate} disabled={loadingCampus === campus.name} />
              </div>
              {/if}
              <div class="edit-actions">
                <button class="save-btn" onclick={() => saveCapacity(campus.name)} disabled={loadingCampus === campus.name}>
                  {loadingCampus === campus.name ? 'Saving...' : 'Save'}
                </button>
                <button class="cancel-btn" onclick={cancelEdit} disabled={loadingCampus === campus.name}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="event-display">
              <span class="label">Current Event:</span>
              <span class="value">{campus.event_name || 'None'}</span>
              {#if campus.event_name}
                <div class="event-times">
                    <div>{new Date(campus.event_start).toLocaleString()}</div>
                    <div>to {new Date(campus.event_end).toLocaleString()}</div>
                </div>
                <button class="remove-event-btn" onclick={() => removeEvent(campus.name)}>Remove Event</button>
              {/if}
            </div>
            <div class="stats">
              <div class="stat">
                <span class="label">Capacity</span>
                <span class="value">{campus.capacity}</span>
              </div>
              <div class="stat">
                <span class="label">Occupied</span>
                <span class="value occupied">{campus.occupied}</span>
              </div>
              <div class="stat">
                <span class="label">Unoccupied</span>
                <span class="value available">{campus.unoccupied ?? campus.available}</span>
              </div>
            </div>
            <div class="wheels-stats">
              <span class="wheel-tag">2-Wheels: <strong>{campus.wheels2 ?? 0}</strong></span>
              <span class="wheel-sep">•</span>
              <span class="wheel-tag">4-Wheels: <strong>{campus.wheels4 ?? 0}</strong></span>
            </div>
            <button class="set-btn" onclick={() => startEdit(campus)}>Update Settings</button>
          {/if}

          <!-- History arrow -->
          <div class="history-toggle" onclick={() => toggleHistory(campus.name)} onkeydown={(e) => e.key === 'Enter' && toggleHistory(campus.name)} role="button" tabindex="0">
            <span>Event History</span>
            <svg class:rotated={showHistory[campus.name]} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          
          {#if showHistory[campus.name]}
            <div class="history-panel">
              {#if campus.history && campus.history.length > 0}
                <table class="history-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Start</th>
                      <th>End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each campus.history as h}
                      <tr>
                        <td>{h.event_name}</td>
                        <td>{new Date(h.start_date).toLocaleDateString()} {new Date(h.start_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                        <td>{new Date(h.end_date).toLocaleDateString()} {new Date(h.end_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {:else}
                <div class="no-history">No past events recorded.</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</AppShell>

<style>
  .capacity-wrapper {
    padding: 2rem;
    max-width: 1000px;
    margin: 0 auto;
    width: 100%;
  }

  .header {
    position: relative;
    overflow: hidden;
    margin-bottom: 1.75rem;
    padding: 1.75rem 2.25rem;
    border-radius: 18px;
    background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
    border: 1px solid rgba(233, 194, 94, 0.25);
    box-shadow: 0 10px 25px -5px rgba(122, 23, 52, 0.35);
  }

  .header::after {
    content: '';
    position: absolute;
    right: -40px;
    top: -40px;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(233, 194, 94, 0.25), transparent 70%);
    pointer-events: none;
  }

  .header h1 {
    font-size: 1.6rem;
    font-weight: 800;
    color: #E9C25E;
    margin: 0 0 0.35rem 0;
    letter-spacing: -0.01em;
  }

  .header p {
    color: #F5D5DE;
    font-size: 0.92rem;
    font-weight: 500;
    margin: 0;
  }

  .campus-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .campus-card {
    background: #ffffff;
    border-radius: 24px;
    padding: 2rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03), 0 1px 3px rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(226, 232, 240, 0.8);
    display: flex;
    flex-direction: column;
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  .campus-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 5px;
    background: linear-gradient(90deg, #8B1A3C, #D4A62A);
    opacity: 1;
    transition: opacity 0.3s;
  }
  .campus-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 14px 35px rgba(139, 26, 60, 0.15);
    border-color: rgba(212, 166, 42, 0.5);
  }
  .campus-card:hover::before {
    opacity: 1;
  }

  .campus-card h2 {
    margin: 0.25rem 0 1.5rem 0;
    font-size: 1.3rem;
    color: #6B1A2A;
    text-align: center;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .stats {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1.25rem;
    background: linear-gradient(145deg, #fffdf6, #fef7e0);
    padding: 1.25rem;
    border-radius: 16px;
    border: 1px solid rgba(212, 166, 42, 0.35);
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
    padding: 0 0.25rem;
  }
  .stat:not(:last-child) {
    border-right: 1px solid rgba(226, 232, 240, 0.8);
  }

  .label {
    font-size: 0.68rem;
    color: #718096;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .value {
    font-size: 1.5rem;
    font-weight: 800;
    color: #2d3748;
  }

  .value.occupied { color: #e53e3e; }
  .value.available { color: #D4A62A; }

  .wheels-stats {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
    padding: 0.5rem 0.75rem;
    background: #f8fafc;
    border-radius: 8px;
    font-size: 0.8rem;
    color: #4a5568;
    border: 1px solid #edf2f7;
  }
  .wheel-tag strong {
    color: #1a202c;
    font-weight: 700;
  }
  .wheel-sep {
    color: #cbd5e0;
  }

  .event-display {
    text-align: center;
    margin-bottom: 1.5rem;
    padding: 1.25rem;
    background: rgba(139, 26, 60, 0.05);
    border-radius: 12px;
    font-size: 0.85rem;
    position: relative;
    border: 1px solid rgba(139, 26, 60, 0.15);
  }
  .event-display .value {
    font-size: 1.1rem;
    color: #8B1A3C;
    font-weight: 800;
    display: block;
    margin-top: 0.35rem;
    letter-spacing: -0.01em;
  }

  .event-times {
    font-size: 0.75rem;
    color: #4a5568;
    margin-top: 0.75rem;
    background: rgba(255,255,255,0.7);
    padding: 0.6rem;
    border-radius: 8px;
    border: 1px dashed rgba(139, 26, 60, 0.3);
    font-weight: 500;
  }

  .remove-event-btn {
    margin-top: 1rem;
    background: #fff5f5;
    color: #e53e3e;
    border: 1px solid #feb2b2;
    border-radius: 8px;
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .remove-event-btn:hover {
    background: #fed7d7;
    transform: scale(1.02);
  }

  .set-btn {
    width: 100%;
    padding: 0.85rem;
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #E9C25E;
    border: 1px solid rgba(212, 166, 42, 0.5);
    border-radius: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-size: 0.95rem;
    box-shadow: 0 4px 10px rgba(139, 26, 60, 0.3);
  }

  .set-btn:hover {
    background: linear-gradient(135deg, #7A1734, #4a0d1e);
    transform: translateY(-1px);
    box-shadow: 0 6px 14px rgba(139, 26, 60, 0.4);
  }

  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .form-group label {
    font-size: 0.75rem;
    font-weight: 700;
    color: #4a5568;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .form-group input {
    padding: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.9rem;
    transition: border-color 0.2s, box-shadow 0.2s;
    background: #f8fafc;
    outline: none;
  }
  
  .form-group input:focus {
    border-color: #8B1A3C;
    box-shadow: 0 0 0 3px rgba(139, 26, 60, 0.1);
    background: #ffffff;
  }

  .edit-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .save-btn {
    flex: 2;
    padding: 0.85rem;
    background: linear-gradient(135deg, #8B1A3C, #6B1A2A);
    color: #E9C25E;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 10px rgba(139, 26, 60, 0.3);
  }
  .save-btn:hover { 
    background: linear-gradient(135deg, #7A1734, #4a0d1e); 
    transform: translateY(-1px);
    box-shadow: 0 6px 12px rgba(139, 26, 60, 0.4);
  }
  .save-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; box-shadow: none; }

  .cancel-btn {
    flex: 1;
    padding: 0.85rem;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  .cancel-btn:hover { 
    background: #e2e8f0; 
  }
  .cancel-btn:disabled { opacity: 0.7; cursor: not-allowed; }

  .form-row {
    display: flex;
    gap: 0.5rem;
  }

  .history-toggle {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px dashed #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #718096;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    transition: color 0.2s;
  }

  .history-toggle:hover {
    color: #2d3748;
  }

  .history-toggle svg {
    transition: transform 0.2s;
  }
  .history-toggle svg.rotated {
    transform: rotate(180deg);
  }

  .history-panel {
    margin-top: 1rem;
    background: #f7fafc;
    border-radius: 6px;
    padding: 0.5rem;
    font-size: 0.75rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .history-table {
    width: 100%;
    min-width: 380px;
    border-collapse: collapse;
    text-align: left;
  }

  .history-table th {
    padding: 0.5rem;
    color: #4a5568;
    border-bottom: 1px solid #e2e8f0;
  }

  .history-table td {
    padding: 0.5rem;
    color: #2d3748;
    border-bottom: 1px solid #edf2f7;
  }

  .history-table tr:last-child td {
    border-bottom: none;
  }

  .no-history {
    padding: 1rem;
    text-align: center;
    color: #a0aec0;
  }

  @media (max-width: 1024px) {
    .capacity-wrapper {
      padding: 1.5rem 1rem;
    }
    .campus-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
    }
  }

  @media (max-width: 640px) {
    .capacity-wrapper {
      padding: 0.75rem 0.4rem;
    }
    .campus-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .campus-card {
      padding: 1.25rem 0.9rem;
      border-radius: 16px;
    }
    .stats {
      padding: 0.75rem 0.4rem;
      margin-bottom: 1rem;
    }
    .value {
      font-size: 1.2rem;
    }
    .header {
      padding: 1.1rem 1.1rem;
      border-radius: 14px;
      margin-bottom: 1.1rem;
    }
    .header h1 {
      font-size: 1.25rem;
    }
    .edit-actions {
      flex-direction: column;
      gap: 0.5rem;
    }
    .save-btn, .cancel-btn {
      width: 100%;
      text-align: center;
      justify-content: center;
    }
  }
</style>
