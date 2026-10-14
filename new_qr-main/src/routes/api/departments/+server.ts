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

        // Map department for display (support academic_department, administrative_department, and department_name)
        const departments = rows?.map(dept => {
            const administrative = dept.administrative_department || dept['Administrative Department'];
            const academic = dept.academic_department || dept['Academic Department'] || (!administrative ? dept.department_name : null);
            const deptType = administrative ? 'administrative' : 'academic';
            const displayName = (deptType === 'administrative' ? administrative : academic) || dept.department_name || 'Unnamed Department';

            return {
                ...dept,
                name: displayName,
                department: displayName,
                academic_department: academic,
                administrative_department: administrative,
                type: deptType,
                auto_id: dept.department_id,
                department_id: dept.department_id,
                is_active: dept.is_active ?? true
            };
        }) || [];

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
        const { name, type = 'academic' } = await request.json();

        if (!name || !name.trim()) {
            return json({ error: 'Department name is required' }, { status: 400 });
        }

        const isAdministrative = type === 'administrative';
        let newDept: any = null;
        let createError: any = null;

        // Attempt 1: snake_case column
        const primaryPayload: any = { is_active: true };
        if (isAdministrative) {
            primaryPayload.administrative_department = name.trim();
        } else {
            primaryPayload.academic_department = name.trim();
        }

        const res1 = await supabase
            .from('department')
            .insert(primaryPayload)
            .select('*')
            .single();

        if (!res1.error) {
            newDept = res1.data;
        } else {
            // Attempt 2: Quoted Title Case column
            const titleCasePayload: any = { is_active: true };
            if (isAdministrative) {
                titleCasePayload['Administrative Department'] = name.trim();
            } else {
                titleCasePayload['Academic Department'] = name.trim();
            }

            const res2 = await supabase
                .from('department')
                .insert(titleCasePayload)
                .select('*')
                .single();

            if (!res2.error) {
                newDept = res2.data;
            } else {
                // Attempt 3: Legacy department_name fallback
                const legacyPayload: any = { department_name: name.trim(), is_active: true };
                const res3 = await supabase
                    .from('department')
                    .insert(legacyPayload)
                    .select('*')
                    .single();

                if (!res3.error) {
                    newDept = res3.data;
                } else {
                    createError = res1.error;
                }
            }
        }

        if (createError && !newDept) {
            console.error('Error creating department:', createError);
            return json({ error: createError.message || 'Failed to create department' }, { status: 500 });
        }

        // Notify OSA admin
        if (locals.user?.user_id) {
            await createNotification(
                locals.user.user_id,
                'department_added',
                `${isAdministrative ? 'Administrative' : 'Academic'} Department '${name.trim()}' added successfully.`,
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
        const { auto_id, name, type } = await request.json();

        if (!auto_id || !name || !name.trim()) {
            return json({ error: 'ID and Name are required' }, { status: 400 });
        }

        const isAdministrative = type === 'administrative';

        // Attempt 1: snake_case column
        const updatePayload: any = {};
        if (isAdministrative) {
            updatePayload.administrative_department = name.trim();
        } else {
            updatePayload.academic_department = name.trim();
        }

        let { error } = await supabase
            .from('department')
            .update(updatePayload)
            .eq('department_id', auto_id);

        if (error) {
            // Attempt 2: Title Case
            const titlePayload: any = {};
            if (isAdministrative) {
                titlePayload['Administrative Department'] = name.trim();
            } else {
                titlePayload['Academic Department'] = name.trim();
            }
            const res2 = await supabase
                .from('department')
                .update(titlePayload)
                .eq('department_id', auto_id);

            if (res2.error) {
                // Attempt 3: Legacy department_name
                const res3 = await supabase
                    .from('department')
                    .update({ department_name: name.trim() })
                    .eq('department_id', auto_id);
                if (res3.error) throw res3.error;
            }
        }

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
