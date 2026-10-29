import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canAccessFile, createSignedFileUrl } from '$lib/server/files';

// Opens an uploaded file from the private bucket for a logged-in user who is allowed to see it.
export const GET: RequestHandler = async ({ params, locals, url }) => {
    const path = decodeURIComponent(params.path || '').replace(/^\/+/, '');
    if (!path || path.includes('..')) {
        throw error(400, 'Invalid file path');
    }
    if (!locals.user) {
        throw redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
    }
    if (!(await canAccessFile(locals.user, path))) {
        throw error(403, 'You do not have access to this file');
    }
    const signed = await createSignedFileUrl(path);
    if (!signed) {
        throw error(404, 'File not found');
    }
    // Signed links expire after a few minutes; never cache the redirect
    return new Response(null, {
        status: 302,
        headers: { Location: signed, 'Cache-Control': 'private, no-store' }
    });
};
