import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';
import { crc32, createPngWriter } from '../src/lib/pngStream.js';

function readChunks(bytes) {
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    for (let offset = 8; offset < bytes.length;) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        assert.equal(view.getUint32(offset + 8 + length), zlibCrc32(bytes.subarray(offset + 4, offset + 8 + length)), `${type} CRC`);
        chunks.push({ type, data });
        offset += 12 + length;
    }
    return chunks;
}

test('crc32 matches zlib', () => {
    for (const text of ['', 'IEND', 'The quick brown fox']) {
        const bytes = new TextEncoder().encode(text);
        assert.equal(crc32(bytes), zlibCrc32(bytes));
    }
    assert.equal(crc32(new TextEncoder().encode('IH'), new TextEncoder().encode('DR')), zlibCrc32('IHDR'));
});

test('rows written in strips decode to the same RGBA pixels, with 300 DPI recorded', async () => {
    const width = 3;
    const height = 5;
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 37) % 256);
    const png = createPngWriter({ width, height });
    await png.writeRows(pixels.subarray(0, width * 4 * 2), 2);
    await png.writeRows(new Uint8ClampedArray(pixels.subarray(width * 4 * 2)), 3);
    assert.equal(png.rowsWritten, 5);
    const blob = await png.finish();
    assert.equal(blob.type, 'image/png');
    const chunks = readChunks(new Uint8Array(await blob.arrayBuffer()));
    assert.deepEqual(chunks.map(item => item.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    assert.deepEqual([ihdr.getUint32(0), ihdr.getUint32(4), ...chunks[0].data.subarray(8)], [3, 5, 8, 6, 0, 0, 0]);
    const phys = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset);
    assert.deepEqual([phys.getUint32(0), phys.getUint32(4), chunks[1].data[8]], [11811, 11811, 1], '300 DPI in pixels per meter');
    const raw = inflateSync(Buffer.concat(chunks.filter(item => item.type === 'IDAT').map(item => item.data)));
    assert.equal(raw.length, (width * 4 + 1) * height);
    for (let row = 0; row < height; row++) {
        assert.equal(raw[row * (width * 4 + 1)], 0, 'filter type none');
        assert.deepEqual([...raw.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1))],
            [...pixels.subarray(row * width * 4, (row + 1) * width * 4)]);
    }
});

test('a large transparent sheet stays small, split into several IDAT chunks when needed', async () => {
    const width = 1200;
    const strip = 100;
    const png = createPngWriter({ width, height: strip * 6, dpi: 150 });
    const noise = new Uint8Array(width * 4 * strip);
    let state = 7;
    for (let index = 0; index < noise.length; index++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        noise[index] = state & 255;
    }
    for (let index = 0; index < 6; index++) await png.writeRows(index < 3 ? new Uint8Array(width * 4 * strip) : noise, strip);
    const chunks = readChunks(new Uint8Array(await (await png.finish()).arrayBuffer()));
    const idat = chunks.filter(item => item.type === 'IDAT');
    assert.ok(idat.length >= 2, `${idat.length} IDAT chunks`);
    assert.ok(idat.every(item => item.data.length <= 2 * 1024 * 1024));
    assert.equal(new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset).getUint32(0), 5906, '150 DPI');
    const raw = inflateSync(Buffer.concat(idat.map(item => item.data)));
    assert.equal(raw.length, (width * 4 + 1) * strip * 6);
    assert.ok(raw.subarray(0, (width * 4 + 1) * strip * 3).every(byte => byte === 0), 'transparent rows stay transparent');
});

test('the writer refuses the wrong number of rows or pixels', async () => {
    assert.throws(() => createPngWriter({ width: 0, height: 1 }), RangeError);
    assert.throws(() => createPngWriter({ width: 2.5, height: 1 }), RangeError);
    assert.throws(() => createPngWriter({ width: 2, height: 1, dpi: 0 }), RangeError);
    const png = createPngWriter({ width: 2, height: 2 });
    await assert.rejects(png.writeRows(new Uint8Array(7), 1), RangeError);
    await assert.rejects(png.writeRows(new Uint8Array(24), 3), RangeError);
    await png.writeRows(new Uint8Array(8), 1);
    await assert.rejects(png.finish(), /2 rows; 1 were written/);
    await png.writeRows(new Uint8Array(8), 1);
    await png.finish();
    await assert.rejects(png.finish(), /already finished/);
    await assert.rejects(png.writeRows(new Uint8Array(8), 1), /already finished/);
    const dropped = createPngWriter({ width: 1, height: 1 });
    dropped.abort(new Error('cancelled'));
    await assert.rejects(dropped.writeRows(new Uint8Array(4), 1), /already finished/);
});
