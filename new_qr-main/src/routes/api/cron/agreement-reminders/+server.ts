import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { sendAgreementReminders } from '$lib/server/agreementReminder';

// Called daily by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
export const GET: RequestHandler = async ({ request }) => {
    const secret = env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sent = await sendAgreementReminders();
    return json({ success: true, sent });
};
