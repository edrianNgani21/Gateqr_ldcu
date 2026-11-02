import { json } from '@sveltejs/kit';

// Database error codes (Postgres and PostgREST) explained in plain language
const CODE_CAUSES: Record<string, string> = {
    '23505': 'A record with the same details already exists.',
    '23503': 'It is linked to a record that is missing or still in use.',
    '23502': 'A required value is missing.',
    '23514': 'One of the values is not allowed by the system rules.',
    '22001': 'One of the values is too long to be saved.',
    '22P02': 'One of the values is in the wrong format.',
    '42P01': 'A database table is missing. A database migration may not have been run.',
    '42703': 'A database column is missing. A database migration may not have been run.',
    'PGRST204': 'A database column is missing. A database migration may not have been run.',
    'PGRST205': 'A database table is missing. A database migration may not have been run.',
    'PGRST116': 'The record could not be found. It may have been changed or deleted.',
    '57014': 'The database took too long to respond.'
};

/** One sentence stating why a server action failed. */
export function describeCause(err: unknown): string {
    const e = err as { code?: string; message?: string; statusCode?: string | number } | null | undefined;
    const known = e?.code ? CODE_CAUSES[String(e.code)] : undefined;
    if (known) return known;

    const message = (e?.message || (typeof err === 'string' ? err : '')).trim();
    if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|socket hang up|network/i.test(message)) {
        return 'The server could not reach the database or file storage. Please try again in a moment.';
    }
    if (!message || message === '<none>' || message === '[object Object]') {
        return 'The server did not report a specific cause. Please try again. If it keeps happening, contact the system administrator.';
    }
    return /[.!?]$/.test(message) ? message.slice(0, 300) : `${message.slice(0, 300)}.`;
}

/** Log a failed action and answer with what failed and why. */
export function apiFailure(action: string, err: unknown, status = 500): Response {
    console.error(`Could not ${action}:`, err);
    return json({ error: `Could not ${action}. ${describeCause(err)}` }, { status });
}
