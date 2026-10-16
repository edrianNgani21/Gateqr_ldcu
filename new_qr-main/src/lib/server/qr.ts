import { createCanvas, loadImage } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import { join } from 'path';
import fs from 'fs';

// Cache for the cleaned logo with transparent outer background
let cachedCleanLogoCanvas: any = null;

async function getCleanLogoCanvas(): Promise<any | null> {
    if (cachedCleanLogoCanvas) return cachedCleanLogoCanvas;

    const logoPath = join(process.cwd(), 'static', 'liceo-logo.png');
    if (!fs.existsSync(logoPath)) return null;

    try {
        const rawLogo = await loadImage(logoPath);
        const w = rawLogo.width;
        const h = rawLogo.height;
        const logoCanvas = createCanvas(w, h);
        const lCtx = logoCanvas.getContext('2d');
        lCtx.drawImage(rawLogo, 0, 0);

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
        cachedCleanLogoCanvas = logoCanvas;
        return cachedCleanLogoCanvas;
    } catch (err) {
        console.error('[QR] Failed to prepare clean logo:', err);
        return null;
    }
}

export async function generateStyledQRBuffer(qrData: string, role: string = 'student'): Promise<Buffer> {
    const qrSize = 400;
    const borderPadding = 20;
    const totalSize = qrSize + borderPadding * 2;

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

    const canvas = createCanvas(totalSize, totalSize);
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
    ctx.fillRect(0, 0, totalSize, totalSize);

    // If dirty white (or light border), draw a subtle border around outer edge for visibility on white background
    if (borderColor === '#E5E0D8' || borderColor === '#ffffff') {
        ctx.strokeStyle = '#c4beb5';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, totalSize - 2, totalSize - 2);
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

export async function generateStyledQR(qrData: string, role: string = 'student', filepath: string): Promise<void> {
    const buffer = await generateStyledQRBuffer(qrData, role);
    fs.writeFileSync(filepath, buffer);
}
