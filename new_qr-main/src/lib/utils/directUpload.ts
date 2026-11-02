import { supabaseClient } from '$lib/supabaseClient';
import { fileSizeError } from '$lib/limits';
import { readApiError, networkErrorMessage } from './apiErrors';

const BUCKET = 'gateqr-uploads';

// A file that already reached storage is not sent again if the form is resubmitted after an error
const uploadedPaths = new WeakMap<File, string>();

/**
 * Upload a document straight from the browser to Supabase Storage, which avoids Vercel's
 * ~4.5 MB request limit. The server issues a one-time link for each file and checks the
 * stored file again when the form is submitted. Returns the path to send with the form.
 */
export async function uploadDirect(file: File, label: string): Promise<string> {
    const known = uploadedPaths.get(file);
    if (known) return known;

    const sizeError = fileSizeError(label, file.size);
    if (sizeError) throw new Error(sizeError);

    // Some systems give a PDF no type
    const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');

    let res: Response;
    try {
        res = await fetch('/api/uploads/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, type, size: file.size, label })
        });
    } catch {
        throw new Error(networkErrorMessage(`upload your ${label}`));
    }
    if (!res.ok) throw new Error(await readApiError(res, `upload your ${label}`));
    const { path, token } = await res.json();

    let uploadError: { message: string } | null = null;
    try {
        ({ error: uploadError } = await supabaseClient.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: type }));
    } catch {
        throw new Error(networkErrorMessage(`upload your ${label}`));
    }
    if (uploadError) {
        const cause = /exceeded|too large|maximum/i.test(uploadError.message) ? fileSizeError(label, file.size) || uploadError.message : uploadError.message;
        throw new Error(`Could not upload your ${label}. ${cause}`);
    }

    uploadedPaths.set(file, path);
    return path;
}
