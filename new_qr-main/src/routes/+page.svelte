<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import { goto } from '$app/navigation';

    let { data } = $props();

    const existing = data.existingApplicationData;
    const isRenewal = data.isRenewal;

    let role = $state(existing?.role || '');
    let section = $state(1);
    let owner = $state(existing?.vehicle_information?.authorization_letter ? 'yes' : 'no');
    let dept = $state(existing?.department?.academic_department || existing?.department?.administrative_department || '');
    let campus = $state(existing?.campus || '');
    let year_level = $state(existing?.year_level || '');
    
    let fname = $state(existing?.first_name || '');
    let lname = $state(existing?.last_name || '');
    let contact_number = $state(existing?.mobile || '');
    let facebook = $state(existing?.facebook || '');
    let vehicle = $state(existing?.vehicle_information?.brand || '');
    let vehicle_type = $state(existing?.vehicle_information?.type || '');
    let plate = $state(existing?.vehicle_information?.plate_number || '');
    let color = $state(existing?.vehicle_information?.color || '');
    let idno = $state(existing?.school_id || '');
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
        id:         { file: null, url: existing?.doc_id || null } as FileState,
        enrollment: { file: null, url: null } as FileState,
        letter:     { file: null, url: existing?.vehicle_information?.authorization_letter || null } as FileState,
        or:         { file: null, url: existing?.vehicle_information?.or || null } as FileState,
        cr:         { file: null, url: existing?.vehicle_information?.cr || null } as FileState,
        license:    { file: null, url: existing?.drivers_license || null } as FileState,
    })

    let canProceed = $derived((() => {
        if (section === 1) {
            if (!fname || !lname || !contact_number || !vehicle || !vehicle_type || !plate || !color || !role || !campus) return false;
            if (!dept || !idno) return false;
            if (contact_number.length !== 11 || !/^\d{11}$/.test(contact_number)) return false;
            if (idno.length !== 11 || !/^\d{11}$/.test(idno)) return false;
            if (role === 'student' && !year_level) return false;
            return true;
        }
        if (section === 2) {
            const hasOr = !!(files.or.file || files.or.url);
            const hasCr = !!(files.cr.file || files.cr.url);
            const hasLicense = !!(files.license.file || files.license.url);
            const hasId = !!(files.id.file || files.id.url);
            const hasEnrollment = !!(files.enrollment.file || files.enrollment.url);
            const hasLetter = !!(files.letter.file || files.letter.url);

            const isExternal = ['concessionnaire', 'supplier', 'visitor'].includes(role);
            if (!hasOr || !hasCr) return false;
            if (!isExternal || owner === 'no') {
                if (!hasLicense) return false;
            }
            if (!hasId) return false;
            if (['student', 'faculty'].includes(role)) {
                if (!hasEnrollment) return false;
            }
            if (owner === 'yes' && !hasLetter) return false;
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

        if (contact_number.length !== 11 || !/^\d{11}$/.test(contact_number)) {
            alert('Phone Number must be exactly 11 numbers (e.g. 09123456789).');
            return;
        }

        if (idno.length !== 11 || !/^\d{11}$/.test(idno)) {
            alert('ID Number must be exactly 11 numbers.');
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
            
            if (isRenewal && existing?.registration_id) {
                formData.append('mode', 'renewal');
                formData.append('registration_id', String(existing.registration_id));
            }

            if (files.or.file) formData.append('doc_or', files.or.file);
            else if (files.or.url) formData.append('existing_doc_or', files.or.url);

            if (files.cr.file) formData.append('doc_cr', files.cr.file);
            else if (files.cr.url) formData.append('existing_doc_cr', files.cr.url);

            if (files.license.file) formData.append('doc_license', files.license.file);
            else if (files.license.url) formData.append('existing_doc_license', files.license.url);

            if (files.id.file) formData.append('doc_id', files.id.file);
            else if (files.id.url) formData.append('existing_doc_id', files.id.url);

            if (files.enrollment.file) formData.append('doc_load', files.enrollment.file);
            else if (files.enrollment.url) formData.append('existing_doc_load', files.enrollment.url);

            if (files.letter.file) formData.append('doc_letter', files.letter.file);
            else if (files.letter.url) formData.append('existing_doc_letter', files.letter.url);

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
    <div class="doc-closed-card">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#7A1734" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <h2 class="closed-title">Applications are currently closed</h2>
      <p class="closed-desc">
        The Office of Student Affairs is not accepting vehicle sticker applications right now. Please check back later or contact <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>.
      </p>
      <button type="button" class="nav-btn btn-back" onclick={() => { if (typeof window !== 'undefined' && window.history.length > 1) { window.history.back(); } else { goto('/status'); } }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back
      </button>
    </div>
  {:else}

  <!-- Modern Document Sheet Container (Matches Reference Screenshot Layout) -->
  <div class="doc-page-wrapper">
    <div class="doc-sheet">
      <!-- ── Header Banner with Angled Chevron ──────────────────────────────── -->
      <div class="doc-header-banner">
        <div class="banner-left-content">
          <h1 class="banner-main-title">{isRenewal ? 'Vehicle Sticker Renewal' : 'Vehicle Sticker Application'}</h1>
          <div class="banner-sub-line-wrap">
            <span class="banner-subtitle-text">{isRenewal ? 'Renew your registration for the new School Year' : 'Fill out the form to request a sticker'}</span>
            <div class="banner-ruler-dot">
              <span class="ruler-line"></span>
              <span class="ruler-dot"></span>
            </div>
          </div>
        </div>

        <div class="banner-right-chevron">
          <div class="banner-brand-box">
            <img src="/liceo-logo.png" alt="Liceo Logo" class="banner-logo-img" />
            <div class="banner-brand-meta">
              <span class="brand-name-bold">GateQR</span>
              <span class="brand-univ-sub">Liceo de Cagayan University</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Step Progress Indicator ────────────────────────────────────────── -->
      <div class="doc-step-bar">
        {#each Array(totalSections) as _, i}
          <div class="doc-step-item" class:step-done={section > i + 1} class:step-active={section === i + 1} class:step-pending={section < i + 1}>
            <div class="doc-step-badge">
              {#if section > i + 1}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              {:else}
                {i + 1}
              {/if}
            </div>
            <span class="doc-step-title">{sectionTitles[i]}</span>
            {#if i < totalSections - 1}
              <div class="doc-step-connector"></div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- ── Document Body Content ──────────────────────────────────────────── -->
      <div class="doc-body-content">
        {#if section === 1}
          <!-- SECTION 1: Personal & Vehicle Information -->
          <div class="doc-form-table">

            <!-- Full Name Row -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <span class="doc-row-title">Full Name <span class="req-star">*</span></span>
              </div>
              <div class="doc-col-fields">
                <div class="doc-fields-duo">
                  <div class="field-item">
                    <input id="fname" type="text" placeholder="First Name" bind:value={fname} class="doc-input-box" />
                    <span class="doc-field-hint">First Name</span>
                  </div>
                  <div class="field-item">
                    <input id="lname" type="text" placeholder="Last Name" bind:value={lname} class="doc-input-box" />
                    <span class="doc-field-hint">Last Name</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Email Row (Displayed from applicant account) -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <span class="doc-row-title">Email</span>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <input type="email" value={data.userEmail || ''} disabled class="doc-input-box doc-input-readonly" />
                  <span class="doc-field-hint">applicant@liceo.edu.ph</span>
                </div>
              </div>
            </div>

            <!-- Phone Number Row (11 numbers only) -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <label class="doc-row-title" for="contact">Phone Number <span class="req-star">*</span></label>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <input
                    id="contact"
                    type="tel"
                    inputmode="numeric"
                    maxlength="11"
                    pattern="[0-9]{11}"
                    placeholder="09123456789"
                    bind:value={contact_number}
                    oninput={(e) => {
                      contact_number = e.currentTarget.value.replace(/\D/g, '').slice(0, 11);
                    }}
                    class="doc-input-box"
                  />
                  <span class="doc-field-hint">
                    Mobile Number (11 digits only, e.g. 09123456789)
                    {#if contact_number.length > 0 && contact_number.length < 11}
                      <span class="field-count-warn">({contact_number.length}/11 digits)</span>
                    {:else if contact_number.length === 11}
                      <span class="field-count-ok">(11/11 digits ✓)</span>
                    {/if}
                  </span>
                </div>
              </div>
            </div>

            <!-- Facebook Profile Row -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <label class="doc-row-title" for="fb">Facebook</label>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <input id="fb" type="text" placeholder="facebook.com/username (Optional)" bind:value={facebook} class="doc-input-box" />
                  <span class="doc-field-hint">Optional social profile</span>
                </div>
              </div>
            </div>

            <!-- Vehicle Make & Model Row -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <label class="doc-row-title" for="vehicle">Vehicle Details <span class="req-star">*</span></label>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <input id="vehicle" type="text" placeholder="e.g. Honda Civic 2022 / Yamaha NMAX" bind:value={vehicle} class="doc-input-box" />
                  <span class="doc-field-hint">Vehicle Make &amp; Model</span>
                </div>
              </div>
            </div>

            <!-- Vehicle Type (REDESIGNED TO SEPARATE CHECKBOXES MATCHING SCREENSHOT) -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <span class="doc-row-title">Vehicle Type <span class="req-star">*</span></span>
              </div>
              <div class="doc-col-fields">
                <div class="doc-checkbox-group">
                  <!-- 2-Wheeler Checkbox -->
                  <label class="doc-checkbox-pill" class:is-selected={vehicle_type === '2-Wheeler / Motorcycle'}>
                    <input
                      type="checkbox"
                      class="doc-cb-hidden"
                      checked={vehicle_type === '2-Wheeler / Motorcycle'}
                      onchange={(e) => {
                        vehicle_type = e.currentTarget.checked ? '2-Wheeler / Motorcycle' : '';
                      }}
                    />
                    <span class="doc-cb-square">
                      <svg class="cb-checkmark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span class="cb-text-label">2-Wheeler / Motorcycle</span>
                  </label>

                  <!-- 4-Wheeler Checkbox -->
                  <label class="doc-checkbox-pill" class:is-selected={vehicle_type === '4-Wheeler / Car'}>
                    <input
                      type="checkbox"
                      class="doc-cb-hidden"
                      checked={vehicle_type === '4-Wheeler / Car'}
                      onchange={(e) => {
                        vehicle_type = e.currentTarget.checked ? '4-Wheeler / Car' : '';
                      }}
                    />
                    <span class="doc-cb-square">
                      <svg class="cb-checkmark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span class="cb-text-label">4-Wheeler / Car</span>
                  </label>
                </div>
                <span class="doc-field-hint">Check your vehicle type</span>
              </div>
            </div>

            <!-- Plate Number & Color Row -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <span class="doc-row-title">Plate &amp; Color <span class="req-star">*</span></span>
              </div>
              <div class="doc-col-fields">
                <div class="doc-fields-duo">
                  <div class="field-item">
                    <input id="plate" type="text" placeholder="ABC-1234" bind:value={plate} class="doc-input-box" />
                    <span class="doc-field-hint">Plate Number</span>
                  </div>
                  <div class="field-item">
                    <input id="color" type="text" placeholder="e.g. Red, Blue, Black" bind:value={color} class="doc-input-box" />
                    <span class="doc-field-hint">Color</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Role (Dropdown selection - remained dropdown) -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <label class="doc-row-title" for="role">Role <span class="req-star">*</span></label>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <select id="role" bind:value={role} class="doc-select-box" class:placeholder-sel={!role} onchange={() => { dept = ''; year_level = ''; }}>
                    <option value="" disabled hidden selected>Select role</option>
                    <option value="student">Student</option>
                    <option value="faculty">Faculty</option>
                    <option value="staff">Staff</option>
                    <option value="administrator">Administrator</option>
                    <option value="concessionnaire">Concessionnaire</option>
                    <option value="supplier">Supplier</option>
                    <option value="vps">Vps</option>
                  </select>
                  <span class="doc-field-hint">Affiliation status</span>
                </div>
              </div>
            </div>

            <!-- Campus (Dropdown selection - remained dropdown) -->
            <div class="doc-form-row">
              <div class="doc-col-label">
                <label class="doc-row-title" for="campus">Campus <span class="req-star">*</span></label>
              </div>
              <div class="doc-col-fields">
                <div class="field-item full-width">
                  <select id="campus" bind:value={campus} class="doc-select-box" class:placeholder-sel={!campus}>
                    <option value="" disabled hidden selected>Select campus</option>
                    <option value="Liceo Main">Liceo Main</option>
                    <option value="RNP">RNP</option>
                    <option value="PASEO">PASEO</option>
                  </select>
                  <span class="doc-field-hint">Primary campus</span>
                </div>
              </div>
            </div>

            <!-- Department (Academic Department for Student, Administrative Department for others) -->
            {#if role}
              {@const isStudent = role === 'student'}
              {@const deptsList = isStudent 
                ? (data.academicDepartments && data.academicDepartments.length > 0 ? data.academicDepartments : data.departments) 
                : (data.administrativeDepartments && data.administrativeDepartments.length > 0 ? data.administrativeDepartments : data.departments)}
              <div class="doc-form-row">
                <div class="doc-col-label">
                  <label class="doc-row-title" for="dept">
                    {isStudent ? 'Academic Department' : 'Administrative Department'} <span class="req-star">*</span>
                  </label>
                </div>
                <div class="doc-col-fields">
                  <div class="field-item full-width">
                    <select id="dept" bind:value={dept} class="doc-select-box" class:placeholder-sel={!dept} onchange={() => year_level = ''}>
                      <option value="" disabled hidden selected>
                        Select {isStudent ? 'academic department' : 'administrative department'}
                      </option>
                      {#each deptsList as d}
                        <option value={d}>{d}</option>
                      {/each}
                    </select>
                    <span class="doc-field-hint">
                      {isStudent ? 'College / Academic Department' : 'Office / Administrative Department'}
                    </span>
                  </div>
                </div>
              </div>

              {#if role === 'student'}
                <div class="doc-form-row">
                  <div class="doc-col-label">
                    <label class="doc-row-title" for="year_level">Year Level <span class="req-star">*</span></label>
                  </div>
                  <div class="doc-col-fields">
                    <div class="field-item full-width">
                      <select id="year_level" bind:value={year_level} class="doc-select-box" class:placeholder-sel={!year_level}>
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
                      <span class="doc-field-hint">Academic year level</span>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- ID Number Row (11 numbers only) -->
              <div class="doc-form-row">
                <div class="doc-col-label">
                  <label class="doc-row-title" for="idno">ID Number <span class="req-star">*</span></label>
                </div>
                <div class="doc-col-fields">
                  <div class="field-item full-width">
                    <input
                      id="idno"
                      type="text"
                      inputmode="numeric"
                      maxlength="11"
                      pattern="[0-9]{11}"
                      placeholder="e.g. 20221234567"
                      bind:value={idno}
                      oninput={(e) => {
                        idno = e.currentTarget.value.replace(/\D/g, '').slice(0, 11);
                      }}
                      class="doc-input-box"
                    />
                    <span class="doc-field-hint">
                      University ID Number (11 digits only)
                      {#if idno.length > 0 && idno.length < 11}
                        <span class="field-count-warn">({idno.length}/11 digits)</span>
                      {:else if idno.length === 11}
                        <span class="field-count-ok">(11/11 digits ✓)</span>
                      {/if}
                    </span>
                  </div>
                </div>
              </div>
            {/if}
          </div>

        {:else if section === 2}
          <!-- SECTION 2: Document Evaluation -->
          <div class="doc-step2-content">
            <div class="owner-question-card">
              <span class="owner-question-text">Is the vehicle registered under someone else's name?</span>
              <div class="owner-radio-options">
                <label class="doc-radio-pill" class:is-selected={owner === 'yes'}>
                  <input type="radio" bind:group={owner} name="registered" value="yes" />
                  <span>Yes</span>
                </label>
                <label class="doc-radio-pill" class:is-selected={owner === 'no'}>
                  <input type="radio" bind:group={owner} name="registered" value="no" />
                  <span>No</span>
                </label>
              </div>
            </div>

            <div class="doc-format-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="format-banner-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>All submitted documents must be in PDF format. If you use CamScanner or any other scanning application, make sure to export or convert your scanned documents into a PDF file before uploading them to the system.</span>
            </div>

            <!-- Liceo Documents -->
            {#if !['visitor', 'concessionaire'].includes(role)}
              {@const showEnrollment = ['student', 'faculty'].includes(role)}
              {@const showId = ['student', 'faculty', 'staff', 'employee'].includes(role)}
              {@const tileCount = (showId ? 1 : 0) + (showEnrollment ? 1 : 0) + (owner === 'yes' ? 1 : 0)}
              {#if tileCount > 0}
              <div class="upload-section-block">
                <h3 class="upload-section-heading">Liceo Institutional Documents</h3>
                <div class="upload-tiles-grid" style="--cols: {Math.min(tileCount, 3)}">
                  {#if showId}
                    {@render uploadLabel(`${role === 'student' ? 'Student' : 'Employee'} ID`, 'id')}
                  {/if}
                  {#if showEnrollment}
                    {@render uploadLabel(role === 'student' ? 'Enrollment Form' : 'Teaching Load', 'enrollment')}
                  {/if}
                  {#if owner === 'yes'}
                    {@render uploadLabel('Signed Letter / DOAS', 'letter')}
                  {/if}
                </div>
              </div>
              {/if}
            {/if}

            {#if ['visitor', 'concessionaire'].includes(role) && owner === 'yes'}
              <div class="upload-section-block">
                <h3 class="upload-section-heading">Visitor / Concessionaire Documents</h3>
                <div class="upload-tiles-grid" style="--cols: 2">
                  {@render uploadLabel("Driver's License (LTO)", 'license')}
                  {@render uploadLabel('Signed Letter / DOAS', 'letter')}
                </div>
              </div>
            {/if}

            <div class="upload-section-block">
              <h3 class="upload-section-heading">Vehicle Documents</h3>
              <div class="upload-tiles-grid" style="--cols: {['visitor', 'concessionaire'].includes(role) && owner === 'yes' ? 2 : 3}">
                {@render uploadLabel('Vehicle OR', 'or')}
                {@render uploadLabel('Vehicle CR', 'cr')}
                {#if !['visitor', 'concessionaire'].includes(role) || owner === 'no'}
                  {@render uploadLabel("Driver's License", 'license')}
                {/if}
              </div>
            </div>
          </div>

        {:else if section === 3}
          <!-- SECTION 3: Agreement to Park -->
          <div class="doc-agreement-card">
            <div class="agreement-scroller">
              <p><strong>KNOWN ALL MEN BY THESE PRESENTS:</strong></p>
              <p>That this agreement is signed by <u>{fname} {lname}</u>, in favor of Liceo de Cagayan University.</p>
              <p>WHEREAS, the President of Liceo de Cagayan has granted permission to allow the owner of the vehicle to park on the school premises.</p>
              <p>WHEREAS, the undersigned has agreed to the parking rules and regulations of Liceo de Cagayan University.</p>
              <p>Now, therefore, in view of the foregoing, the undersigned have agreed to the following rules and regulations.</p>
              <ol>
                <li>That the vehicle owner obligates himself to follow all the University parking regulations as may be implemented from the time by Liceo de Cagayan University in connection with this agreement to park;</li>
                <li>That the vehicle owner shall place an authorized School Sticker on his/her vehicle upon entering the University premises;</li>
                <li>That the vehicle must be driven personally by the owner and authorized driver;</li>
                <li>The official parking sticker be placed at the most prominent portion of the vehicle;</li>
                <li>That the owner of the vehicles shall park only at designated bays;</li>
                <li>That the school is not liable for whatever damage may happen to the vehicle while inside the University premises;</li>
                <li>That the undersigned is obligated to renew this agreement every semester;</li>
              </ol>
              <p>IN WITNESS HEREOF THE UNDERSIGNED HAS AFFIXED HIS/HER SIGNATURE THIS <u>{dayStr}</u> DAY OF <u>{month.toUpperCase()}</u> <u>{year}</u>.</p>
            </div>

            <label class="doc-terms-checkbox" class:is-checked={agreedToPark}>
              <input type="checkbox" class="doc-cb-hidden" bind:checked={agreedToPark} />
              <span class="doc-cb-square">
                <svg class="cb-checkmark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
              <span class="terms-text">I agree to the terms and conditions of this agreement.</span>
            </label>
          </div>

        {:else if section === 4}
          <!-- SECTION 4: Parking Regulations -->
          <div class="doc-agreement-card">
            <div class="agreement-scroller">
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
                <li>The Liceo U Official Parking Sticker fee shall be paid at the cashier's office only. Only one (1) sticker is provided for every employee, student, and concessionaire.</li>
                <li>Stickers are color coded for security and monitoring purposes. Vehicles must park only in designated areas.</li>
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

            <div class="doc-link-action-box">
              <p>Please download, print, and fill up the physical copy of the Agreement to Park and Parking Regulations:</p>
              <a 
                href="https://docs.google.com/document/d/1y8OGxeORcqTE9JZ8m-82jM_6oQSrdtSyqrAEf2kaLAM/edit?tab=t.0" 
                target="_blank" 
                rel="noopener noreferrer" 
                class="btn-agreement-download"
                onclick={() => hasOpenedLink = true}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Open Physical Copy Document
              </a>
            </div>

            <label class="doc-terms-checkbox" class:is-checked={agreedToRegulations}>
              <input type="checkbox" class="doc-cb-hidden" bind:checked={agreedToRegulations} />
              <span class="doc-cb-square">
                <svg class="cb-checkmark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
              <span class="terms-text">I have read and fully understood the policies and regulations.</span>
            </label>
          </div>
        {/if}

        <!-- ── Bottom Accent Decoration (Matching Reference Screenshot) ──── -->
        <div class="doc-bottom-accent-row">
          <div class="accent-dots-cluster">
            <span class="accent-dot"></span>
            <span class="accent-dot"></span>
            <span class="accent-dot"></span>
          </div>
          <div class="accent-ruler-line"></div>
        </div>

      </div>

      <!-- ── Navigation Control Row ─────────────────────────────────────────── -->
      <div class="doc-nav-row" class:has-multi-nav={section > 1}>
        <button type="button" class="nav-btn btn-status-return" onclick={() => goto('/status')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Back to Status
        </button>

        <div class="doc-nav-forward-actions">
          {#if section > 1}
            <button type="button" class="nav-btn btn-back-step" onclick={() => section--}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back
            </button>
          {/if}

          {#if section < totalSections}
            <button type="button" class="nav-btn btn-next-step" onclick={() => section++} disabled={!canProceed}>
              <span>Next</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          {:else}
            <button
              type="button"
              class="nav-btn btn-submit-step"
              class:btn-loading={loading}
              onclick={handleSubmit}
              disabled={loading || !canProceed}
            >
              {#if loading}
                {@render spinner()}
                Submitting…
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                {isRenewal ? 'Submit Renewal' : 'Submit Application'}
              {/if}
            </button>
          {/if}
        </div>
      </div>

      <div class="doc-card-footer-help">
        Issues? Contact <a href="mailto:osa@liceo.edu.ph" class="footer-link">osa@liceo.edu.ph</a>
      </div>
    </div>
  </div>
  {/if}
</AppShell>

{#snippet spinner()}
  <svg class="btn-spinner" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2.5" stroke-dasharray="35 15" stroke-linecap="round"/>
  </svg>
{/snippet}

{#snippet uploadLabel(label: string, key: keyof typeof files)}
  <label class="upload-tile" class:has-file={!!files[key].file || !!files[key].url}>
    <span class="upload-label-text">{label}</span>
    {#if files[key].file}
      <div class="upload-pdf-preview">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7A1734" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <path d="M9 15h6"/>
          <path d="M9 11h6"/>
        </svg>
        <span class="pdf-tag">PDF</span>
      </div>
      <span class="upload-filename">{files[key].file?.name}</span>
    {:else if files[key].url}
      <div class="upload-pdf-preview" style="color: #15803d;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <polyline points="9 15 11 17 15 13"/>
        </svg>
        <span class="pdf-tag" style="background: #dcfce7; color: #166534;">ON FILE</span>
      </div>
      <span class="upload-filename" style="color: #166534; font-size: 0.75rem;">Existing File (Click to replace)</span>
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
  /* ── Page Wrapper & Layout ──────────────────────────────────────────────────── */
  .doc-page-wrapper {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 0.5rem 0 2rem;
    box-sizing: border-box;
  }

  /* ── Document Sheet (Matches Reference Mockup) ──────────────────────────────── */
  .doc-sheet {
    width: 100%;
    max-width: 860px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow:
      0 12px 36px -8px rgba(0, 0, 0, 0.12),
      0 1px 3px rgba(0, 0, 0, 0.05);
    border: 1px solid #e2e8f0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  /* ── Header Banner with Angled Chevron ──────────────────────────────────────── */
  .doc-header-banner {
    position: relative;
    background: linear-gradient(135deg, #a51d2d 0%, #831422 100%);
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    min-height: 110px;
    color: #ffffff;
    overflow: hidden;
  }

  .banner-left-content {
    flex: 1 1 auto;
    padding: 1.75rem 2rem 1.75rem 2.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    z-index: 2;
  }

  .banner-main-title {
    font-size: 1.85rem;
    font-weight: 800;
    color: #ffffff;
    margin: 0 0 0.35rem 0;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .banner-sub-line-wrap {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .banner-subtitle-text {
    font-size: 0.86rem;
    color: rgba(255, 255, 255, 0.92);
    font-style: italic;
    white-space: nowrap;
  }

  .banner-ruler-dot {
    display: flex;
    align-items: center;
    flex: 1;
    max-width: 190px;
    gap: 0;
  }

  .ruler-line {
    flex: 1;
    height: 1.5px;
    background: rgba(255, 255, 255, 0.55);
  }

  .ruler-dot {
    width: 6.5px;
    height: 6.5px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  /* Right Angled Chevron Wedge */
  .banner-right-chevron {
    position: relative;
    width: 38%;
    min-width: 260px;
    background: #4a0914;
    clip-path: polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 1.75rem 1rem 3rem;
    box-sizing: border-box;
    z-index: 1;
  }

  .banner-brand-box {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .banner-logo-img {
    width: 44px;
    height: 44px;
    object-fit: contain;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    padding: 3px;
    border: 1px solid rgba(240, 207, 114, 0.4);
    backdrop-filter: blur(4px);
    flex-shrink: 0;
  }

  .banner-brand-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .brand-name-bold {
    font-size: 1.15rem;
    font-weight: 900;
    color: #ffffff;
    letter-spacing: 0.02em;
    line-height: 1.1;
  }

  .brand-univ-sub {
    font-size: 0.72rem;
    font-weight: 600;
    color: #F0CF72;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1.2;
  }

  /* ── Step Progress Indicator ────────────────────────────────────────────────── */
  .doc-step-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 2.5rem;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    gap: 0.75rem;
  }

  .doc-step-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    position: relative;
  }

  .doc-step-item:last-child {
    flex: 0 0 auto;
  }

  .doc-step-badge {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 800;
    border: 2px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    flex-shrink: 0;
    transition: all 0.25s ease;
  }

  .step-active .doc-step-badge {
    background: #8b1a2a;
    border-color: #8b1a2a;
    color: #ffffff;
    box-shadow: 0 0 0 3px rgba(139, 26, 42, 0.15);
  }

  .step-done .doc-step-badge {
    background: #D4A62A;
    border-color: #D4A62A;
    color: #2b060f;
  }

  .doc-step-title {
    font-size: 0.8rem;
    font-weight: 700;
    color: #475569;
    white-space: nowrap;
  }

  .step-active .doc-step-title {
    color: #8b1a2a;
  }

  .doc-step-connector {
    flex: 1;
    height: 2px;
    background: #e2e8f0;
    margin: 0 0.5rem;
    border-radius: 1px;
  }

  .step-done .doc-step-connector {
    background: #D4A62A;
  }

  /* ── Document Body Content ──────────────────────────────────────────────────── */
  .doc-body-content {
    padding: 2.5rem 2.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-sizing: border-box;
  }

  /* ── Form Rows & Table Layout (Matching Reference Form) ─────────────────────── */
  .doc-form-table {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .doc-form-row {
    display: grid;
    grid-template-columns: 190px 1fr;
    gap: 1.5rem;
    align-items: flex-start;
  }

  .doc-col-label {
    padding-top: 0.65rem;
  }

  .doc-row-title {
    font-size: 0.88rem;
    font-weight: 800;
    color: #1e293b;
    letter-spacing: -0.01em;
  }

  .req-star {
    color: #dc2626;
    font-weight: 900;
  }

  .doc-col-fields {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .doc-fields-duo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .field-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-item.full-width {
    width: 100%;
  }

  /* Input Boxes Matching Screenshot (Subtle border, rounded pill-card edges) */
  .doc-input-box,
  .doc-select-box {
    width: 100%;
    height: 44px;
    padding: 0 0.95rem;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.92rem;
    font-family: inherit;
    color: #0f172a;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .doc-input-box:focus,
  .doc-select-box:focus {
    outline: none;
    border-color: #8b1a2a;
    box-shadow: 0 0 0 3px rgba(139, 26, 42, 0.12);
  }

  .doc-input-box:hover,
  .doc-select-box:hover {
    border-color: #94a3b8;
  }

  .doc-input-readonly {
    background: #f8fafc;
    color: #64748b;
    border-color: #e2e8f0;
    cursor: not-allowed;
  }

  .placeholder-sel {
    color: #94a3b8;
  }

  .doc-field-hint {
    font-size: 0.72rem;
    color: #64748b;
    font-weight: 500;
    letter-spacing: 0.01em;
  }

  /* ── Checkbox Row Design (Redesigned Vehicle Type per Request) ──────────────── */
  .doc-checkbox-group {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    padding-top: 0.2rem;
  }

  .doc-checkbox-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    user-select: none;
    padding: 0.5rem 0.75rem 0.5rem 0.25rem;
    border-radius: 8px;
    transition: all 0.18s ease;
  }

  .doc-checkbox-pill:hover {
    background: #f8fafc;
  }

  .doc-cb-hidden {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .doc-cb-square {
    width: 19px;
    height: 19px;
    border: 1.5px solid #94a3b8;
    border-radius: 4px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .cb-checkmark {
    display: none;
    color: #ffffff;
  }

  .doc-checkbox-pill.is-selected .doc-cb-square {
    background: #8b1a2a;
    border-color: #8b1a2a;
    box-shadow: 0 2px 6px rgba(139, 26, 42, 0.25);
  }

  .doc-checkbox-pill.is-selected .cb-checkmark {
    display: block;
  }

  .cb-text-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #334155;
  }

  .doc-checkbox-pill.is-selected .cb-text-label {
    color: #8b1a2a;
    font-weight: 700;
  }

  /* ── Section 2: Owner Radio & Upload Grid ───────────────────────────────────── */
  .doc-step2-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .owner-question-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    flex-wrap: wrap;
  }

  .owner-question-text {
    font-size: 0.92rem;
    font-weight: 700;
    color: #1e293b;
  }

  .owner-radio-options {
    display: flex;
    gap: 1rem;
  }

  .doc-radio-pill {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 1rem;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.88rem;
    font-weight: 600;
    color: #334155;
    transition: all 0.2s ease;
  }

  .doc-radio-pill.is-selected {
    border-color: #8b1a2a;
    background: #fff5f6;
    color: #8b1a2a;
  }

  .doc-radio-pill input[type="radio"] {
    accent-color: #8b1a2a;
  }

  .doc-format-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1.25rem;
    background: #fff8eb;
    border: 1.5px solid #fed7aa;
    border-radius: 8px;
    color: #9a3412;
    font-size: 0.84rem;
    font-weight: 600;
    line-height: 1.55;
  }

  .format-banner-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: #ea580c;
  }

  .field-count-warn {
    color: #dc2626;
    font-weight: 700;
    margin-left: 0.35rem;
  }

  .field-count-ok {
    color: #16a34a;
    font-weight: 700;
    margin-left: 0.35rem;
  }

  .upload-section-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .upload-section-heading {
    font-size: 0.82rem;
    font-weight: 800;
    color: #8b1a2a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .upload-tiles-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), 1fr);
    gap: 1rem;
  }

  .upload-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    padding: 1.25rem 0.75rem;
    background: #fafafa;
    border: 2px dashed #cbd5e1;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.25s ease;
    text-align: center;
    min-height: 110px;
  }

  .upload-tile:hover {
    background: #fffafa;
    border-color: #8b1a2a;
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(139, 26, 42, 0.1);
  }

  .upload-tile.has-file {
    border-color: #8b1a2a;
    background: #fff5f6;
  }

  .upload-label-text {
    font-size: 0.78rem;
    font-weight: 700;
    color: #8b1a2a;
  }

  .upload-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    color: #64748b;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .upload-pdf-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
  }

  .pdf-tag {
    font-size: 0.65rem;
    font-weight: 800;
    background: #8b1a2a;
    color: #ffffff;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }

  .upload-filename {
    font-size: 0.68rem;
    color: #475569;
    word-break: break-all;
  }

  /* ── Section 3 & 4: Agreements ──────────────────────────────────────────────── */
  .doc-agreement-card {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .agreement-scroller {
    font-size: 0.9rem;
    color: #334155;
    line-height: 1.7;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    max-height: 360px;
    overflow-y: auto;
    padding: 1.5rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }

  .agreement-scroller p { margin: 0; }
  .agreement-scroller ol { margin: 0; padding-left: 1.5rem; }
  .agreement-scroller li { margin-top: 0.45rem; }

  .doc-terms-checkbox {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    cursor: pointer;
    user-select: none;
    transition: all 0.2s ease;
  }

  .doc-terms-checkbox:hover {
    background: #f1f5f9;
  }

  .doc-terms-checkbox.is-checked {
    border-color: #8b1a2a;
    background: #fff5f6;
  }

  .doc-terms-checkbox.is-checked .doc-cb-square {
    background: #8b1a2a;
    border-color: #8b1a2a;
  }

  .doc-terms-checkbox.is-checked .cb-checkmark {
    display: block;
  }

  .terms-text {
    font-size: 0.9rem;
    font-weight: 600;
    color: #1e293b;
  }

  .doc-link-action-box {
    padding: 1.25rem 1.5rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .doc-link-action-box p {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #1e293b;
  }

  .btn-agreement-download {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.85rem 1.25rem;
    background: #8b1a2a;
    color: #ffffff;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    border-radius: 8px;
    transition: all 0.2s ease;
    align-self: flex-start;
  }

  .btn-agreement-download:hover {
    background: #a51d2d;
    box-shadow: 0 4px 12px rgba(139, 26, 42, 0.25);
  }

  /* ── Bottom Decorative Accent (Matching Screenshot) ────────────────────────── */
  .doc-bottom-accent-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 1rem;
    margin-top: 0.5rem;
  }

  .accent-dots-cluster {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .accent-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #a51d2d;
  }

  .accent-ruler-line {
    flex: 1;
    height: 1.5px;
    background: linear-gradient(90deg, #a51d2d 0%, rgba(165, 29, 45, 0.2) 70%, transparent 100%);
  }

  /* ── Navigation Row ─────────────────────────────────────────────────────────── */
  .doc-nav-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 2.5rem 1.5rem;
    background: #ffffff;
    border-top: 1px solid #f1f5f9;
    gap: 1rem;
  }

  .doc-nav-forward-actions {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1.45rem;
    font-size: 0.9rem;
    font-weight: 700;
    font-family: inherit;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
  }

  .btn-status-return,
  .btn-back-step {
    background: #f8fafc;
    color: #475569;
    border: 1.5px solid #cbd5e1;
  }

  .btn-status-return:hover,
  .btn-back-step:hover {
    background: #ffffff;
    color: #8b1a2a;
    border-color: #8b1a2a;
  }

  .btn-next-step,
  .btn-submit-step {
    background: linear-gradient(135deg, #a51d2d 0%, #8b1a2a 100%);
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(139, 26, 42, 0.25);
  }

  .btn-next-step:hover:not(:disabled),
  .btn-submit-step:hover:not(:disabled) {
    background: linear-gradient(135deg, #b91c1c 0%, #a51d2d 100%);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(139, 26, 42, 0.35);
  }

  .btn-next-step:disabled,
  .btn-submit-step:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }

  .btn-loading {
    cursor: wait !important;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .doc-card-footer-help {
    text-align: center;
    font-size: 0.78rem;
    color: #94a3b8;
    padding: 0 2rem 1.25rem;
  }

  .footer-link {
    color: #8b1a2a;
    font-weight: 700;
    text-decoration: none;
  }

  .footer-link:hover {
    text-decoration: underline;
  }

  /* Closed application state */
  .doc-closed-card {
    max-width: 540px;
    margin: 2rem auto;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 3rem 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.85rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
  }

  .closed-title {
    margin: 0;
    color: #8b1a2a;
    font-size: 1.35rem;
    font-weight: 800;
  }

  .closed-desc {
    margin: 0;
    color: #64748b;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  /* ── Responsive Adaptations for Laptops, Tablets & Mobile Phones ───────────── */
  
  /* Laptops (900px - 1100px) */
  @media (max-width: 1024px) {
    .doc-page-wrapper {
      padding: 0 0.5rem 1.5rem;
    }

    .doc-sheet {
      max-width: 100%;
    }

    .doc-header-banner {
      min-height: 100px;
    }

    .banner-left-content {
      padding: 1.5rem 1.5rem 1.5rem 2rem;
    }

    .banner-main-title {
      font-size: 1.65rem;
    }

    .doc-body-content {
      padding: 2rem 2rem 1.25rem;
    }
  }

  /* Tablets & Phablets (< 768px) */
  @media (max-width: 768px) {
    .doc-header-banner {
      flex-direction: column;
      min-height: auto;
    }

    .banner-left-content {
      padding: 1.5rem;
    }

    .banner-right-chevron {
      width: 100%;
      min-width: 100%;
      clip-path: none;
      padding: 0.85rem 1.5rem;
      justify-content: flex-start;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
    }

    .doc-step-bar {
      padding: 1rem 1.5rem;
      overflow-x: auto;
    }

    .doc-step-title {
      display: none;
    }

    .doc-form-row {
      grid-template-columns: 1fr;
      gap: 0.45rem;
    }

    .doc-col-label {
      padding-top: 0;
    }

    .doc-body-content {
      padding: 1.5rem 1.5rem 1rem;
    }

    .doc-nav-row {
      padding: 1rem 1.5rem 1.25rem;
      flex-direction: column-reverse;
      gap: 0.75rem;
    }

    .btn-status-return {
      width: 100%;
    }

    .doc-nav-forward-actions {
      width: 100%;
    }

    .doc-nav-forward-actions .nav-btn {
      flex: 1;
    }

    .upload-tiles-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
  }

  /* Mobile Phones (< 480px) */
  @media (max-width: 480px) {
    .doc-page-wrapper {
      padding: 0;
    }

    .doc-sheet {
      border-radius: 8px;
      border-left: none;
      border-right: none;
    }

    .banner-main-title {
      font-size: 1.4rem;
    }

    .banner-subtitle-text {
      font-size: 0.78rem;
    }

    .banner-ruler-dot {
      display: none;
    }

    .doc-body-content {
      padding: 1.25rem 1rem 1rem;
    }

    .doc-fields-duo {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .doc-input-box,
    .doc-select-box {
      font-size: 1rem; /* Prevents iOS Safari auto-zoom */
      height: 46px;
    }

    .doc-checkbox-group {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.65rem;
    }

    .doc-checkbox-pill {
      width: 100%;
      padding: 0.6rem 0.5rem;
    }

    .upload-tiles-grid {
      grid-template-columns: 1fr !important;
    }

    .doc-nav-row {
      padding: 0.85rem 1rem 1.25rem;
    }
  }
</style>