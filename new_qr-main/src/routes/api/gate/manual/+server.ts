import { apiFailure } from '$lib/server/apiError';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { env } from '$env/dynamic/private';
import { uploadToStorage } from '$lib/server/storage';
import crypto from 'crypto';

function checkAuth(request: Request): boolean {
    return request.headers.get('X-Gate-Key') === env.PRIVATE_GATE_API_KEY;
}

function generateTicketNo() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `GUEST-${result}`;
}

async function saveImage(pic_base64: string, type: string): Promise<string | null> {
    try {
        const base64Data = pic_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `gate/guest_${type}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
        return await uploadToStorage(filename, buffer, 'image/jpeg');
    } catch (err) {
        console.error('[Gate] Error saving guest image to Supabase Storage:', err);
        return null;
    }
}

export const POST: RequestHandler = async ({ request }) => {
    if (!checkAuth(request)) {
        return json({ error: 'Your account does not have permission to do this.' }, { status: 403 });
    }

    try {
        const { type, ticket_no, name, mobile, make_model, plate, guest_id_number, purpose, reason, pic_base64, presence_status, campus } = await request.json();

        if (!type || (type !== 'in' && type !== 'out')) {
            return json({ error: 'Invalid type (must be in or out)' }, { status: 400 });
        }

        const picUrl = pic_base64 ? await saveImage(pic_base64, type) : null;

        if (type === 'in') {
            if (!make_model || !plate) {
                return json({ error: 'make_model and plate are required for in' }, { status: 400 });
            }

            // Generate unique ticket number
            let newTicketNo = ticket_no;
            if (!newTicketNo) {
                let isUnique = false;
                while (!isUnique) {
                    newTicketNo = generateTicketNo();
                    const { data: rows } = await supabase
                        .from('guestlog')
                        .select('guest_id')
                        .eq('ticket_no', newTicketNo)
                        .maybeSingle();
                    
                    if (!rows) isUnique = true;
                }
            }

            // Insert new IN row — out/pic_out are NULL until they leave
            const { error: insertError } = await supabase
                .from('guestlog')
                .insert({
                    ticket_no: newTicketNo,
                    name: name || null,
                    mobile: mobile || null,
                    make_model,
                    plate,
                    guest_id_number: guest_id_number || null,
                    purpose: purpose || reason || null,
                    reason: reason || null,
                    in: new Date().toISOString(),
                    pic_in: picUrl
                });

            if (insertError) throw insertError;

            // Occupancy is counted live from gate_log (campus_occupancy view)

            return json({ success: true, ticket_no: newTicketNo, message: 'Guest entry recorded' });

        } else {
            // type === 'out'
            if (!ticket_no) {
                return json({ error: 'ticket_no is required for out' }, { status: 400 });
            }

            // Find the most recent open IN record for this ticket (no out yet)
            const { data: rows } = await supabase
                .from('guestlog')
                .select('guest_id')
                .eq('ticket_no', ticket_no)
                .is('out', null)
                .order('in', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (rows) {
                // Update the existing IN row with OUT timestamp and photo
                const { error: updateError } = await supabase
                    .from('guestlog')
                    .update({
                        out: new Date().toISOString(),
                        pic_out: picUrl,
                        logged_status_out: presence_status || null
                    })
                    .eq('guest_id', rows.guest_id);

                if (updateError) throw updateError;

                // Occupancy is counted live from gate_log (campus_occupancy view)
            } else {
                // No open IN found — insert a standalone OUT row
                const { data: inRows } = await supabase
                    .from('guestlog')
                    .select('make_model, plate')
                    .eq('ticket_no', ticket_no)
                    .order('in', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const mm = inRows?.make_model || 'Unknown';
                const pl = inRows?.plate || 'Unknown';

                const { error: insertError } = await supabase
                    .from('guestlog')
                    .insert({
                        ticket_no,
                        name: name || null,
                        mobile: mobile || null,
                        make_model: mm,
                        plate: pl,
                        purpose: purpose || reason || null,
                        reason: reason || null,
                        in: new Date().toISOString(),
                        out: new Date().toISOString(),
                        pic_out: picUrl,
                        logged_status_out: presence_status || null
                    });

                if (insertError) throw insertError;

                // Occupancy is counted live from gate_log (campus_occupancy view)
            }

            return json({ success: true, message: 'Guest exit recorded' });
        }
    } catch (error) {
        console.error('[Gate] Manual entry error:', error);
        return apiFailure('record the manual gate entry', error);
    }
};
