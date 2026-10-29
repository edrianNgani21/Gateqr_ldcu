import { supabaseAdmin } from './supabase';

const DEFAULT_BUCKET = 'gateqr-uploads';

/**
 * Uploads a file buffer/blob to Supabase Storage and returns its public URL.
 * 
 * @param path - Destination path/filename inside the bucket (e.g. 'documents/or-123.pdf', 'gate/in_123.jpg')
 * @param fileData - File content as Buffer, Uint8Array, or ArrayBuffer
 * @param contentType - MIME type (e.g. 'application/pdf', 'image/jpeg', 'image/png')
 * @param bucket - Bucket name (defaults to 'gateqr-uploads')
 * @returns The public URL of the uploaded file
 */
export async function uploadToStorage(
    path: string,
    fileData: Buffer | Uint8Array | ArrayBuffer,
    contentType?: string,
    bucket: string = DEFAULT_BUCKET
): Promise<string> {
    try {
        const cleanPath = path.replace(/^\/+/, '');
        const options: any = {
            upsert: true
        };
        if (contentType) {
            options.contentType = contentType;
        }

        // Supabase Storage occasionally answers 5xx (e.g. 520) with no message; retry those a few times
        const maxAttempts = 3;
        for (let attempt = 1; ; attempt++) {
            const { error } = await supabaseAdmin.storage
                .from(bucket)
                .upload(cleanPath, fileData, options);

            if (!error) break;

            const status = Number((error as any).statusCode ?? (error as any).status ?? 0);
            const retryable = !status || status >= 500 || status === 408 || status === 429;
            console.error(`[Storage] Upload error for ${cleanPath} (attempt ${attempt}/${maxAttempts}, status ${status || 'unknown'}):`, error);
            if (!retryable || attempt >= maxAttempts) {
                const reason = error.message && error.message !== '<none>' ? error.message : `storage service returned ${status || 'an unknown error'}`;
                throw new Error(`File upload failed: ${reason}. Please try again.`);
            }
            await new Promise((r) => setTimeout(r, 600 * attempt));
        }

        const { data: publicData } = supabaseAdmin.storage
            .from(bucket)
            .getPublicUrl(cleanPath);

        return publicData.publicUrl;
    } catch (err) {
        console.error(`[Storage] Failed to upload to Supabase storage (${path}):`, err);
        throw err;
    }
}

/**
 * Deletes a file from Supabase Storage by its public URL or relative path.
 * 
 * @param urlOrPath - The full public URL or relative path of the file
 * @param bucket - Bucket name (defaults to 'gateqr-uploads')
 */
export async function deleteFromStorage(
    urlOrPath: string,
    bucket: string = DEFAULT_BUCKET
): Promise<void> {
    try {
        if (!urlOrPath) return;

        let cleanPath = urlOrPath;
        if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
            const bucketMarker = `/${bucket}/`;
            const idx = urlOrPath.indexOf(bucketMarker);
            if (idx !== -1) {
                cleanPath = urlOrPath.substring(idx + bucketMarker.length);
            }
        }
        cleanPath = cleanPath.replace(/^\/+/, '');

        await supabaseAdmin.storage
            .from(bucket)
            .remove([cleanPath]);
    } catch (err) {
        console.error(`[Storage] Failed to delete file from storage (${urlOrPath}):`, err);
    }
}
