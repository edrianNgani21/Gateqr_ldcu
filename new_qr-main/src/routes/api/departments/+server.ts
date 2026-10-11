import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ locals, url }) => {
    // Only OSA can manage departments (or maybe Dean to view their own, but let's restrict to OSA for listing all)
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const statusFilter = url.searchParams.get('status'); // 'active', 'inactive', or 'all'
        
        let query = supabase
            .from('department')
            .select('*')
            .order('created_at', { ascending: false });

        if (statusFilter === 'active') {
            query = query.eq('is_active', true);
        } else if (statusFilter === 'inactive') {
            query = query.eq('is_active', false);
        }
        // 'all' or no filter returns all departments

        const { data: rows } = await query;

        // Map department_name for display
        const departments = rows?.map(dept => ({
            ...dept,
            name: dept.department_name,
            department: dept.department_name,
            auto_id: dept.department_id,
            is_active: dept.is_active ?? true
        })) || [];

        return json({ departments });
    } catch (error) {
        console.error('Failed to fetch departments:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

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

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { name } = await request.json();

        if (!name || !name.trim()) {
            return json({ error: 'Department name is required' }, { status: 400 });
        }

        // Insert new department using department_name
        const { data: newDept, error } = await supabase
            .from('department')
            .insert({ 
                department_name: name.trim(),
                is_active: true
            })
            .select('department_id, department_name')
            .single();

        if (error) {
            console.error('Error creating department:', error);
            return json({ error: error.message || 'Failed to create department' }, { status: 500 });
        }

        // Notify OSA admin
        if (locals.user?.user_id) {
            await createNotification(
                locals.user.user_id,
                'department_added',
                `Department '${name.trim()}' added successfully.`,
                locals.user.user_id,
                'create_department',
                'department',
                newDept?.department_id
            );
        }

        return json({ message: 'Department created successfully', department: newDept }, { status: 201 });
    } catch (error: any) {
        console.error('Failed to create department:', error);
        return json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
};

export const PUT: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { auto_id, name } = await request.json();

        if (!auto_id || !name || !name.trim()) {
            return json({ error: 'ID and Name are required' }, { status: 400 });
        }

        const { error } = await supabase
            .from('department')
            .update({ department_name: name.trim() })
            .eq('department_id', auto_id);

        if (error) throw error;

        return json({ message: 'Department updated successfully' });
    } catch (error) {
        console.error('Failed to update department:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { auto_id } = await request.json();

        if (!auto_id) {
            return json({ error: 'Department ID is required' }, { status: 400 });
        }

        // Soft delete - set is_active to false instead of permanent deletion
        const { error } = await supabase
            .from('department')
            .update({ is_active: false })
            .eq('department_id', auto_id);

        if (error) throw error;

        return json({ message: 'Department deactivated successfully' });
    } catch (error) {
        console.error('Failed to deactivate department:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { auto_id } = await request.json();

        if (!auto_id) {
            return json({ error: 'Department ID is required' }, { status: 400 });
        }

        // Reactivate department - set is_active to true
        const { error } = await supabase
            .from('department')
            .update({ is_active: true })
            .eq('department_id', auto_id);

        if (error) throw error;

        return json({ message: 'Department activated successfully' });
    } catch (error) {
        console.error('Failed to activate department:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};
