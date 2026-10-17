import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';
import { sendEmailAsync } from '$lib/server/email';

const PRIMARY_OSA_EMAIL = 'aluban98304@liceo.edu.ph';

async function createNotification(
    userId: number,
    notificationType: string,
    message: string,
    actorId?: number,
    actionType?: string,
    targetEntityType?: string,
    targetEntityId?: number,
    referenceId?: number,
    metadata?: any
) {
    try {
        await supabase.from('notification').insert({
            user_id: userId,
            activity: message,
            notification_type: notificationType,
            message: message,
            actor_id: actorId || null,
            action_type: actionType || null,
            target_entity_type: targetEntityType || null,
            target_entity_id: targetEntityId || null,
            reference_id: referenceId || null,
            metadata: metadata || null,
            is_read: false
        });
    } catch (error) {
        console.error('Failed to create notification:', error);
    }
}

async function notifyAllOsa(
    notificationType: string,
    message: string,
    actorId?: number,
    actionType?: string,
    targetEntityType?: string,
    targetEntityId?: number,
    metadata?: any
) {
    try {
        const osaFilters = ['user_type.eq.osa', `email.eq.${PRIMARY_OSA_EMAIL}`];
        const { data: osaUsers } = await supabase
            .from('users')
            .select('user_id, email')
            .or(osaFilters.join(','));

        const uniqueOsaUsers = Array.from(
            new Map((osaUsers || []).map(u => [u.user_id, u])).values()
        );

        if (uniqueOsaUsers.length > 0) {
            const notifs = uniqueOsaUsers.map(u => ({
                user_id: u.user_id,
                activity: message,
                notification_type: notificationType,
                message: message,
                actor_id: actorId || null,
                action_type: actionType || null,
                target_entity_type: targetEntityType || null,
                target_entity_id: targetEntityId || null,
                reference_id: targetEntityId || null,
                metadata: metadata || null,
                is_read: false
            }));
            await supabase.from('notification').insert(notifs);
        }
    } catch (error) {
        console.error('Failed to notify OSA admins:', error);
    }
}

function getAdminRoleDetails(cleanType: string, departmentData: any) {
    const deptName = departmentData?.academic_department || 
                     departmentData?.administrative_department || 
                     departmentData?.department_name || 
                     departmentData?.department || '';

    if (cleanType.includes('security')) {
        return {
            roleTitle: 'Security Administrator',
            adminType: 'Security Administrator',
            targetPortal: 'Safety & Security Dashboard'
        };
    }
    
    if (cleanType.includes('administrative')) {
        return {
            roleTitle: 'Administrative Department Head',
            adminType: `Administrative Department Head${deptName ? ` (${deptName})` : ''}`,
            targetPortal: 'Administrative Head Review Portal'
        };
    }

    if (cleanType.includes('academic') || cleanType.includes('dean')) {
        return {
            roleTitle: 'Academic Department Head',
            adminType: `Academic Department Head (Dean)${deptName ? ` - ${deptName}` : ''}`,
            targetPortal: 'Dean Review Portal'
        };
    }

    // Default: OSA Admin
    return {
        roleTitle: 'Office of Student Affairs (OSA) Administrator',
        adminType: 'Office of Student Affairs (OSA) Administrator',
        targetPortal: 'OSA Admin Portal'
    };
}

function sendAdminWelcomeEmail(user: any, rawPassword: string, cleanType: string) {
    const roleDetails = getAdminRoleDetails(cleanType, user.department);
    const subject = `GateQR Administrator Account Provisioned — ${roleDetails.roleTitle}`;

    const text = `Welcome to Liceo GateQR!\n\n` +
        `You have been assigned as ${roleDetails.adminType} for the Liceo GateQR system. Your account has been granted access to the ${roleDetails.adminType} Dashboard, where you can manage applications and perform the functions and responsibilities assigned to your administrative role.\n\n` +
        `Your Login Credentials:\n` +
        `-----------------------------------------\n` +
        `Admin Type: ${roleDetails.adminType}\n` +
        `Login Email: ${user.email}\n` +
        `Temporary Password: ${rawPassword}\n` +
        `Portal URL: /login\n` +
        `-----------------------------------------\n\n` +
        `Security Best Practices:\n` +
        `Upon logging in, please visit Settings to configure your 4-digit security PIN and update your temporary password to ensure full account protection.\n\n` +
        `Office of Student Affairs & Safety and Security Department\n` +
        `Liceo de Cagayan University`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <style>
        body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
        .wrapper { width: 100%; max-width: 580px; margin: 30px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%); padding: 32px 28px; text-align: center; color: #ffffff; border-bottom: 4px solid #D4AF37; }
        .univ-title { font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #F3E5AB; margin: 0 0 6px 0; }
        .app-title { font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.02em; }
        .role-badge { display: inline-block; background: rgba(233, 194, 94, 0.2); border: 1px solid #E9C25E; color: #F3E5AB; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-top: 10px; }
        .body-content { padding: 32px 28px; }
        .greeting { font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
        .desc { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
        .credentials-card { background: #fdfaf3; border: 1.5px solid #F0CF72; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
        .card-heading { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #854d0e; margin-bottom: 14px; }
        .cred-row { padding: 8px 0; border-bottom: 1px dashed rgba(212, 166, 42, 0.4); font-size: 14px; }
        .cred-row:last-child { border-bottom: none; }
        .cred-label { color: #64748b; font-weight: 600; display: inline-block; width: 140px; }
        .cred-value { font-weight: 700; color: #0f172a; font-family: monospace; font-size: 14px; }
        .cred-badge { font-family: inherit; font-size: 13px; color: #7A1734; background: rgba(122, 23, 52, 0.08); padding: 2px 8px; border-radius: 6px; font-weight: 700; }
        .notice-box { background: #f8fafc; border-left: 4px solid #7A1734; padding: 14px 16px; border-radius: 8px; margin-top: 20px; }
        .notice-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
        .notice-text { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <div class="univ-title">Liceo de Cagayan University</div>
          <div class="app-title">GateQR Vehicle Access Management</div>
          <div class="role-badge">${roleDetails.roleTitle}</div>
        </div>
        <div class="body-content">
          <div class="greeting">Welcome to Liceo GateQR!</div>
          <p class="desc">
            You have been assigned as <strong>${roleDetails.adminType}</strong> for the Liceo GateQR system. Your account has been granted access to the <strong>${roleDetails.adminType} Dashboard</strong>, where you can manage applications and perform the functions and responsibilities assigned to your administrative role.
          </p>

          <div class="credentials-card">
            <div class="card-heading">Your Login Credentials</div>
            <div class="cred-row">
              <span class="cred-label">Admin Type:</span>
              <span class="cred-badge">${roleDetails.adminType}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Login Email:</span>
              <span class="cred-value">${user.email}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Assigned Password:</span>
              <span class="cred-value" style="color: #7A1734;">${rawPassword}</span>
            </div>
            <div class="cred-row">
              <span class="cred-label">Assigned Portal:</span>
              <span class="cred-value" style="font-family: inherit;">${roleDetails.targetPortal}</span>
            </div>
          </div>

          <div class="notice-box">
            <div class="notice-title">Security Best Practices</div>
            <p class="notice-text">
              Upon logging in, please visit <strong>Settings</strong> to configure your 4-digit security PIN and update your temporary password to ensure full account protection.
            </p>
          </div>
        </div>
        <div class="footer">
          <div>Office of Student Affairs & Safety and Security Department</div>
          <div>Liceo de Cagayan University, Rodelsa Hall, Cagayan de Oro City</div>
        </div>
      </div>
    </body>
    </html>
    `;

    sendEmailAsync(user.email, subject, text, html);
}

export const POST: RequestHandler = async ({ request, locals }) => {
    try {
        if (!locals.user || locals.user.role !== 'osa') {
            return json({ error: 'Unauthorized. OSA Admin privileges required.' }, { status: 401 });
        }

        const callerEmail = (locals.user.email || '').trim().toLowerCase();

        // Restriction: Only aluban98304@liceo.edu.ph can add admins
        if (callerEmail !== PRIMARY_OSA_EMAIL.toLowerCase()) {
            return json({
                error: `Permission denied. Only the primary OSA administrator (${PRIMARY_OSA_EMAIL}) is authorized to add new admin accounts.`
            }, { status: 403 });
        }

        const { email, user_type, password, pin, department_id } = await request.json();

        if (!email || !user_type) {
            return json({ error: 'Missing required fields: email and admin type are required' }, { status: 400 });
        }

        // 4-Digit PIN Verification Check
        const { data: requester, error: requesterError } = await supabase
            .from('users')
            .select('user_id, email, security_pin_hash')
            .eq('user_id', locals.user.user_id)
            .single();

        if (requesterError || !requester) {
            return json({ error: 'Failed to verify admin credentials' }, { status: 500 });
        }

        if (requester.security_pin_hash) {
            if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin.trim())) {
                return json({ error: 'Please enter your 4-digit security PIN to authorize adding an admin' }, { status: 400 });
            }

            if (!bcrypt.compareSync(pin.trim(), requester.security_pin_hash)) {
                return json({ error: 'Incorrect 4-digit security PIN. Authorization denied.' }, { status: 401 });
            }
        }

        // Map incoming adminType to valid PostgreSQL types and identification
        const cleanType = (user_type || '').toString().trim().toLowerCase();
        let dbUserType: string = 'osa';
        let dbIdentification: string = 'admin';

        if (cleanType.includes('security')) {
            dbUserType = 'safety_security';
            dbIdentification = 'admin';
        } else if (cleanType.includes('academic') || cleanType.includes('dean')) {
            dbUserType = 'Academic Head';
            dbIdentification = 'admin';
        } else if (cleanType.includes('administrative') || cleanType.includes('office')) {
            dbUserType = 'Office Head';
            dbIdentification = 'admin';
        } else {
            dbUserType = 'osa';
            dbIdentification = 'admin';
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .ilike('email', email.trim().toLowerCase())
            .maybeSingle();

        if (existingUser) {
            return json({ error: 'User with this email already exists' }, { status: 400 });
        }

        const rawPassword = (password && typeof password === 'string' && password.trim().length >= 6)
            ? password.trim()
            : 'Admin123!';
        const password_hash = bcrypt.hashSync(rawPassword, 10);

        // Create new admin user in users table
        const insertPayload: any = {
            email: email.trim().toLowerCase(),
            user_type: dbUserType,
            identification: dbIdentification,
            password_hash,
            is_active: true
        };
        if (department_id) {
            insertPayload.department_id = department_id;
        }

        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert(insertPayload)
            .select(`
                user_id, 
                email, 
                user_type, 
                identification, 
                department_id,
                department:department_id(*),
                is_active, 
                created_at
            `)
            .single();

        if (createError) {
            console.error('[Admin] Database error creating admin:', createError);
            return json({ error: `Database error: ${createError.message}` }, { status: 500 });
        }

        // Create notification for all OSA admins and dispatch welcome email
        if (newUser) {
            const actorId = locals.user?.user_id;
            await notifyAllOsa(
                'admin_created',
                `Admin account (${newUser.email}) added successfully.`,
                actorId,
                'create_admin',
                'users',
                newUser.user_id,
                { user_type: dbUserType, identification: dbIdentification, department_id }
            );

            // Dispatch welcome email with role-specific message, login email, password and Admin Type
            sendAdminWelcomeEmail(newUser, rawPassword, cleanType);
        }

        console.log(`[Admin] New ${dbUserType} (${dbIdentification}) created (${newUser.email}) by primary admin ${callerEmail}`);

        return json({ 
            message: 'Admin created successfully',
            user: newUser
        });
    } catch (error: any) {
        console.error('Error creating admin:', error);
        return json({ error: error?.message || 'Failed to create admin' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ locals }) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select(`
                user_id, 
                email, 
                user_type, 
                identification, 
                department_id,
                department:department_id(*),
                is_active, 
                created_at
            `)
            .or('user_type.in.(osa,safety_security,dean,"Academic Head","Office Head"),identification.in.(admin,faculty,staff),department_id.not.is.null')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const callerEmail = (locals.user?.email || '').trim().toLowerCase();
        const isPrimaryAdmin = callerEmail === PRIMARY_OSA_EMAIL.toLowerCase();

        return json({ 
            users: users || [],
            isPrimaryAdmin
        });
    } catch (error) {
        console.error('Error fetching admins:', error);
        return json({ error: 'Failed to fetch admins' }, { status: 500 });
    }
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
    try {
        if (!locals.user || locals.user.role !== 'osa') {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const callerEmail = (locals.user.email || '').trim().toLowerCase();
        if (callerEmail !== PRIMARY_OSA_EMAIL.toLowerCase()) {
            return json({
                error: `Permission denied. Only the primary OSA administrator (${PRIMARY_OSA_EMAIL}) can modify admin accounts.`
            }, { status: 403 });
        }

        const { user_id, is_active } = await request.json();

        if (!user_id || typeof is_active !== 'boolean') {
            return json({ error: 'Missing required fields' }, { status: 400 });
        }

        const { data: updatedUser, error } = await supabase
            .from('users')
            .update({ is_active })
            .eq('user_id', user_id)
            .select('user_id, email, user_type, is_active')
            .single();

        if (error) throw error;

        // Create notification for the admin whose status was changed
        if (updatedUser) {
            const actorId = locals.user?.user_id;
            if (actorId) {
                await createNotification(
                    updatedUser.user_id,
                    is_active ? 'admin_activated' : 'admin_deactivated',
                    is_active ? 'Admin activated successfully!' : 'Admin deactivated successfully!',
                    actorId,
                    is_active ? 'activate_admin' : 'deactivate_admin',
                    'users',
                    updatedUser.user_id,
                    updatedUser.user_id,
                    { user_type: updatedUser.user_type }
                );
            }
        }

        return json({
            message: is_active ? 'Account activated successfully' : 'Account deactivated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating admin status:', error);
        return json({ error: 'Failed to update admin status' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
    try {
        if (!locals.user || locals.user.role !== 'osa') {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const callerEmail = (locals.user.email || '').trim().toLowerCase();
        if (callerEmail !== PRIMARY_OSA_EMAIL.toLowerCase()) {
            return json({
                error: `Permission denied. Only the primary OSA administrator (${PRIMARY_OSA_EMAIL}) can delete admin accounts.`
            }, { status: 403 });
        }

        const { user_id } = await request.json();

        if (!user_id) {
            return json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Get user info before deletion for notification
        const { data: userToDelete } = await supabase
            .from('users')
            .select('user_id, email, user_type')
            .eq('user_id', user_id)
            .single();

        const { error } = await supabase
            .from('users')
            .delete()
            .eq('user_id', user_id);

        if (error) throw error;

        // Create notification for all OSA admins
        if (userToDelete) {
            const actorId = locals.user?.user_id;
            await notifyAllOsa(
                'admin_deleted',
                `Admin account (${userToDelete.email}) was deleted successfully.`,
                actorId,
                'delete_admin',
                'users',
                user_id,
                { user_type: userToDelete.user_type }
            );
        }

        return json({ message: 'Admin deleted successfully' });
    } catch (error) {
        console.error('Error deleting admin:', error);
        return json({ error: 'Failed to delete admin' }, { status: 500 });
    }
};