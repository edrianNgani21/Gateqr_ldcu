import type { RequestHandler } from './$types';
import { generateStyledQRBuffer } from '$lib/server/qr';
import QRCode from 'qrcode';

export const GET: RequestHandler = async ({ url }) => {
    const code = url.searchParams.get('code') || url.searchParams.get('text') || 'PENDING';
    const role = url.searchParams.get('role') || 'student';
    // Registration number printed below the QR (digits only)
    const label = (url.searchParams.get('label') || '').replace(/\D/g, '') || null;

    try {
        const buffer = await generateStyledQRBuffer(code, role, label);
        return new Response(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400, s-maxage=86400'
            }
        });
    } catch (styledErr) {
        console.warn('[QR API] Styled generation fallback to standard QR:', styledErr);
        try {
            const fallbackBuffer = await QRCode.toBuffer(code, {
                width: 320,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            return new Response(new Uint8Array(fallbackBuffer), {
                status: 200,
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=86400'
                }
            });
        } catch (fallbackErr) {
            console.error('[QR API] Failed to generate QR code:', fallbackErr);
            return new Response('Failed to generate QR code', { status: 500 });
        }
    }
};
