import { supabaseAdmin } from './supabase';
import { FILES_BUCKET } from './files';
import { fileSizeError } from '$lib/limits';

/** The storage folder a user's own direct uploads go into. */
export function uploadFolder(userId: number): string {
    return `uploads/${userId}`;
}

/** Thrown when an uploaded file fails its checks; the message is safe to show the user. */
export class UploadRejected extends Error {}

/**
 * Confirm a file uploaded from the browser belongs to this user and meets the limits,
 * then return its storage URL for saving on the record.
 */
export async function acceptUploadedFile(
    path: string,
    userId: number,
    label: string,
    allowedTypes: string[]
): Promise<string> {
    const folder = uploadFolder(userId);
    const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : '';
    if (!name || name.includes('/') || name.includes('..')) {
        throw new UploadRejected(`The ${label} upload is not valid. Please choose the file and try again.`);
    }

    const { data, error } = await supabaseAdmin.storage.from(FILES_BUCKET).list(folder, { search: name, limit: 5 });
    if (error) throw error;

    const stored = data?.find((item) => item.name === name);
    if (!stored) {
        throw new UploadRejected(`Your ${label} did not finish uploading. Please choose the file and try again.`);
    }

    const size = Number(stored.metadata?.size ?? 0);
    const type = String(stored.metadata?.mimetype ?? '');
    let problem: string | null = fileSizeError(label, size);
    if (!problem && !allowedTypes.includes(type)) {
        problem = `Your ${label} is not an accepted file type. Please upload it again in an accepted format.`;
    }
    if (problem) {
        await supabaseAdmin.storage.from(FILES_BUCKET).remove([path]);
        throw new UploadRejected(problem);
    }

    return supabaseAdmin.storage.from(FILES_BUCKET).getPublicUrl(path).data.publicUrl;
}
