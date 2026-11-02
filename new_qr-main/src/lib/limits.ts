// Input limits shared by the browser and the server.

export const MAX_REASON_LENGTH = 500;
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export const PDF_TYPES = ['application/pdf'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SIGNED_AGREEMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export function formatFileSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The message shown when a document is over the limit; null when the size is fine. */
export function fileSizeError(label: string, size: number): string | null {
    if (size <= MAX_FILE_BYTES) return null;
    return `Your ${label} is ${formatFileSize(size)}. The maximum size is ${MAX_FILE_MB} MB per file. Please compress the file and upload it again.`;
}

/** The message shown when a reason is over the limit; null when the length is fine. */
export function reasonLengthError(reason: string | null | undefined): string | null {
    const length = (reason || '').trim().length;
    if (length <= MAX_REASON_LENGTH) return null;
    return `The reason is ${length} characters long. The maximum is ${MAX_REASON_LENGTH} characters. Please shorten it and try again.`;
}
