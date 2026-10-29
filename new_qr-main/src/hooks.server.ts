import { type Handle, redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';
import { rewriteStorageUrls } from '$lib/server/files';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('gateqr_session');

	if (token) {
		try {
			const decoded = jwt.verify(token, env.JWT_SECRET as string) as {
				email: string;
				role: string;
				department_id: number | null;
				user_id: number;
				user_type: string;
			};
			event.locals.user = decoded;
		} catch (err) {
			// Invalid token
			event.locals.user = null;
			event.cookies.delete('gateqr_session', { path: '/' });
		}
	} else {
		event.locals.user = null;
	}

	const url = event.url.pathname;

	// Protect OSA routes (OSA only)
	if (url.startsWith('/osa')) {
		if (!event.locals.user || event.locals.user.role !== 'osa') {
			throw redirect(303, '/login');
		}
	}

	// Protect Security routes (Security only)
	if (url.startsWith('/security')) {
		if (!event.locals.user || event.locals.user.role !== 'security') {
			throw redirect(303, '/login');
		}
	}

	// Protect Dean and Administrative routes
	if (url.startsWith('/dean') || url.startsWith('/administrative')) {
		if (!event.locals.user || (event.locals.user.role !== 'dean' && event.locals.user.role !== 'administrative')) {
			throw redirect(303, '/login');
		}
	}

	// Protect Monitor routes (Security only)
	if (url.startsWith('/monitor')) {
		if (!event.locals.user || event.locals.user.role !== 'security') {
			throw redirect(303, '/login');
		}
	}

	// Example: protect application status page for any logged in user
	if (url.startsWith('/status') && !event.locals.user) {
		throw redirect(303, '/login');
	}

	// Uploaded files are private: point every storage link the browser receives at /files/
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => rewriteStorageUrls(html)
	});

	const type = response.headers.get('content-type') || '';
	if (type.includes('json') && !url.startsWith('/files/')) {
		const body = await response.text();
		const rewritten = rewriteStorageUrls(body);
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		return new Response(rewritten, { status: response.status, statusText: response.statusText, headers });
	}

	return response;
};

export const handleError = ({ error, event }: any) => {
	console.error('[SERVER ERROR at ' + event.url.pathname + ']:', error);
	return {
		message: error?.message || 'Internal Error',
		stack: error?.stack
	};
};
