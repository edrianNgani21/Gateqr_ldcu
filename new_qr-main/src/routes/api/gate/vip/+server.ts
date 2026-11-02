import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.GATE_API_KEY;
}

export const POST: RequestHandler = async ({ request }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { action } = await request.json(); // 'in' or 'out'

        if (action !== 'in' && action !== 'out') {
            return json({ error: 'This action is not recognized. Please refresh the page and try again.' }, { status: 400 });
        }

        if (action === 'out') {
            const today = new Date().toISOString().split('T')[0];
            
            const { count: inCount } = await supabase
                .from('vip_log')
                .select('*', { count: 'exact', head: true })
                .eq('type', 'in')
                .gte('timestamp', today)
                .lt('timestamp', new Date(Date.now() + 86400000).toISOString());

            const { count: outCount } = await supabase
                .from('vip_log')
                .select('*', { count: 'exact', head: true })
                .eq('type', 'out')
                .gte('timestamp', today)
                .lt('timestamp', new Date(Date.now() + 86400000).toISOString());
            
            if ((outCount || 0) >= (inCount || 0)) {
                return json({ error: 'Cannot VIP out more than VIP in' }, { status: 400 });
            }
        }

        const { error: insertError } = await supabase
            .from('vip_log')
            .insert({ type: action });

        if (insertError) throw insertError;

        return json({ success: true, message: `VIP ${action} recorded` });
    } catch (error) {
        console.error('[Gate] VIP error:', error);
        return apiFailure('record the VIP access', error);
    }
};
