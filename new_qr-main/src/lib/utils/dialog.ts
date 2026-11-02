import { writable } from 'svelte/store';

// Centered message/confirm cards that replace the browser's alert() and confirm() popups.
// Rendered once by AppDialog.svelte in the root layout.

export type DialogTone = 'error' | 'success' | 'info' | 'warning';

export interface DialogState {
    kind: 'alert' | 'confirm' | 'prompt';
    tone: DialogTone;
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    cancelLabel: string;
    /** prompt only: the text box shown under the message (a non-empty answer is required) */
    inputLabel?: string;
    inputPlaceholder?: string;
    resolve: (ok: boolean, value?: string) => void;
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
export function closeDialog(ok: boolean, value?: string) {
    let current: DialogState | null = null;
    dialogState.subscribe((v) => (current = v))();
    (current as DialogState | null)?.resolve(ok, value);
    dialogState.set(queue.shift() ?? null);
}

const ERROR_WORDS = /(error|fail|invalid|cannot|can't|could not|unable|maximum|not found|denied|unauthori[sz]ed|required|please|must|missing|exceed|duplicate|not allowed|network)/i;
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
            message: 'The action failed, and the server did not report a specific cause.',
            detail: 'What you entered was not rejected. Please wait a moment and try again. If it keeps happening, contact the Office of Student Affairs.'
        };
    }
    if (/network|failed to fetch|load failed/i.test(bare)) {
        return {
            message: 'Could not reach the GateQR server.',
            detail: 'Check your internet connection, then try again.'
        };
    }
    if (/unexpected token|json/i.test(bare)) {
        return {
            message: 'The server sent a response that could not be read.',
            detail: 'The action may not have been completed. Please refresh the page to check, then try again if needed.'
        };
    }
    return { message: bare };
}

/** Drop-in replacement for alert(): tone and title are chosen from the message. */
export function showAlert(raw: unknown, options: { title?: string; tone?: DialogTone } = {}): Promise<void> {
    const text = String(raw ?? '');
    const tone: DialogTone = options.tone ?? (ERROR_WORDS.test(text) || !text.trim() ? 'error' : SUCCESS_WORDS.test(text) ? 'success' : 'info');
    const { message, detail } = tone === 'error' ? explainError(text) : { message: text, detail: undefined };
    const title = options.title ?? (tone === 'error' ? 'Action not completed' : tone === 'success' ? 'Done' : 'Notice');
    return new Promise((resolve) =>
        open({ kind: 'alert', tone, title, message, detail, confirmLabel: 'OK', cancelLabel: '', resolve: () => resolve() })
    );
}

export function showError(raw: unknown, title = 'Action not completed'): Promise<void> {
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

/** Ask for a required reason; resolves the trimmed text, or null when cancelled. */
export function askReason(
    message: string,
    options: { title?: string; confirmLabel?: string; inputLabel?: string; placeholder?: string } = {}
): Promise<string | null> {
    return new Promise((resolve) =>
        open({
            kind: 'prompt',
            tone: 'warning',
            title: options.title ?? 'Reason required',
            message,
            confirmLabel: options.confirmLabel ?? 'Continue',
            cancelLabel: 'Cancel',
            inputLabel: options.inputLabel ?? 'Reason',
            inputPlaceholder: options.placeholder ?? 'Type the reason...',
            resolve: (ok, value) => resolve(ok && value?.trim() ? value.trim() : null)
        })
    );
}
