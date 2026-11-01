import type { LayoutServerLoad } from './$types';

// Signed-in account name (from Google) for the top bar on every page
export const load: LayoutServerLoad = async ({ locals }) => {
    return { userName: locals.user?.name ?? null };
};
