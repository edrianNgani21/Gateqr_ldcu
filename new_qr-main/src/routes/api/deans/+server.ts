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
        await supabase.from('notifications').insert({
            user_id: userId,
            notification_type: notificationType,
            message: message,
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

export const GET: RequestHandler = async ({ locals }) => {
    // Only OSA can manage deans
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { data: rows } = await supabase
            .from('user')
            .select('*')
            .eq('user_type', 'dean')
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
        const { data: existingUser, error: userCheckError } = await supabase
            .from('user')
            .select('user_id, user_type, department_id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        let userId;

        if (existingUser) {
            // User exists - check if they're already a dean for another department
            if (existingUser.user_type === 'dean' && existingUser.department_id && existingUser.department_id !== department_id) {
                return json({ error: 'This email is already assigned as a dean for another department' }, { status: 400 });
            }
            
            // Update existing user to be a dean with password
            const { error: updateUserError } = await supabase
                .from('user')
                .update({ 
                    user_type: 'dean',
                    identification: 'Faculty',
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
                .from('user')
                .insert({
                    email: email.toLowerCase(),
                    user_type: 'dean',
                    identification: 'Faculty',
                    department_id: department_id || null,
                    password_hash,
                    is_active: true
                })
                .select('user_id')
                .single();

            if (createUserError) throw createUserError;
            userId = newUser.user_id;
        }

        // If department_id is provided, update the department's email and user_id
        if (department_id) {
            const { error: updateDeptError } = await supabase
                .from('department')
                .update({ 
                    email: email.toLowerCase(),
                    user_id: userId
                })
                .eq('department_id', department_id);

            if (updateDeptError) throw updateDeptError;
        }

        // Notify OSA admin
        if (locals.user?.user_id) {
            await createNotification(
                locals.user.user_id,
                'dean_added',
                `Dean account assigned successfully for ${email.toLowerCase()}.`,
                locals.user.user_id,
                'create_dean',
                'user',
                userId
            );
        }

        return json({ message: 'Dean account created successfully' }, { status: 201 });
    } catch (error) {
        console.error('Failed to create dean:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
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
            .from('user')
            .select('user_id, email, department_id')
            .eq('user_id', user_id)
            .single();

        if (fetchError) throw fetchError;

        const updates: any = {};
        
        if (email && email !== currentDean.email) {
            updates.email = email.toLowerCase();
        }
        
        if (department_id !== undefined && department_id !== currentDean.department_id) {
            updates.department_id = department_id || null;
        }

        if (password && typeof password === 'string' && password.trim().length >= 6) {
            updates.password_hash = bcrypt.hashSync(password.trim(), 10);
        }

        if (Object.keys(updates).length === 0) {
            return json({ error: 'No changes to update' }, { status: 400 });
        }

        // Update user
        const { error: updateUserError } = await supabase
            .from('user')
            .update(updates)
            .eq('user_id', user_id);

        if (updateUserError) throw updateUserError;

        // If department changed, update department records
        if (department_id !== undefined && department_id !== currentDean.department_id) {
            // Remove from old department
            if (currentDean.department_id) {
                await supabase
                    .from('department')
                    .update({ email: null, user_id: null })
                    .eq('department_id', currentDean.department_id);
            }

            // Add to new department
            if (department_id) {
                await supabase
                    .from('department')
                    .update({ 
                        email: email || currentDean.email,
                        user_id: user_id
                    })
                    .eq('department_id', department_id);
            }
        }

        return json({ message: 'Dean updated successfully' });
    } catch (error) {
        console.error('Failed to update dean:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
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

        // Get dean's department before deletion
        const { data: dean } = await supabase
            .from('user')
            .select('department_id')
            .eq('user_id', user_id)
            .single();

        // Remove dean from department
        if (dean?.department_id) {
            await supabase
                .from('department')
                .update({ email: null, user_id: null })
                .eq('department_id', dean.department_id);
        }

        // Delete or revert the user account
        const { error: deleteUserError } = await supabase
            .from('user')
            .delete()
            .eq('user_id', user_id);

        if (deleteUserError) throw deleteUserError;

        return json({ message: 'Dean account deleted successfully' });
    } catch (error) {
        console.error('Failed to delete dean:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};