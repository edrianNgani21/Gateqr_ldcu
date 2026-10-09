import { createCanvas, loadImage } from '@napi-rs/canvas';
import QRCode from 'qrcode';
import { join } from 'path';
import fs from 'fs';

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

    // 2. Determine border color based on role
    const normalizedRole = (role || 'student').toLowerCase();
    let borderColor = '#16a34a'; // default green (Student)
    if (normalizedRole === 'employee' || normalizedRole === 'staff') {
        borderColor = '#ffffff'; // White
    } else if (normalizedRole === 'visitor') {
        borderColor = '#2563eb'; // Blue
    } else if (normalizedRole === 'concessionaire') {
        borderColor = '#eab308'; // Yellow
    } else if (normalizedRole === 'guest') {
        borderColor = '#6b7280'; // Gray
    }

    // Fill background with border color
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, totalSize, totalSize);

    // If white border, draw a subtle dark border around outer edge for visibility on white bg
    if (borderColor === '#ffffff') {
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, totalSize - 4, totalSize - 4);
    }

    // 3. Draw QR image inside the border
    const qrImage = await loadImage(qrDataUrl);
    ctx.drawImage(qrImage, borderPadding, borderPadding, qrSize, qrSize);

    // 4. Overlay Liceo logo in center with high-contrast badge background
    const logoPath = join(process.cwd(), 'static', 'liceo-logo.png');
    if (fs.existsSync(logoPath)) {
        const logo = await loadImage(logoPath);
        const logoDrawSize = 92;
        const centerX = totalSize / 2;
        const centerY = totalSize / 2;
        const bgPadding = 8;
        const bgSize = logoDrawSize + bgPadding * 2;
        const bgX = centerX - bgSize / 2;
        const bgY = centerY - bgSize / 2;
        const radius = 14;

        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(bgX, bgY, bgSize, bgSize, radius);
        } else {
            ctx.rect(bgX, bgY, bgSize, bgSize);
        }
        ctx.fill();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.drawImage(
            logo,
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
