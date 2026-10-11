import { type Handle, redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

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

	// Protect Dean routes (Dean only)
	if (url.startsWith('/dean')) {
		if (!event.locals.user || event.locals.user.role !== 'dean') {
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

	return await resolve(event);
};

export const handleError = ({ error, event }: any) => {
	console.error('[SERVER ERROR at ' + event.url.pathname + ']:', error);
	return {
		message: error?.message || 'Internal Error',
		stack: error?.stack
	};
};
