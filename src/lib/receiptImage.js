// Payout receipts (owner request 2026-11-03) are photos or screenshots of a GCash or bank transfer.
// Phone photos are scaled down (longest side 2000 px, JPEG) before upload so they stay well under
// the Worker's 5 MB limit and open quickly on the print staff's phone. Small screenshots are sent
// as they are, so their text stays sharp.
const MAX_SIDE = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_BYTES = 1.5 * 1024 * 1024;
const READABLE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function prepareReceiptImage(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose a photo or screenshot of the receipt.');
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        if (READABLE.includes(file.type) && file.size <= MAX_BYTES) return file;
        throw new Error('This image can’t be read here. Choose a JPEG or PNG photo or screenshot of the receipt.');
    }
    try {
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size <= KEEP_BYTES && READABLE.includes(file.type)) return file;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        // JPEG has no transparency; a transparent screenshot would otherwise turn black.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (!blob) throw new Error('The receipt image could not be prepared. Try a screenshot instead.');
        if (blob.size > MAX_BYTES) throw new Error('This receipt image is too large. Try a screenshot instead.');
        return blob;
    } finally {
        bitmap.close?.();
    }
}
