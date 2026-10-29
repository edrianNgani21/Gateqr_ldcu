import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import fs from 'fs';
// Bundled into the server code: on Vercel the static/ folder is served by the CDN and is not on the function's disk
import logoDataUrl from './liceo-logo.png?inline';
// Serverless hosts have no system fonts, so the Reg. No. font ships with the code too (Roboto, Apache 2.0)
import labelFontDataUrl from './Roboto-Bold.ttf?inline';

const LABEL_FONT = 'GateQR Label';
let labelFontReady = false;
function ensureLabelFont() {
    if (labelFontReady) return;
    GlobalFonts.register(Buffer.from(labelFontDataUrl.split(',')[1], 'base64'), LABEL_FONT);
    labelFontReady = true;
}

// Cache for the cleaned logo with transparent outer background
let cachedCleanLogoCanvas: any = null;

async function getCleanLogoCanvas(): Promise<any | null> {
    if (cachedCleanLogoCanvas) return cachedCleanLogoCanvas;

    try {
        const rawLogo = await loadImage(Buffer.from(logoDataUrl.split(',')[1], 'base64'));
        const w = rawLogo.width;
        const h = rawLogo.height;
        const logoCanvas = createCanvas(w, h);
        const lCtx = logoCanvas.getContext('2d');
        lCtx.drawImage(rawLogo, 0, 0);

        try {
            const imgData = lCtx.getImageData(0, 0, w, h);
            const data = imgData.data;

            // Flood fill from corners to make the outer white background transparent
            // so that only the logo itself appears with no background
            const visited = new Uint8Array(w * h);
            const queue: [number, number][] = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
            for (const [qx, qy] of queue) visited[qy * w + qx] = 1;

            while (queue.length > 0) {
                const [x, y] = queue.pop()!;
                const idx = (y * w + x) * 4;
                if (data[idx] > 235 && data[idx + 1] > 235 && data[idx + 2] > 235) {
                    data[idx + 3] = 0;
                    const neighbors: [number, number][] = [
                        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
                    ];
                    for (const [nx, ny] of neighbors) {
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
                            visited[ny * w + nx] = 1;
                            queue.push([nx, ny]);
                        }
                    }
                }
            }

            lCtx.putImageData(imgData, 0, 0);
        } catch (floodErr) {
            console.warn('[QR] Flood fill failed, using raw logo:', floodErr);
        }

        cachedCleanLogoCanvas = logoCanvas;
        return cachedCleanLogoCanvas;
    } catch (err) {
        console.error('[QR] Failed to prepare clean logo:', err);
        return null;
    }
}

/**
 * Render the role-colored QR with the Liceo logo in the center.
 * When `label` is given (the registration_id number), it is printed in a strip below the QR.
 */
export async function generateStyledQRBuffer(qrData: string, role: string = 'student', label?: string | number | null): Promise<Buffer> {
    const qrSize = 400;
    const borderPadding = 20;
    const totalSize = qrSize + borderPadding * 2;
    const labelText = label !== undefined && label !== null && String(label).trim() !== '' ? String(label).replace(/\D/g, '') : '';
    const labelHeight = labelText ? 64 : 0;

    // 1. Generate QR Code image data URL with high error correction (H)
    const qrDataUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: qrSize,
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    });

    const canvas = createCanvas(totalSize, totalSize + labelHeight);
    const ctx = canvas.getContext('2d');

    // 2. Determine border color based on role:
    // - Green for students
    // - Dirty white for faculty and staff
    // - Orange for concessionaire and supplier
    // - Red for Administrators
    // - Gold for Vps
    const normalizedRole = (role || 'student').trim().toLowerCase();
    let borderColor = '#16a34a'; // default Green (Student)
    if (['faculty', 'staff', 'employee'].includes(normalizedRole)) {
        borderColor = '#E5E0D8'; // Dirty white
    } else if (['concessionaire', 'concessionnaire', 'supplier'].includes(normalizedRole)) {
        borderColor = '#f97316'; // Orange
    } else if (['administrator', 'administrators', 'admin', 'osa'].includes(normalizedRole)) {
        borderColor = '#dc2626'; // Red
    } else if (['vps', 'vp', 'vip'].includes(normalizedRole)) {
        borderColor = '#d4af37'; // Gold
    } else if (normalizedRole === 'visitor') {
        borderColor = '#2563eb'; // Blue
    } else if (normalizedRole === 'guest') {
        borderColor = '#6b7280'; // Gray
    }

    // Fill background with border color
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, totalSize, totalSize + labelHeight);

    // If dirty white (or light border), draw a subtle border around outer edge for visibility on white background
    if (borderColor === '#E5E0D8' || borderColor === '#ffffff') {
        ctx.strokeStyle = '#c4beb5';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, totalSize - 2, totalSize + labelHeight - 2);
    }

    // Registration number strip below the QR (digits only)
    if (labelText) {
        const stripX = borderPadding;
        const stripY = totalSize - borderPadding / 2;
        const stripW = qrSize;
        const stripH = labelHeight - borderPadding / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(stripX, stripY, stripW, stripH);
        ctx.fillStyle = '#000000';
        ensureLabelFont();
        ctx.font = `bold 38px "${LABEL_FONT}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, totalSize / 2, stripY + stripH / 2 + 1);
    }

    // 3. Draw QR image inside the border
    const qrImage = await loadImage(qrDataUrl);
    ctx.drawImage(qrImage, borderPadding, borderPadding, qrSize, qrSize);

    // 4. Overlay Liceo logo in center with NO background - only the logo itself
    const cleanLogo = await getCleanLogoCanvas();
    if (cleanLogo) {
        const logoDrawSize = 90;
        const centerX = totalSize / 2;
        const centerY = totalSize / 2;

        ctx.save();
        ctx.drawImage(
            cleanLogo,
            centerX - logoDrawSize / 2,
            centerY - logoDrawSize / 2,
            logoDrawSize,
            logoDrawSize
        );
        ctx.restore();
    }

    return canvas.toBuffer('image/png');
}

export async function generateStyledQR(qrData: string, role: string = 'student', filepath: string, label?: string | number | null): Promise<void> {
    const buffer = await generateStyledQRBuffer(qrData, role, label);
    fs.writeFileSync(filepath, buffer);
}
