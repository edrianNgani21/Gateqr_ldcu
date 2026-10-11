import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import bcrypt from 'bcryptjs';

export const GET: RequestHandler = async ({ locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('user_id, email, user_type, identification, created_at, is_active, security_pin_hash')
            .eq('user_id', locals.user.user_id)
            .single();

        if (error || !user) {
            return json({ error: 'User not found' }, { status: 404 });
        }

        return json({
            email: user.email,
            user_type: user.user_type,
            identification: user.identification,
            created_at: user.created_at,
            is_active: user.is_active,
            has_pin: Boolean(user.security_pin_hash)
        });
    } catch (error) {
        console.error('[Settings GET error]:', error);
        return json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { action } = body;

        // Fetch current user record
        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('user_id, email, security_pin_hash')
            .eq('user_id', locals.user.user_id)
            .single();

        if (fetchError || !user) {
            return json({ error: 'User account not found' }, { status: 404 });
        }

        if (action === 'set_pin') {
            const { pin, current_pin } = body;

            if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
                return json({ error: 'PIN must be exactly 4 digits (e.g. 1234)' }, { status: 400 });
            }

            // If user already has a PIN, verify current PIN before allowing change
            if (user.security_pin_hash) {
                if (!current_pin || typeof current_pin !== 'string' || !bcrypt.compareSync(current_pin, user.security_pin_hash)) {
                    return json({ error: 'Current 4-digit PIN is incorrect' }, { status: 400 });
                }
            }

            const pinHash = bcrypt.hashSync(pin, 10);

            const { error: updateError } = await supabase
                .from('users')
                .update({ security_pin_hash: pinHash })
                .eq('user_id', user.user_id);

            if (updateError) throw updateError;

            return json({ message: user.security_pin_hash ? '4-Digit PIN updated successfully' : '4-Digit PIN created successfully' });
        }

        if (action === 'change_password') {
            const { pin, new_password } = body;

            if (!new_password || typeof new_password !== 'string' || new_password.trim().length < 6) {
                return json({ error: 'New password must be at least 6 characters long' }, { status: 400 });
            }

            // If user has a 4-digit PIN set up, require PIN confirmation
            if (user.security_pin_hash) {
                if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
                    return json({ error: 'Please enter your 4-digit security PIN' }, { status: 400 });
                }

                if (!bcrypt.compareSync(pin, user.security_pin_hash)) {
                    return json({ error: 'Incorrect 4-digit security PIN' }, { status: 400 });
                }
            } else {
                return json({
                    error: 'Please set your 4-digit security PIN first before changing your password'
                }, { status: 400 });
            }

            const newPasswordHash = bcrypt.hashSync(new_password.trim(), 10);

            const { error: updateError } = await supabase
                .from('users')
                .update({ password_hash: newPasswordHash })
                .eq('user_id', user.user_id);

            if (updateError) throw updateError;

            console.log(`[Settings] Password successfully changed for ${user.email}`);
            return json({ success: true, message: 'Password updated successfully' });
        }

        if (action === 'verify_pin') {
            const { pin } = body;
            if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
                return json({ error: 'Please enter a valid 4-digit PIN' }, { status: 400 });
            }
            if (!user.security_pin_hash) {
                return json({ error: 'No 4-digit security PIN has been set yet' }, { status: 400 });
            }
            if (!bcrypt.compareSync(pin, user.security_pin_hash)) {
                return json({ error: 'Incorrect 4-digit security PIN' }, { status: 400 });
            }
            return json({ success: true, message: 'PIN verified successfully' });
        }

        return json({ error: 'Invalid action specified' }, { status: 400 });
    } catch (error) {
        console.error('[Settings POST error]:', error);
        return json({ error: 'Failed to process security request' }, { status: 500 });
    }
};
