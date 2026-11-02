// Browser side of error messages: what failed and why, even when the server sends no JSON.

const STATUS_CAUSES: Record<number, string> = {
    400: 'The request was not accepted. Please check what you entered and try again.',
    401: 'Your session has expired. Please sign in and try again.',
    403: 'Your account does not have permission to do this.',
    404: 'The record could not be found. It may have been changed or deleted. Please refresh the page.',
    408: 'The server took too long to respond. Please try again.',
    409: 'The record was changed by someone else. Please refresh the page and try again.',
    413: 'The data sent is too large for the server to accept.',
    429: 'Too many requests were sent. Please wait a moment and try again.',
    500: 'The server ran into a problem and did not report the cause. Please try again.',
    502: 'The server is temporarily unavailable. Please try again in a moment.',
    503: 'The server is temporarily unavailable. Please try again in a moment.',
    504: 'The server took too long to respond. Please try again in a moment.'
};

/** The message for a failed response: the server's own explanation, or one based on the status code. */
export async function readApiError(res: Response, action: string): Promise<string> {
    const body = await res.clone().json().catch(() => null);
    if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    const cause = STATUS_CAUSES[res.status] ?? `The server answered with status ${res.status}.`;
    return `Could not ${action}. ${cause}`;
}

/** The message for a request that never got an answer. */
export function networkErrorMessage(action: string): string {
    return `Could not ${action}. The GateQR server could not be reached. Please check your internet connection and try again.`;
}
