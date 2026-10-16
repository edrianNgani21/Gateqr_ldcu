import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { uploadToStorage } from '$lib/server/storage';
import { generateStyledQRBuffer } from '$lib/server/qr';
import { sendEmail } from '$lib/server/email';
import { isApplicationFormOpen } from '$lib/server/applicationForm';

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!(await isApplicationFormOpen())) {
        return json({ error: 'The application form is currently closed.' }, { status: 403 });
    }

    try {
        const formData = await request.formData();

        const role = formData.get('role') as string;
        const department_name = formData.get('department_name') as string;
        const id_no = formData.get('id_no') as string;
        const first_name = formData.get('first_name') as string;
        const last_name = formData.get('last_name') as string;
        const vehicle_make = formData.get('vehicle_make') as string;
        const vehicle_plate = formData.get('vehicle_plate') as string;
        const vehicle_color = formData.get('vehicle_color') as string || 'Not Specified';
        const vehicle_type = (formData.get('vehicle_type') as string) || '4-wheeler';
        const is_owner = formData.get('is_owner') as string;
        const contact_number = formData.get('contact_number') as string;
        const facebook = formData.get('facebook') as string;
        const campus = formData.get('campus') as string || 'Liceo Main';
        const year_level = formData.get('year_level') as string || null;

        const docKeys = ['doc_or', 'doc_cr', 'doc_license', 'doc_id', 'doc_load', 'doc_letter'];
        for (const key of docKeys) {
            const file = formData.get(key) as File | null;
            if (file && file.size > 0) {
                const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
                if (!isPdf) {
                    return json({ error: 'All submitted documents must be in PDF format. If you use CamScanner or any other scanning application, make sure to export or convert your scanned documents into a PDF file before uploading them to the system.' }, { status: 400 });
                }
            }
        }

        // Validate 11-digit Phone Number and ID Number
        const cleanPhone = (contact_number || '').trim().replace(/\D/g, '');
        if (cleanPhone.length !== 11) {
            return json({ error: 'Phone Number must be exactly 11 numbers (e.g. 09123456789).' }, { status: 400 });
        }

        const cleanSchoolId = (id_no || '').trim().replace(/\D/g, '');
        if (cleanSchoolId.length !== 11) {
            return json({ error: 'ID Number must be exactly 11 numbers.' }, { status: 400 });
        }

        const mode = formData.get('mode') as string;
        const renewalRegIdStr = formData.get('registration_id') as string;
        const renewal_registration_id = mode === 'renewal' && renewalRegIdStr ? parseInt(renewalRegIdStr, 10) : null;

        let existingRegForRenewal: any = null;
        if (renewal_registration_id) {
            const { data: foundReg } = await supabase
                .from('registration')
                .select('*, vehicle_information:vehicle_information_id(*)')
                .eq('registration_id', renewal_registration_id)
                .maybeSingle();

            if (foundReg) {
                existingRegForRenewal = foundReg;
            }
        }

        // =================================================================
        // DUPLICATE CHECKS: Email, School ID, and Plate Number
        // =================================================================

        // 1. Check duplicate active application for same email address
        const userEmail = (locals.user.email || '').trim().toLowerCase();
        const { data: existingUser } = await supabase
            .from('users')
            .select('user_id')
            .ilike('email', userEmail)
            .maybeSingle();

        if (existingUser?.user_id) {
            let dupQuery = supabase
                .from('registration')
                .select('registration_id, status')
                .eq('user_id', existingUser.user_id)
                .not('status', 'in', '("rejected","revoked")');

            if (renewal_registration_id) {
                dupQuery = dupQuery.neq('registration_id', renewal_registration_id);
            }

            const { data: duplicateApp } = await dupQuery.limit(1).maybeSingle();

            if (duplicateApp) {
                return json({
                    error: `An active vehicle registration application already exists for this email (${userEmail}). Duplicate applications are not allowed.`
                }, { status: 400 });
            }
        }

        // 2. Check duplicate School ID / Employee ID (school_id)
        if (cleanSchoolId) {
            let schoolQuery = supabase
                .from('registration')
                .select('registration_id, status')
                .ilike('school_id', cleanSchoolId)
                .not('status', 'in', '("rejected","revoked")');

            if (renewal_registration_id) {
                schoolQuery = schoolQuery.neq('registration_id', renewal_registration_id);
            }

            const { data: existingSchoolId } = await schoolQuery.limit(1).maybeSingle();

            if (existingSchoolId) {
                return json({
                    error: `School ID "${cleanSchoolId}" is already registered in the system. Duplicate School IDs are not allowed.`
                }, { status: 400 });
            }
        }

        // 3. Check duplicate Vehicle Plate Number (plate_number)
        const cleanPlate = (vehicle_plate || '').trim();
        const normalizedPlate = cleanPlate.replace(/[\s-]/g, '').toUpperCase();
        if (cleanPlate) {
            const { data: existingVehicles } = await supabase
                .from('vehicle_information')
                .select('vehicle_information_id, plate_number');

            const matchedVehicles = (existingVehicles || []).filter(v => {
                const existingNorm = (v.plate_number || '').replace(/[\s-]/g, '').toUpperCase();
                return existingNorm === normalizedPlate || (v.plate_number || '').trim().toLowerCase() === cleanPlate.toLowerCase();
            });

            if (matchedVehicles.length > 0) {
                const vehicleIds = matchedVehicles.map(v => v.vehicle_information_id);
                let plateQuery = supabase
                    .from('registration')
                    .select('registration_id, status')
                    .in('vehicle_information_id', vehicleIds)
                    .not('status', 'in', '("rejected","revoked")');

                if (renewal_registration_id) {
                    plateQuery = plateQuery.neq('registration_id', renewal_registration_id);
                }

                const { data: activeRegWithVehicle } = await plateQuery.limit(1).maybeSingle();

                if (activeRegWithVehicle) {
                    return json({
                        error: `Vehicle plate number "${cleanPlate}" is already registered in the system. Duplicate vehicle plates are not allowed.`
                    }, { status: 400 });
                }
            }
        }

        const saveFile = async (fileKey: string) => {
            const file = formData.get(fileKey) as File | null;
            if (!file || file.size === 0) return null;
            const buffer = Buffer.from(await file.arrayBuffer());
            const filename = `documents/${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            return await uploadToStorage(filename, buffer, file.type || 'application/pdf');
        };

        const doc_or = await saveFile('doc_or');
        const doc_cr = await saveFile('doc_cr');
        const doc_license = await saveFile('doc_license');
        const doc_id = await saveFile('doc_id');
        const doc_load = await saveFile('doc_load');
        const doc_letter = await saveFile('doc_letter');
        const doc_qr = null;

        const final_or = doc_or || (formData.get('existing_doc_or') as string) || existingRegForRenewal?.vehicle_information?.or || 'pending_or';
        const final_cr = doc_cr || (formData.get('existing_doc_cr') as string) || existingRegForRenewal?.vehicle_information?.cr || 'pending_cr';
        const final_license = doc_license || (formData.get('existing_doc_license') as string) || existingRegForRenewal?.drivers_license || 'pending_license';
        const final_id = doc_id || (formData.get('existing_doc_id') as string) || existingRegForRenewal?.doc_id || 'pending_id';
        const final_load = doc_load || (formData.get('existing_doc_load') as string) || existingRegForRenewal?.enrollment_form || 'pending_enrollment';
        const final_letter = doc_letter || (formData.get('existing_doc_letter') as string) || existingRegForRenewal?.vehicle_information?.authorization_letter || 'n/a';

        // Extract vehicle brand from vehicle_make (use vehicle_color from form)
        const vehicle_brand = vehicle_make;

        // 1. Ensure user exists in users table
        let { data: users, error: userError } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', locals.user.email)
            .maybeSingle();

        let user_id = users?.user_id;

        if (!user_id || userError) {
            let identRole: 'admin' | 'staff' | 'faculty' | 'student' = 'student';
            if (role === 'faculty') identRole = 'faculty';
            else if (role === 'staff' || role === 'employee') identRole = 'staff';

            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert({ 
                    email: locals.user.email,
                    user_type: 'applicant',
                    identification: identRole
                })
                .select('user_id')
                .single();

            if (createError) throw createError;
            user_id = newUser.user_id;

            // Send welcome email
            await sendEmail(
                locals.user.email,
                'Welcome to Liceo GateQR',
                'Welcome to Liceo GateQR! Your account has been successfully created.',
                '<h3>Welcome to Liceo GateQR!</h3><p>Your account has been successfully created.</p>'
            );
        }

        // 2. Resolve department_id (only active departments)
        let department_id = null;
        if (department_name) {
            const { data: allDepts } = await supabase
                .from('department')
                .select('*')
                .eq('is_active', true);

            const searchDept = department_name.trim().toLowerCase();
            const matched = (allDepts || []).find(d => {
                const acad = (d.academic_department || d['Academic Department'] || '').trim().toLowerCase();
                const admin = (d.administrative_department || d['Administrative Department'] || '').trim().toLowerCase();
                const legacy = (d.department_name || '').trim().toLowerCase();
                return acad === searchDept || admin === searchDept || legacy === searchDept;
            });

            if (matched) {
                department_id = matched.department_id;
            } else {
                return json({ error: 'Department not found. Please select from the available departments or contact OSA to add your department.' }, { status: 400 });
            }
        } else {
            // Fallback to first department
            const { data: defaultDept } = await supabase
                .from('department')
                .select('department_id')
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
            
            if (defaultDept) {
                department_id = defaultDept.department_id;
            }
        }

        // 3. Format vehicle type enum ('2_wheels' | '4_wheels')
        const vType: '2_wheels' | '4_wheels' = 
            (vehicle_type || '').toLowerCase().includes('2') || (vehicle_type || '').toLowerCase().includes('motor') 
                ? '2_wheels' 
                : '4_wheels';

        // 4. Format role enum ('student' | 'staff' | 'faculty')
        let regRole: 'student' | 'staff' | 'faculty' = 'student';
        const cleanRole = (role || '').toLowerCase();
        if (cleanRole === 'faculty') regRole = 'faculty';
        else if (cleanRole === 'staff' || cleanRole === 'employee') regRole = 'staff';
        else regRole = 'student';

        // =====================================================================
        // RENEWAL WORKFLOW: Update SAME registration_id & vehicle_information_id
        // =====================================================================
        if (renewal_registration_id && existingRegForRenewal) {
            if (existingRegForRenewal.vehicle_information_id) {
                await supabase
                    .from('vehicle_information')
                    .update({
                        or: final_or,
                        cr: final_cr,
                        plate_number: vehicle_plate.trim(),
                        color: vehicle_color.trim(),
                        brand: vehicle_brand.trim(),
                        type: vType,
                        authorization_letter: final_letter
                    })
                    .eq('vehicle_information_id', existingRegForRenewal.vehicle_information_id);
            }

            const updateRegPayload: any = {
                status: 'pending',
                department_id: department_id || existingRegForRenewal.department_id || 1,
                first_name: first_name.trim(),
                last_name: last_name.trim(),
                mobile: cleanPhone,
                school_id: cleanSchoolId,
                drivers_license: final_license,
                enrollment_form: final_load,
                role: regRole,
                doc_id: final_id,
                agreement_form: final_id || 'agreed',
                dept_val_at: null,
                osa_val_at: null,
                osa_dist_at: null,
                security_check_at: null,
                sticker_released_at: null,
                sticker_installed_at: null,
                schedule: null,
                rejection_reason: null,
                rejected_at: null,
                revoke_reason: null,
                revoke_at: null,
                updated_at: new Date().toISOString()
            };

            const { error: updateRegError } = await supabase
                .from('registration')
                .update(updateRegPayload)
                .eq('registration_id', renewal_registration_id);

            if (updateRegError) {
                console.error('Error updating registration for renewal:', updateRegError);
                throw updateRegError;
            }

            // Send renewal confirmation email
            await sendEmail(
                locals.user.email,
                'Registration Renewal Submitted - Liceo GateQR',
                'Your vehicle sticker renewal has been successfully submitted and is now under review for the new School Year.',
                '<p>Your vehicle sticker renewal has been successfully submitted and is now under review for the new School Year.</p>'
            );

            return json({ message: 'Renewal submitted successfully', status: 'pending', registration_id: renewal_registration_id });
        }

        // 5. Insert into vehicle_information table (Normal new application)
        const { data: vehicleData, error: vehicleError } = await supabase
            .from('vehicle_information')
            .insert({
                or: final_or,
                cr: final_cr,
                plate_number: vehicle_plate.trim(),
                color: vehicle_color.trim(),
                brand: vehicle_brand.trim(),
                type: vType,
                authorization_letter: final_letter
            })
            .select('vehicle_information_id')
            .single();

        if (vehicleError) {
            console.error('Error inserting vehicle information:', vehicleError);
            throw vehicleError;
        }

        const vehicle_information_id = vehicleData.vehicle_information_id;

        // 6. Generate QR code with guaranteed uniqueness
        let uniqueCode = '';
        let isCodeUnique = false;
        let attempts = 0;
        while (!isCodeUnique && attempts < 10) {
            attempts++;
            const randHex = Math.random().toString(36).substring(2, 8).toUpperCase();
            uniqueCode = `QR-${Date.now()}-${randHex}`;
            const { data: duplicateCode } = await supabase
                .from('registration')
                .select('registration_id')
                .eq('qr_unique_code', uniqueCode)
                .maybeSingle();

            if (!duplicateCode) {
                isCodeUnique = true;
            }
        }
        let qrUrl = `/api/qr?code=${encodeURIComponent(uniqueCode)}&role=${encodeURIComponent(regRole)}`;
        try {
            const qrBuffer = await generateStyledQRBuffer(uniqueCode, regRole);
            const qrFilename = `qr-codes/qr-${Date.now()}-${uniqueCode}.png`;
            qrUrl = await uploadToStorage(qrFilename, qrBuffer, 'image/png');
        } catch (qrErr) {
            console.warn('[Apply] Note: Generating dynamic QR endpoint URL:', qrErr);
        }

        // 7. Insert into registration table
        const regPayload: any = {
            vehicle_information_id,
            status: 'pending',
            user_id,
            department_id: department_id || 1,
            agreement_form: doc_id || 'agreed',
            first_name: first_name.trim(),
            last_name: last_name.trim(),
            mobile: cleanPhone,
            school_id: cleanSchoolId,
            drivers_license: doc_license || 'pending_license',
            enrollment_form: doc_load || 'pending_enrollment',
            role: regRole,
            qr_code: qrUrl,
            qr_unique_code: uniqueCode
        };

        if (doc_id) {
            regPayload.doc_id = doc_id;
        }

        let { error: insertError } = await supabase
            .from('registration')
            .insert(regPayload);

        if (insertError && insertError.message?.includes('doc_id')) {
            delete regPayload.doc_id;
            const fallbackRes = await supabase
                .from('registration')
                .insert(regPayload);
            insertError = fallbackRes.error;
        }

        if (insertError) {
            console.error('Error inserting registration:', insertError);
            throw insertError;
        }
        
        console.log('Application submitted successfully with department_id:', department_id);

        // Send submission email to applicant
        await sendEmail(
            locals.user.email,
            'Application Submitted - Liceo GateQR',
            'Your vehicle sticker application has been successfully submitted and is now under review.',
            '<p>Your vehicle sticker application has been successfully submitted and is now under review.</p>'
        );

        return json({ message: 'Application submitted successfully', status: 'pending' });
    } catch (error: any) {
        console.error('Failed to submit application:', error);
        return json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
};
