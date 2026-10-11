import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getApplicationFormStatus, setApplicationFormOpen } from '$lib/server/applicationForm';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }
    const status = await getApplicationFormStatus();
    return json(status);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
    if (!locals.user || locals.user.role !== 'osa') {
        return json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const body = await request.json();
        if (typeof body.open !== 'boolean') {
            return json({ error: 'open must be a boolean' }, { status: 400 });
        }
        const updatedStatus = await setApplicationFormOpen(
            body.open,
            locals.user.user_id,
            locals.user.email
        );
        return json({ success: true, ...updatedStatus });
    } catch (error: any) {
        console.error('[ApplicationForm] PUT error:', error);
        return json({ error: error?.message || 'Failed to update application form status.' }, { status: 500 });
    }
};
