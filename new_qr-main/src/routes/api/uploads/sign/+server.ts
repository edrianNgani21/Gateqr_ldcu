import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase';
import { FILES_BUCKET } from '$lib/server/files';
import { uploadFolder } from '$lib/server/directUpload';
import { apiFailure } from '$lib/server/apiError';
import { fileSizeError, IMAGE_TYPES, PDF_TYPES } from '$lib/limits';

const ALLOWED_TYPES = [...PDF_TYPES, ...IMAGE_TYPES];

// Issues a one-time link so the browser can upload one document straight to storage.
export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user?.user_id) {
        return json({ error: 'Your session has expired. Please sign in and try again.' }, { status: 401 });
    }

    try {
        const { name, type, size, label } = await request.json();
        const fileLabel = String(label || 'file').slice(0, 60);

        const sizeError = fileSizeError(fileLabel, Number(size) || 0);
        if (sizeError) return json({ error: sizeError }, { status: 400 });
        if (!ALLOWED_TYPES.includes(type)) {
            return json({ error: `Your ${fileLabel} is not an accepted file type. Please upload a PDF, JPG, or PNG file.` }, { status: 400 });
        }

        const safeName = String(name || 'document').replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80);
        const path = `${uploadFolder(locals.user.user_id)}/${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${safeName}`;

        const { data, error } = await supabaseAdmin.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
        if (error) throw error;

        return json({ path: data.path, token: data.token });
    } catch (error) {
        return apiFailure('prepare the file upload', error);
    }
};
