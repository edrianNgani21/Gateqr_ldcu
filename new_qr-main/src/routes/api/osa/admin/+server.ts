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
        await supabase.from('notifications').insert({
            user_id: userId,
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

        const { email, user_type, identification, password, pin } = await request.json();

        if (!email || !user_type || !identification) {
            return json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!password || typeof password !== 'string' || password.trim().length < 6) {
            return json({ error: 'Password is required and must be at least 6 characters' }, { status: 400 });
        }

        // 4-Digit PIN Verification Check
        const { data: requester, error: requesterError } = await supabase
            .from('user')
            .select('user_id, email, security_pin_hash')
            .eq('user_id', locals.user.user_id)
            .single();

        if (requesterError || !requester) {
            return json({ error: 'Failed to verify admin credentials' }, { status: 500 });
        }

        if (!requester.security_pin_hash) {
            return json({
                error: 'You must set up your 4-digit security PIN in Admin Settings before you can add new admin accounts.'
            }, { status: 400 });
        }

        if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin.trim())) {
            return json({ error: 'Please enter your 4-digit security PIN to authorize adding an admin' }, { status: 400 });
        }

        if (!bcrypt.compareSync(pin.trim(), requester.security_pin_hash)) {
            return json({ error: 'Incorrect 4-digit security PIN. Authorization denied.' }, { status: 401 });
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('user')
            .select('email')
            .eq('email', email.trim().toLowerCase())
            .single();

        if (existingUser) {
            return json({ error: 'User with this email already exists' }, { status: 400 });
        }

        const password_hash = bcrypt.hashSync(password.trim(), 10);

        // Create new admin user with password_hash
        const { data: newUser, error: createError } = await supabase
            .from('user')
            .insert({
                email: email.trim().toLowerCase(),
                user_type,
                identification,
                password_hash,
                is_active: true
            })
            .select('user_id, email, user_type')
            .single();

        if (createError) throw createError;

        // Create notification for OSA admin and the new admin
        if (newUser) {
            const actorId = locals.user?.user_id;
            if (actorId) {
                await createNotification(
                    actorId,
                    'admin_created',
                    'Admin added successfully.',
                    actorId,
                    'create_admin',
                    'user',
                    newUser.user_id,
                    newUser.user_id,
                    { user_type }
                );
            }
            if (newUser.user_id !== actorId) {
                await createNotification(
                    newUser.user_id,
                    'admin_created',
                    'Admin added successfully.',
                    actorId,
                    'create_admin',
                    'user',
                    newUser.user_id,
                    newUser.user_id,
                    { user_type }
                );
            }
        }

        console.log(`[Admin] New ${user_type} created (${newUser.email}) by primary admin ${callerEmail}`);

        return json({ 
            message: 'Admin created successfully',
            user: newUser
        });
    } catch (error) {
        console.error('Error creating admin:', error);
        return json({ error: 'Failed to create admin' }, { status: 500 });
    }
};

export const GET: RequestHandler = async ({ locals }) => {
    try {
        const { data: users, error } = await supabase
            .from('user')
            .select('user_id, email, user_type, identification, is_active, created_at')
            .in('user_type', ['Osa', 'Safety Security', 'dean'])
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
            .from('user')
            .update({ is_active })
            .eq('user_id', user_id)
            .select('user_id, email, user_type, is_active')
            .single();

        if (error) throw error;

        // Create notification for the admin whose status was changed
        if (updatedUser) {
            const actorId = locals.user?.user_id;
            await createNotification(
                updatedUser.user_id,
                is_active ? 'admin_activated' : 'admin_deactivated',
                is_active ? 'Admin activated successfully!' : 'Admin deactivated successfully!',
                actorId,
                is_active ? 'activate_admin' : 'deactivate_admin',
                'user',
                updatedUser.user_id,
                updatedUser.user_id,
                { user_type: updatedUser.user_type }
            );
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
            .from('user')
            .select('user_id, email, user_type')
            .eq('user_id', user_id)
            .single();

        const { error } = await supabase
            .from('user')
            .delete()
            .eq('user_id', user_id);

        if (error) throw error;

        // Create notification for the deleted admin (if we had their info)
        if (userToDelete) {
            const actorId = locals.user?.user_id;
            await createNotification(
                userToDelete.user_id,
                'admin_deleted',
                'Admin deleted successfully!',
                actorId,
                'delete_admin',
                'user',
                userToDelete.user_id,
                userToDelete.user_id,
                { user_type: userToDelete.user_type }
            );
        }

        return json({ message: 'Admin deleted successfully' });
    } catch (error) {
        console.error('Error deleting admin:', error);
        return json({ error: 'Failed to delete admin' }, { status: 500 });
    }
};