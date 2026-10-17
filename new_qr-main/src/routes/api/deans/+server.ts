import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';

async function createNotification(
    userId: number,
    notificationType: string,
    message: string,
    actorId?: number,
    actionType?: string,
    targetEntityType?: string,
    targetEntityId?: number
) {
    try {
        await supabase.from('notification').insert({
            user_id: userId,
            notification_type: notificationType,
            message: message,
            activity: message,
            actor_id: actorId || null,
            action_type: actionType || null,
            target_entity_type: targetEntityType || null,
            target_entity_id: targetEntityId || null,
            is_read: false
        });
    } catch (e) {
        console.error('Failed to create notification:', e);
    }
}

const PRIMARY_OSA_EMAIL = 'aluban98304@liceo.edu.ph';

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
        console.error('Failed to notify OSA of dean event:', error);
    }
}

export const GET: RequestHandler = async ({ locals }) => {
    // Only OSA can manage deans
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { data: rows } = await supabase
            .from('users')
            .select('*')
            .or('identification.eq.faculty,user_type.eq.dean')
            .order('created_at', { ascending: false });

        const deans = rows?.map(dean => ({
            user_id: dean.user_id,
            email: dean.email,
            department_id: dean.department_id,
            created_at: dean.created_at
        })) || [];

        return json({ deans });
    } catch (error) {
        console.error('Failed to fetch deans:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { email, department_id, password } = await request.json();

        if (!email) {
            return json({ error: 'Email is required' }, { status: 400 });
        }

        if (!password || typeof password !== 'string' || password.trim().length < 6) {
            return json({ error: 'Password is required and must be at least 6 characters' }, { status: 400 });
        }

        const password_hash = bcrypt.hashSync(password.trim(), 10);

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('user_id, user_type, identification, department_id')
            .ilike('email', email.trim().toLowerCase())
            .maybeSingle();

        let userId;

        if (existingUser) {
            // Update existing user to dean with department linkage
            const { error: updateUserError } = await supabase
                .from('users')
                .update({ 
                    user_type: 'dean',
                    identification: 'faculty',
                    department_id: department_id || null,
                    password_hash,
                    is_active: true
                })
                .eq('user_id', existingUser.user_id);

            if (updateUserError) throw updateUserError;
            userId = existingUser.user_id;
        } else {
            // Create new user as dean with password
            const { data: newUser, error: createUserError } = await supabase
                .from('users')
                .insert({
                    email: email.trim().toLowerCase(),
                    user_type: 'dean',
                    identification: 'faculty',
                    department_id: department_id || null,
                    password_hash,
                    is_active: true
                })
                .select('user_id')
                .single();

            if (createUserError) throw createUserError;
            userId = newUser.user_id;
        }

        // Notify all OSA admins
        await notifyAllOsa(
            'dean_added',
            `Dean account assigned successfully for ${email.toLowerCase()}.`,
            locals.user?.user_id,
            'create_dean',
            'users',
            userId
        );

        return json({ message: 'Dean account created successfully' }, { status: 201 });
    } catch (error: any) {
        console.error('Failed to create dean:', error);
        return json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
};

export const PUT: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { user_id, email, department_id, password } = await request.json();

        if (!user_id) {
            return json({ error: 'User ID is required' }, { status: 400 });
        }

        // Get current dean info
        const { data: currentDean, error: fetchError } = await supabase
            .from('users')
            .select('user_id, email, department_id')
            .eq('user_id', user_id)
            .single();

        if (fetchError) throw fetchError;

        const updates: any = {
            user_type: 'dean',
            identification: 'faculty'
        };
        
        if (email && email !== currentDean.email) {
            updates.email = email.trim().toLowerCase();
        }
        
        if (department_id !== undefined) {
            updates.department_id = department_id || null;
        }

        if (password && typeof password === 'string' && password.trim().length >= 6) {
            updates.password_hash = bcrypt.hashSync(password.trim(), 10);
        }

        // Update user in users table
        const { error: updateUserError } = await supabase
            .from('users')
            .update(updates)
            .eq('user_id', user_id);

        if (updateUserError) throw updateUserError;

        return json({ message: 'Dean updated successfully' });
    } catch (error: any) {
        console.error('Failed to update dean:', error);
        return json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { user_id } = await request.json();

        if (!user_id) {
            return json({ error: 'User ID is required' }, { status: 400 });
        }

        // Fetch dean info before deletion for notification
        const { data: deanToDelete } = await supabase
            .from('users')
            .select('user_id, email')
            .eq('user_id', user_id)
            .maybeSingle();

        // Delete from users table
        const { error: deleteUserError } = await supabase
            .from('users')
            .delete()
            .eq('user_id', user_id);

        if (deleteUserError) throw deleteUserError;

        // Notify all OSA admins
        await notifyAllOsa(
            'dean_deleted',
            `Dean account (${deanToDelete?.email || 'User ID ' + user_id}) was deleted successfully.`,
            locals.user?.user_id,
            'delete_dean',
            'users',
            user_id
        );

        return json({ message: 'Dean account deleted successfully' });
    } catch (error: any) {
        console.error('Failed to delete dean:', error);
        return json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
};