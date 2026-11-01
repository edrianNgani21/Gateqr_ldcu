import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    // RBAC: Only OSA
    if (!locals.user || locals.user.role !== 'osa') {
        throw redirect(303, '/login');
    }

    return { userEmail: locals.user.email };
};
