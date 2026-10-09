<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import { goto } from '$app/navigation';

    let { data } = $props();

    let role = $state('');
    let section = $state(1);
    let owner = $state('no');
    let dept = $state('');
    let campus = $state('');
    let year_level = $state('');
    
    let fname = $state('');
    let lname = $state('');
    let contact_number = $state('');
    let facebook = $state('');
    let vehicle = $state('');
    let vehicle_type = $state('');
    let plate = $state('');
    let color = $state('');
    let idno = $state('');
    let loading = $state(false);

    let agreedToPark = $state(false);
    let agreedToRegulations = $state(false);
    let hasOpenedLink = $state(false);

    const today = new Date();
    const day = today.getDate();
    const month = today.toLocaleString('default', { month: 'long' });
    const year = today.getFullYear();
    const daySuffix = (d: number) => {
        if (d > 3 && d < 21) return 'TH';
        switch (d % 10) {
            case 1:  return "ST";
            case 2:  return "ND";
            case 3:  return "RD";
            default: return "TH";
        }
    };
    const dayStr = `${day}${daySuffix(day)}`;

    type FileState = { file: File | null; url: string | null }

    let files = $state({
        id:         { file: null, url: null } as FileState,
        enrollment: { file: null, url: null } as FileState,
        letter:     { file: null, url: null } as FileState,
        or:         { file: null, url: null } as FileState,
        cr:         { file: null, url: null } as FileState,
        license:    { file: null, url: null } as FileState,
    })

    let canProceed = $derived((() => {
        if (section === 1) {
            if (!fname || !lname || !contact_number || !vehicle || !vehicle_type || !plate || !color || !role || !campus) return false;
            if (['student', 'employee'].includes(role) && (!dept || !idno)) return false;
            if (role === 'student' && !year_level) return false;
            return true;
        }
        if (section === 2) {
            const isVisitorLike = ['visitor', 'concessionaire'].includes(role);
            if (!files.or.file || !files.cr.file) return false;
            if (!isVisitorLike || owner === 'no') {
                if (!files.license.file) return false;
            }
            if (!isVisitorLike) {
                if (['student', 'employee'].includes(role) && !files.id.file) return false;
                if (!files.enrollment.file) return false;
                if (owner === 'yes' && !files.letter.file) return false;
            }
            if (isVisitorLike && owner === 'yes') {
                if (!files.license.file || !files.letter.file) return false;
            }
            return true;
        }
        if (section === 3) {
            return agreedToPark;
        }
        if (section === 4) {
            return agreedToRegulations && hasOpenedLink;
        }
        return false;
    })());

    function setFile(key: keyof typeof files, file: File | null, inputEl: HTMLInputElement | null = null) {
        if (file) {
            const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
            if (!isPdf) {
                alert('Only PDF files are allowed. (Document allows PDF and Scanned)');
                if (inputEl) inputEl.value = '';
                return;
            }
        }
        if (files[key].url) URL.revokeObjectURL(files[key].url!)
        files[key] = file
            ? { file, url: URL.createObjectURL(file) }
            : { file: null, url: null }
    }

    const totalSections = 4;
    const sectionTitles = [
        'Personal Information',
        'Document Evaluation',
        'Agreement to Park',
        'Parking Regulations',
    ];

    async function handleSubmit() {
        if (!fname || !lname || !contact_number || !vehicle || !vehicle_type || !plate || !color || !role) {
            alert('Please fill out all required fields.');
            return;
        }

        loading = true;
        try {
            const formData = new FormData();
            formData.append('role', role);
            formData.append('department_name', dept);
            formData.append('id_no', idno);
            formData.append('first_name', fname);
            formData.append('last_name', lname);
            formData.append('contact_number', contact_number);
            formData.append('facebook', facebook);
            formData.append('vehicle_make', vehicle);
            formData.append('vehicle_type', vehicle_type);
            formData.append('vehicle_plate', plate);
            formData.append('vehicle_color', color);
            formData.append('is_owner', owner);
            formData.append('campus', campus);
            if (year_level) formData.append('year_level', year_level);
            
            if (files.or.file) formData.append('doc_or', files.or.file);
            if (files.cr.file) formData.append('doc_cr', files.cr.file);
            if (files.license.file) formData.append('doc_license', files.license.file);
            if (files.id.file) formData.append('doc_id', files.id.file);
            if (files.enrollment.file) formData.append('doc_load', files.enrollment.file);
            if (files.letter.file) formData.append('doc_letter', files.letter.file);

            const res = await fetch('/api/apply', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                goto('/status');
            } else {
                const data = await res.json();
                alert('Error submitting application: ' + data.error);
            }
        } catch(e) {
            alert('Network error');
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
  <title>Vehicle Sticker Application — GateQR</title>
  <meta name="description" content="Apply for a Liceo de Cagayan University vehicle parking sticker." />
</svelte:head>

<AppShell userRole="applicant" userEmail={data.userEmail} showSidebar={false}>
  {#if data.applicationOpen === false}
    <div class="form-card" style="text-align:center; padding: 2.5rem 1.5rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem;">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <h2 style="margin:0; color:var(--maroon); font-size:1.25rem;">Applications are currently closed</h2>
      <p style="margin:0; color:var(--text-secondary); font-size:0.9rem; max-width:420px;">
        The Office of Student Affairs is not accepting vehicle sticker applications right now. Please check back later or contact <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>.
      </p>
      <button type="button" class="nav-btn btn-back" style="margin-top: 1rem; max-width: 180px; width: 100%; border: 1.5px solid #e5e7eb;" onclick={() => { if (typeof window !== 'undefined' && window.history.length > 1) { window.history.back(); } else { goto('/status'); } }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
    </div>
  {:else}
  <!-- Welcome Banner matching Dashboard Aesthetic -->
  <div class="welcome-banner">
    <div class="wb-content">
      <h1 class="wb-title">Vehicle Sticker Application</h1>
      <p class="wb-sub">Please complete all steps to apply for your campus parking sticker.</p>
    </div>
    <div class="wb-icon-shield">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.75">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
    </div>
  </div>

  <!-- Step progress -->
  <div class="step-progress">
    {#each Array(totalSections) as _, i}
      <div class="step-item" class:step-done={section > i + 1} class:step-active={section === i + 1} class:step-pending={section < i + 1}>
        <div class="step-circle">
          {#if section > i + 1}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            {i + 1}
          {/if}
        </div>
        {#if i < totalSections - 1}
          <div class="step-connector"></div>
        {/if}
      </div>
    {/each}
  </div>

  <p class="section-title">
    <span class="section-num">Step {section}</span>
    {sectionTitles[section - 1]}
  </p>

  <!-- Section card -->
  <div class="form-card">

    <!-- SECTION 1 -->
    {#if section === 1}
      <div class="field-row">
        <div class="field-group">
          <label class="field-label" for="fname">First name</label>
          <input id="fname" type="text" placeholder="Juan" bind:value={fname} />
        </div>
        <div class="field-group">
          <label class="field-label" for="lname">Last name</label>
          <input id="lname" type="text" placeholder="Dela Cruz" bind:value={lname} />
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label" for="contact">Contact number</label>
          <input id="contact" type="text" placeholder="09123456789" bind:value={contact_number} />
        </div>
        <div class="field-group">
          <label class="field-label" for="fb">Facebook (Optional)</label>
          <input id="fb" type="text" placeholder="facebook.com/userid" bind:value={facebook} />
        </div>
      </div>

      <div class="field-row">
        <div class="field-group">
          <label class="field-label" for="vehicle">Vehicle make & model</label>
          <input id="vehicle" type="text" placeholder="e.g. Honda Civic 2022" bind:value={vehicle} />
        </div>
        <div class="field-group">
          <label class="field-label" for="vehicle_type">Vehicle Type</label>
          <select id="vehicle_type" bind:value={vehicle_type} class:placeholder-sel={!vehicle_type}>
            <option value="" disabled hidden selected>Select type</option>
            <option value="2-Wheeler / Motorcycle">2-Wheeler / Motorcycle</option>
            <option value="4-Wheeler / Car">4-Wheeler / Car</option>
          </select>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label" for="plate">Plate number</label>
        <input id="plate" type="text" placeholder="ABC-1234" bind:value={plate} />
      </div>

      <div class="field-group">
        <label class="field-label" for="color">Color</label>
        <input id="color" type="text" placeholder="e.g., Red, Blue, Black" bind:value={color} />
      </div>

      <div class="field-group">
        <label class="field-label" for="role">Role</label>
        <select id="role" bind:value={role} class:placeholder-sel={!role}>
          <option value="" disabled hidden selected>Select role</option>
          <option value="student">Student</option>
          <option value="employee">Employee</option>
          <option value="visitor">Visitor</option>
          <option value="concessionaire">Concessionaire</option>
        </select>
      </div>

      <div class="field-group">
        <label class="field-label" for="campus">Campus</label>
        <select id="campus" bind:value={campus} class:placeholder-sel={!campus}>
          <option value="" disabled hidden selected>Select campus</option>
          <option value="Liceo Main">Liceo Main</option>
          <option value="RNP">RNP</option>
          <option value="PASEO">PASEO</option>
        </select>
      </div>

      {#if ['student', 'employee'].includes(role)}
        <div class="field-group">
          <label class="field-label" for="dept">Department</label>
          <select id="dept" bind:value={dept} class:placeholder-sel={!dept} onchange={() => year_level = ''}>
            <option value="" disabled hidden selected>Select department</option>
            {#each data.departments as d}
              <option value={d}>{d}</option>
            {/each}
          </select>
        </div>
        
        {#if role === 'student'}
          <div class="field-group">
            <label class="field-label" for="year_level">Year Level</label>
            <select id="year_level" bind:value={year_level} class:placeholder-sel={!year_level}>
              <option value="" disabled hidden selected>Select year level</option>
              {#if dept.toLowerCase().includes('senior highschool')}
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              {:else}
                <option value="1st Year">1st Year</option>
                <option value="2nd Year">2nd Year</option>
                <option value="3rd Year">3rd Year</option>
                <option value="4th Year">4th Year</option>
                <option value="5th Year">5th Year</option>
              {/if}
            </select>
          </div>
        {/if}
        <div class="field-group">
          <label class="field-label" for="idno">ID number</label>
          <input id="idno" type="text" placeholder="2022-XXXXXXX" bind:value={idno} />
        </div>
      {/if}

    <!-- SECTION 2 -->
    {:else if section === 2}
      <div class="owner-question">
        <p class="owner-q-text">Is the vehicle registered under someone else's name?</p>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" bind:group={owner} name="registered" value="yes" />
            <span>Yes</span>
          </label>
          <label class="radio-label">
            <input type="radio" bind:group={owner} name="registered" value="no" />
            <span>No</span>
          </label>
        </div>
      </div>

      <div class="doc-format-notice">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span>(Document allows PDF and Scanned)</span>
      </div>

      <!-- Liceo documents -->
      {#if !['visitor', 'concessionaire'].includes(role)}
        <div class="upload-section">
          <p class="upload-section-title">Liceo Documents</p>
          <div class="upload-grid" style="--cols: {owner === 'no' ? 3 : 2}">
            {#if ['student', 'employee'].includes(role)}
              {@render uploadLabel(`${role === 'student' ? 'Student' : 'Employee'} ID`, 'id')}
            {/if}
            {@render uploadLabel(role === 'student' ? 'Enrollment Form' : 'Load Sheet / DTR', 'enrollment')}
            {#if owner === 'yes'}
              {@render uploadLabel('Signed Letter / DOAS', 'letter')}
            {/if}
          </div>
        </div>
      {/if}

      {#if ['visitor', 'concessionaire'].includes(role) && owner === 'yes'}
        <div class="upload-section">
          <p class="upload-section-title">Visitor / Concessionaire Documents</p>
          <div class="upload-grid" style="--cols: 2">
            {@render uploadLabel("Driver's License (LTO)", 'license')}
            {@render uploadLabel('Signed Letter / DOAS', 'letter')}
          </div>
        </div>
      {/if}

      <div class="upload-section">
        <p class="upload-section-title">LTO Vehicle Documents</p>
        <div class="upload-grid" style="--cols: {['visitor', 'concessionaire'].includes(role) && owner === 'yes' ? 2 : 3}">
          {@render uploadLabel('Vehicle OR', 'or')}
          {@render uploadLabel('Vehicle CR', 'cr')}
          {#if !['visitor', 'concessionaire'].includes(role) || owner === 'no'}
            {@render uploadLabel("Driver's License", 'license')}
          {/if}
        </div>
      </div>

    <!-- SECTION 3 -->
    {:else if section === 3}
      <div class="agreement-body">
        <p><strong>KNOWN ALL MEN BY THESE PRESENTS:</strong></p>
        <p>That this agreement is signed by <u>{fname} {lname}</u>, in favor of Liceo de Cagayan University.</p>
        <p>WHEREAS, the President of Liceo de Cagayan has granted permission to allow the owner of the vehicle to park on the school premises.</p>
        <p>WHEREAS, the undersigned has agreed to the parking rules and regulations of Liceo de Cagayan University.</p>
        <p>Now, therefore, in view of the foregoing, the undersigned have agreed to the following rules and regulations.</p>
        <ol>
          <li>That the vehicle owner obligates himself to follow all the University parking regulations as may be implemented from the time by Liceo de Cagayan University in connection with this agreement to park;</li>
          <li>That the vehicle owner shall place an authorized School Sticker on his/her vehicle upon entering the University premises;</li>
          <li>That the vehicle must be driven personally by the owner and authorized driver,</li>
          <li>The official parking sticker be placed at the most prominent portion of the vehicle;</li>
          <li>That the owner of the vehicles shall park only at designed bays;</li>
          <li>That the school is not liable for whatever damage may happen to the vehicle while inside the University premises;</li>
          <li>That the undersigned is obligated to renew this agreement every semester;</li>
        </ol>
        <p>IN WITNESS HEREOF THE UNDERSIGNED HAS AFFIXED HIS/HER SIGNATURE THIS <u>{dayStr}</u> DAY OF <u>{month.toUpperCase()}</u> <u>{year}</u>.</p>
      </div>
      <label class="agree-checkbox">
        <input type="checkbox" class="cb-real" bind:checked={agreedToPark} />
        <span class="cb-box"></span>
        <span>I agree to the terms and conditions of this agreement.</span>
      </label>

    <!-- SECTION 4 -->
    {:else if section === 4}
      <div class="agreement-body">
        <p>Liceo de Cagayan University provides vehicle parking privileges as part of the services offered to employees, students, and concessionaires. To ensure safety, these regulations have been produced and must be followed.</p>
        <ol>
          <li>Application for parking shall be transacted through the Office of Student Affairs. Stickers may be availed only by the Employees, Students, and Concessionaires of the University.</li>
          <li>Requirements:
            <ol type="a">
              <li>Agreement to Park form (original and photocopy)</li>
              <li>School ID (photocopy)</li>
              <li>Enrollment Form (students) or Load Sheet (Non-Regular Faculty) (photocopy)</li>
              <li>Vehicle official receipt (OR) and certificate of registration (photocopy)</li>
              <li>Driver's License (photocopy)</li>
              <li>Authorization letter (If the vehicle is registered under a different name).</li>
            </ol>
          </li>
          <li>The Liceo U Official Parking Sticker fee shall be paid at the cashiers office only. Only one (1) sticker is provided for every employee, student, and concessionaire.</li>
          <li>Stickers are color coded for security and monitoring purposes. Vehicles must park only in designated areas to park.</li>
          <li>Parking inside the University premises shall be on a first-come, first-served basis. Members of the administration are given priority to use the parking space adjacent to the Rodelsa Hall.</li>
          <li>Parking permits may be revoked temporarily or permanently for the following:
            <ol type="a">
              <li>parking in unauthorized areas;</li>
              <li>using another person's sticker;</li>
              <li>duplication or using fake stickers;</li>
              <li>repeated failure to display permit;</li>
              <li>violating traffic rules while inside the campus, and</li>
              <li>having items in the vehicle that violate Liceo U policies on alcohol, prohibited drugs, and deadly weapons.</li>
            </ol>
          </li>
          <li>The Director of the Office of Student Affairs, the Security and Safety Chief Officer, and the guard on duty reserve the right to inspect all vehicles going in and out of the university to ensure the safety and security of the Liceo de Cagayan University community.</li>
          <li>For concessionaires, delivery time is between 6:00 am to 12:00nn only.</li>
          <li>For concerns, the Office of Student Affairs and the LICEO U Administration shall be the venue to resolve the issue.</li>
        </ol>
      </div>

      <div class="link-section">
        <p>Please download, print, and fill up the physical copy of the Agreement to Park and Parking Regulations:</p>
        <a 
          href="https://docs.google.com/document/d/1y8OGxeORcqTE9JZ8m-82jM_6oQSrdtSyqrAEf2kaLAM/edit?tab=t.0" 
          target="_blank" 
          rel="noopener noreferrer" 
          class="doc-link-btn"
          onclick={() => hasOpenedLink = true}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open Agreement Document
        </a>
      </div>

      <label class="agree-checkbox">
        <input type="checkbox" class="cb-real" bind:checked={agreedToRegulations} />
        <span class="cb-box"></span>
        <span>I have read and fully understood the policies and regulations.</span>
      </label>
    {/if}
  </div>

  <!-- Navigation -->
  <div class="nav-btns" class:split={section > 1}>
    <button class="nav-btn btn-home" onclick={() => goto('/status')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Back to Status
    </button>
    {#if section > 1}
      <button class="nav-btn btn-back" onclick={() => section--}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
    {/if}
    {#if section < totalSections}
      <button class="nav-btn btn-next" onclick={() => section++} disabled={!canProceed}>
        Next
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    {:else}
      <button
        class="nav-btn btn-submit"
        class:btn-loading={loading}
        onclick={handleSubmit}
        disabled={loading || !canProceed}
      >
        {#if loading}
          {@render spinner()}
          Submitting…
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Submit Application
        {/if}
      </button>
    {/if}
  </div>

  <p class="form-footer">
    Issues? Contact <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>
  </p>
  {/if}
</AppShell>

{#snippet spinner()}
  <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
  </svg>
{/snippet}

{#snippet uploadLabel(label: string, key: keyof typeof files)}
  <label class="upload-tile" class:has-file={!!files[key].file}>
    <span class="upload-label-text">{label}</span>
    {#if files[key].file}
      <div class="upload-pdf-preview">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <path d="M9 15h6"/>
          <path d="M9 11h6"/>
        </svg>
        <span class="pdf-tag">PDF</span>
      </div>
      <span class="upload-filename">{files[key].file?.name}</span>
    {:else}
      <div class="upload-placeholder">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>Upload</span>
      </div>
    {/if}
    <input hidden type="file" accept=".pdf,application/pdf"
      onchange={(e) => setFile(key, e.currentTarget.files?.[0] ?? null, e.currentTarget)} />
  </label>
{/snippet}

<style>
  /* Welcome Banner matching Dashboard aesthetic */
  .welcome-banner {
    background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
    border-radius: 18px;
    padding: 1.75rem 2.25rem;
    color: #ffffff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 10px 25px -5px rgba(122, 23, 52, 0.35);
    border: 1px solid rgba(233, 194, 94, 0.25);
    margin-bottom: 1.5rem;
    position: relative;
    overflow: hidden;
  }

  .wb-content {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    z-index: 1;
  }

  .wb-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: #E9C25E;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .wb-sub {
    font-size: 0.9rem;
    color: #F5D5DE;
    margin: 0;
    font-weight: 500;
  }

  .wb-icon-shield {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.85;
  }

  /* ─── Step Progress ─── */
  .step-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 1rem 0;
    margin: 1rem 0;
  }

  .step-item {
    display: flex;
    align-items: center;
    flex: 1;
  }

  .step-item:last-child { flex: 0; }

  .step-circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
    flex-shrink: 0;
    border: 2px solid #e5e7eb;
    background: #ffffff;
    color: #9ca3af;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .step-active .step-circle {
    background: linear-gradient(135deg, var(--maroon), #8b1a2a);
    border-color: var(--maroon);
    color: #fff;
    box-shadow: 0 0 0 4px rgba(107, 26, 42, 0.2), 0 4px 12px rgba(107, 26, 42, 0.3);
    transform: scale(1.1);
  }

  .step-done .step-circle {
    background: linear-gradient(135deg, #F0CF72, #D4A62A);
    border-color: #D4A62A;
    color: #3D0818;
    box-shadow: 0 2px 8px rgba(212, 166, 42, 0.35);
  }

  .step-connector {
    flex: 1;
    height: 3px;
    background: #e5e7eb;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    margin: 0 0.5rem;
    border-radius: 2px;
  }

  .step-done .step-connector,
  .step-active .step-connector {
    background: linear-gradient(90deg, #D4A62A, var(--maroon-light));
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .section-num {
    background: linear-gradient(135deg, var(--maroon), #8b1a2a);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.35rem 0.75rem;
    border-radius: 8px;
    letter-spacing: 0.05em;
    box-shadow: 0 2px 8px rgba(107, 26, 42, 0.25);
  }

  /* ─── Form Card ─── */
  .form-card {
    background: linear-gradient(135deg, #ffffff, #fafafa);
    border: 1px solid rgba(229, 231, 235, 0.8);
    border-radius: 16px;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }

  @media (max-width: 640px) {
    .field-row {
      grid-template-columns: 1fr;
    }
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.01em;
  }

  .field-group input,
  .field-group select {
    padding: 0.875rem 1rem;
    border: 1.5px solid #e5e7eb;
    border-radius: 10px;
    font-size: 0.9375rem;
    font-family: inherit;
    background: #ffffff;
    color: var(--text-primary);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .field-group input:focus,
  .field-group select:focus {
    outline: none;
    border-color: var(--maroon);
    box-shadow: 0 0 0 3px rgba(107, 26, 42, 0.1), 0 2px 8px rgba(107, 26, 42, 0.15);
  }

  .field-group input:hover,
  .field-group select:hover {
    border-color: #d1d5db;
  }

  .placeholder-sel { color: #9ca3af; }

  /* ─── Owner question ─── */
  .owner-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: linear-gradient(135deg, #fef2f2, #ffffff);
    border: 1px solid rgba(107, 26, 42, 0.15);
    border-radius: 12px;
    flex-wrap: wrap;
    box-shadow: 0 2px 8px rgba(107, 26, 42, 0.08);
  }

  .owner-q-text {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    flex: 1;
  }

  .radio-group {
    display: flex;
    gap: 1.5rem;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    transition: all 0.2s;
  }

  .radio-label:hover {
    background: rgba(107, 26, 42, 0.05);
  }

  .radio-label input[type="radio"] {
    accent-color: var(--maroon);
    width: 18px;
    height: 18px;
  }

  /* ─── Upload ─── */
  .upload-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .upload-section-title {
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--maroon);
    margin: 0;
    padding-bottom: 0.25rem;
  }

  .upload-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), 1fr);
    gap: 1rem;
  }

  @media (max-width: 640px) {
    .upload-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
  }

  @media (max-width: 400px) {
    .upload-grid {
      grid-template-columns: 1fr !important;
    }
  }

  .upload-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    padding: 1.25rem 0.75rem;
    background: linear-gradient(135deg, #fafafa, #ffffff);
    border: 2px dashed #d1d5db;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    text-align: center;
    min-height: 120px;
    position: relative;
    overflow: hidden;
  }

  .upload-tile::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(107, 26, 42, 0.03), rgba(107, 26, 42, 0.01));
    opacity: 0;
    transition: opacity 0.3s;
  }

  .upload-tile:hover {
    background: linear-gradient(135deg, #fef2f2, #ffffff);
    border-color: var(--maroon);
    transform: translateY(-4px);
    box-shadow: 0 8px 20px rgba(107, 26, 42, 0.15);
  }

  .upload-tile:hover::before {
    opacity: 1;
  }

  .upload-label-text {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--maroon);
    line-height: 1.4;
    z-index: 1;
  }

  .upload-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    color: #6b7280;
    font-size: 0.75rem;
    font-weight: 500;
    z-index: 1;
  }

  .upload-preview {
    width: 100%;
    height: 64px;
    object-fit: cover;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .upload-filename {
    font-size: 0.6875rem;
    color: #6b7280;
    word-break: break-all;
    text-align: center;
    font-weight: 500;
  }

  .doc-format-notice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: linear-gradient(135deg, #fef2f2, #fff5f5);
    border: 1px solid rgba(107, 26, 42, 0.15);
    border-radius: 10px;
    color: var(--maroon);
    font-size: 0.8125rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .upload-pdf-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem;
  }

  .pdf-tag {
    font-size: 0.65rem;
    font-weight: 800;
    background: var(--maroon);
    color: #fff;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .upload-tile.has-file {
    border-color: var(--maroon);
    background: #fffafa;
  }

  /* ─── Agreement ─── */
  .agreement-body {
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.8;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: 380px;
    overflow-y: auto;
    padding-right: 1rem;
    background: linear-gradient(135deg, #fafafa, #ffffff);
    border-radius: 12px;
    padding: 1.5rem;
    border: 1px solid #e5e7eb;
  }

  .agreement-body::-webkit-scrollbar {
    width: 6px;
  }

  .agreement-body::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  .agreement-body::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 3px;
  }

  .agreement-body::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
  }

  .agreement-body p { margin: 0; }
  .agreement-body ol { margin: 0; padding-left: 1.75rem; }
  .agreement-body li { margin-top: 0.5rem; }

  .agree-checkbox {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    padding: 1.25rem 1.5rem;
    background: linear-gradient(135deg, #fef2f2, #ffffff);
    border: 1px solid rgba(107, 26, 42, 0.15);
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.6;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(107, 26, 42, 0.08);
  }

  .agree-checkbox:hover {
    background: linear-gradient(135deg, #fee2e2, #ffffff);
    border-color: rgba(107, 26, 42, 0.25);
  }

  .agree-checkbox .cb-real {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .cb-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    min-width: 24px;
    border: 2px solid #d1d5db;
    border-radius: 6px;
    background: #ffffff;
    margin-top: 2px;
    flex-shrink: 0;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .cb-real:checked + .cb-box {
    background: linear-gradient(135deg, var(--maroon), #8b1a2a);
    border-color: var(--maroon);
    box-shadow: 0 2px 8px rgba(107, 26, 42, 0.3);
  }

  .cb-real:checked + .cb-box::after {
    content: '';
    position: absolute;
    left: 7px;
    top: 3px;
    width: 6px;
    height: 12px;
    border: solid white;
    border-width: 0 2.5px 2.5px 0;
    transform: rotate(45deg);
  }

  /* ─── Nav Buttons ─── */
  .nav-btns {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  @media (max-width: 480px) {
    .nav-btns {
      flex-direction: column;
    }

    .nav-btn {
      width: 100%;
    }

    .btn-back {
      flex: 1;
    }
  }

  .nav-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: inherit;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .nav-btn:hover {
    transform: translateY(-2px);
  }

  .btn-back {
    background: linear-gradient(135deg, #ffffff, #f9fafb);
    color: var(--text-secondary);
    border: 1.5px solid #e5e7eb;
    flex: 0.5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .btn-back:hover { 
    background: linear-gradient(135deg, #fef2f2, #ffffff); 
    color: var(--maroon); 
    border-color: var(--maroon);
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.15);
  }

  .btn-next {
    background: linear-gradient(135deg, var(--maroon), #8b1a2a);
    color: #fff;
    box-shadow: 0 4px 16px rgba(107, 26, 42, 0.35);
  }

  .btn-next:hover { 
    background: linear-gradient(135deg, #8b1a2a, var(--maroon-dark)); 
    box-shadow: 0 6px 24px rgba(107, 26, 42, 0.45);
  }

  .btn-submit {
    background: linear-gradient(135deg, var(--maroon-dark), var(--maroon), #8b1a2a);
    color: #fff;
    box-shadow: 0 6px 20px rgba(107, 26, 42, 0.4);
  }

  .btn-submit:hover { 
    box-shadow: 0 8px 28px rgba(107, 26, 42, 0.5);
    transform: translateY(-2px);
  }

  .btn-next:disabled,
  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
    box-shadow: none;
  }

  /* Loading state for submit */
  .btn-loading {
    opacity: 1 !important;
    cursor: wait !important;
    pointer-events: none;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .link-section {
    padding: 1.5rem;
    background: linear-gradient(135deg, #ffffff, #fafafa);
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }

  .link-section p {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .doc-link-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, var(--maroon), #8b1a2a);
    color: #fff;
    text-decoration: none;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 10px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 12px rgba(107, 26, 42, 0.3);
  }

  .doc-link-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(107, 26, 42, 0.4);
  }

  .form-footer {
    text-align: center;
    font-size: 0.8125rem;
    color: #9ca3af;
    margin-top: 1rem;
  }

  .footer-link {
    color: var(--maroon);
    font-weight: 600;
    text-decoration: none;
    transition: color 0.2s;
  }

  .footer-link:hover { 
    color: #8b1a2a;
    text-decoration: underline;
  }
</style>