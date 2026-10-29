import { writable } from 'svelte/store';

// Centered message/confirm cards that replace the browser's alert() and confirm() popups.
// Rendered once by AppDialog.svelte in the root layout.

export type DialogTone = 'error' | 'success' | 'info' | 'warning';

export interface DialogState {
    kind: 'alert' | 'confirm';
    tone: DialogTone;
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    cancelLabel: string;
    resolve: (ok: boolean) => void;
}

export const dialogState = writable<DialogState | null>(null);

const queue: DialogState[] = [];

function open(state: DialogState) {
    let current: DialogState | null = null;
    dialogState.subscribe((v) => (current = v))();
    if (current) queue.push(state);
    else dialogState.set(state);
}

/** Called by AppDialog when the user closes the card. */
export function closeDialog(ok: boolean) {
    let current: DialogState | null = null;
    dialogState.subscribe((v) => (current = v))();
    (current as DialogState | null)?.resolve(ok);
    dialogState.set(queue.shift() ?? null);
}

const ERROR_WORDS = /(error|fail|invalid|cannot|can't|unable|not found|denied|unauthori[sz]ed|required|please|must|missing|exceed|duplicate|not allowed|network)/i;
const SUCCESS_WORDS = /(success|submitted|saved|updated|approved|accepted|released|restored|sent|created|deleted|removed|recorded)/i;

/**
 * Turn a raw server/browser error into a sentence an applicant or admin can act on.
 * Returns the message plus an optional explanation of what probably went wrong.
 */
export function explainError(raw: unknown): { message: string; detail?: string } {
    const text = (raw instanceof Error ? raw.message : String(raw ?? '')).trim();
    const bare = text.replace(/^error[^:]*:\s*/i, '').trim();

    if (!bare || bare === '<none>' || bare === 'undefined' || bare === 'null' || bare === '[object Object]' || /internal server error/i.test(bare)) {
        return {
            message: 'Something went wrong on our side and the server did not say why.',
            detail: 'This is usually a temporary problem while uploading files or saving to the database, not a mistake in what you entered. Please wait a moment and try again. If it keeps happening, contact the Office of Student Affairs.'
        };
    }
    if (/network|failed to fetch|load failed/i.test(bare)) {
        return {
            message: 'Could not reach the GateQR server.',
            detail: 'Check your internet connection, then try again.'
        };
    }
    if (/storage|upload/i.test(bare)) {
        return {
            message: bare,
            detail: 'One of your files could not be uploaded. Please try again; if it keeps failing, re-export the file as a PDF under 10MB.'
        };
    }
    return { message: bare };
}

/** Drop-in replacement for alert(): tone and title are chosen from the message. */
export function showAlert(raw: unknown, options: { title?: string; tone?: DialogTone } = {}): Promise<void> {
    const text = String(raw ?? '');
    const tone: DialogTone = options.tone ?? (ERROR_WORDS.test(text) || !text.trim() ? 'error' : SUCCESS_WORDS.test(text) ? 'success' : 'info');
    const { message, detail } = tone === 'error' ? explainError(text) : { message: text, detail: undefined };
    const title = options.title ?? (tone === 'error' ? 'Something went wrong' : tone === 'success' ? 'Done' : 'Notice');
    return new Promise((resolve) =>
        open({ kind: 'alert', tone, title, message, detail, confirmLabel: 'OK', cancelLabel: '', resolve: () => resolve() })
    );
}

export function showError(raw: unknown, title = 'Something went wrong'): Promise<void> {
    return showAlert(raw, { title, tone: 'error' });
}

/** Drop-in replacement for confirm(): resolves true when the user confirms. */
export function askConfirm(
    message: string,
    options: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
    const danger = options.danger ?? /(delete|revoke|remove|deactivate|reject|permanent)/i.test(message);
    return new Promise((resolve) =>
        open({
            kind: 'confirm',
            tone: danger ? 'warning' : 'info',
            title: options.title ?? 'Please confirm',
            message,
            confirmLabel: options.confirmLabel ?? (danger ? 'Yes, continue' : 'Confirm'),
            cancelLabel: options.cancelLabel ?? 'Cancel',
            resolve
        })
    );
}
