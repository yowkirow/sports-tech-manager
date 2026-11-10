// A PNG written a few rows at a time (DTF sheets, owner request 2026-11-09). A 22 x 39 in sheet at
// 300 DPI is 6600 x 11700 px, about 300 MB as raw pixels, far more than a phone lets one canvas
// hold. The sheet is drawn in strips instead, and each strip is compressed as it arrives with the
// browser's own zlib (CompressionStream 'deflate'), so only the compressed file stays in memory.

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const IDAT_BYTES = 1024 * 1024;
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(...parts) {
    let crc = 0xffffffff;
    for (const bytes of parts) {
        for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    const name = Uint8Array.from(type, letter => letter.charCodeAt(0));
    view.setUint32(0, data.length);
    out.set(name, 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(name, data));
    return out;
}

/** Signature, IHDR (8-bit RGBA) and pHYs, which records the print resolution. */
function header(width, height, dpi) {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const phys = new Uint8Array(9);
    const pixelsPerMeter = Math.round(dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, pixelsPerMeter);
    new DataView(phys.buffer).setUint32(4, pixelsPerMeter);
    phys[8] = 1;
    return [SIGNATURE, chunk('IHDR', ihdr), chunk('pHYs', phys)];
}

/** Joins the compressed output into IDAT chunks of about 1 MB. */
function idatChunks(parts) {
    const chunks = [];
    let pending = [];
    let size = 0;
    const flush = () => {
        if (!size) return;
        const data = new Uint8Array(size);
        let offset = 0;
        for (const part of pending) { data.set(part, offset); offset += part.length; }
        chunks.push(chunk('IDAT', data));
        pending = [];
        size = 0;
    };
    for (const part of parts) {
        pending.push(part);
        size += part.length;
        if (size >= IDAT_BYTES) flush();
    }
    flush();
    return chunks;
}

/**
 * Write `height` rows of `width` RGBA pixels, top to bottom, in any number of writeRows calls, then
 * finish() for the PNG as a Blob.
 */
export function createPngWriter({ width, height, dpi = 300 }) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff)) {
        throw new RangeError('A PNG needs a whole number of pixels on each side.');
    }
    if (!(dpi > 0)) throw new RangeError('The print resolution must be positive.');
    const stride = width * 4;
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const compressed = [];
    // Read while writing, or the stream's queue fills and writing stalls.
    const reading = (async () => {
        const reader = stream.readable.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            compressed.push(value);
        }
    })();
    reading.catch(() => {});
    let rows = 0;
    let closed = false;
    return {
        get rowsWritten() { return rows; },
        async writeRows(pixels, count) {
            if (closed) throw new Error('This PNG is already finished.');
            if (!Number.isSafeInteger(count) || count < 1 || pixels?.length !== stride * count) {
                throw new RangeError(`Expected ${count} rows of ${width} RGBA pixels.`);
            }
            if (rows + count > height) throw new RangeError('More rows than the image has.');
            // Each row starts with its filter type; 0 leaves the pixels as they are.
            const filtered = new Uint8Array((stride + 1) * count);
            for (let row = 0; row < count; row++) filtered.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
            rows += count;
            await writer.write(filtered);
        },
        async finish() {
            if (closed) throw new Error('This PNG is already finished.');
            if (rows !== height) throw new Error(`The image has ${height} rows; ${rows} were written.`);
            closed = true;
            await writer.close();
            await reading;
            return new Blob([...header(width, height, dpi), ...idatChunks(compressed), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
        },
        abort(reason) {
            if (closed) return;
            closed = true;
            writer.abort(reason).catch(() => {});
        }
    };
}
