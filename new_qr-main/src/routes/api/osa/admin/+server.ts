import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';

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

        const { email, user_type, password, pin } = await request.json();

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

        // Map incoming adminType to valid PostgreSQL lowercase enums
        const cleanType = (user_type || '').toString().trim().toLowerCase();
        let dbUserType: 'osa' | 'safety_security' | 'applicant' = 'osa';
        let dbIdentification: 'admin' | 'staff' | 'faculty' | 'student' = 'admin';

        if (cleanType.includes('security')) {
            dbUserType = 'safety_security';
            dbIdentification = 'admin';
        } else if (cleanType.includes('dean') || cleanType.includes('faculty')) {
            dbUserType = 'applicant';
            dbIdentification = 'faculty';
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
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                email: email.trim().toLowerCase(),
                user_type: dbUserType,
                identification: dbIdentification,
                password_hash,
                is_active: true
            })
            .select('user_id, email, user_type, identification, is_active, created_at')
            .single();

        if (createError) {
            console.error('[Admin] Database error creating admin:', createError);
            return json({ error: `Database error: ${createError.message}` }, { status: 500 });
        }

        // Create notification for OSA admin and the new admin
        if (newUser) {
            const actorId = locals.user?.user_id;
            if (actorId) {
                await createNotification(
                    actorId,
                    'admin_created',
                    `Admin account (${newUser.email}) added successfully.`,
                    actorId,
                    'create_admin',
                    'users',
                    newUser.user_id,
                    newUser.user_id,
                    { user_type: dbUserType, identification: dbIdentification }
                );
            }
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
            .select('user_id, email, user_type, identification, is_active, created_at')
            .or('user_type.in.(osa,safety_security),identification.eq.faculty')
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

        // Create notification for the deleting admin
        if (userToDelete) {
            const actorId = locals.user?.user_id;
            if (actorId) {
                await createNotification(
                    actorId,
                    'admin_deleted',
                    `Admin account (${userToDelete.email}) was deleted successfully.`,
                    actorId,
                    'delete_admin',
                    'users',
                    actorId,
                    actorId,
                    { user_type: userToDelete.user_type }
                );
            }
        }

        return json({ message: 'Admin deleted successfully' });
    } catch (error) {
        console.error('Error deleting admin:', error);
        return json({ error: 'Failed to delete admin' }, { status: 500 });
    }
};