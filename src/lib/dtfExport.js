// Print files for DTF sheets (owner request 2026-11-09): one transparent PNG per sheet at 300 DPI.
//
// A sheet is drawn in horizontal strips. Each strip is a single SVG built from the designs placed on
// it, at exact print pixels, drawn to a small canvas and streamed into the PNG (src/lib/pngStream.js).
// Memory stays small enough for a phone, and every edge is drawn from the vector design at full size.
// Cut lines and rulers only appear on screen, never in the file.

import { createPngWriter } from './pngStream.js';
import { SVG_NS, XLINK_NS, designParts, loadImage, svgUrl } from './svgDesign.js';

export const PRINT_DPI = 300;
const STRIP_PX = 512;

const inches = value => String(Math.round(value * 100) / 100);

/** dtf-2026-11-09-sheet-1-of-2-22x39in.png */
export function sheetFileName({ date = new Date(), index, count, widthIn, lengthIn }) {
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    return `dtf-${day}-sheet-${index + 1}-of-${count}-${inches(widthIn)}x${inches(lengthIn)}in.png`;
}

/** The sheet's pixel size and each placement in whole pixels. */
export function sheetPixels(sheet, settings, dpi = PRINT_DPI) {
    const px = value => Math.round(value * dpi);
    return {
        width: px(settings.widthIn),
        height: px(settings.lengthIn),
        placements: sheet.placements.map(item => ({
            designId: item.designId, x: px(item.x), y: px(item.y), width: px(item.widthIn), height: px(item.heightIn)
        }))
    };
}

/**
 * One strip of the sheet as an SVG: rows `top` to `top + height` of a sheet `width` pixels wide, holding
 * the placements that reach into it. parts maps a design to its viewBox and inner markup.
 */
export function stripSvg({ width, top, height, placements, parts }) {
    const visible = placements.filter(item => item.y < top + height && item.y + item.height > top);
    const body = visible.map(item => {
        const part = parts.get(item.designId);
        if (!part) throw new Error('A design on this sheet is missing. Reload and try again.');
        return `<svg x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" viewBox="${part.viewBox.join(' ')}" `
            + `preserveAspectRatio="xMidYMid meet">${part.inner}</svg>`;
    }).join('');
    return {
        count: visible.length,
        svg: `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${width}" height="${height}" viewBox="0 ${top} ${width} ${height}">${body}</svg>`
    };
}

/**
 * Renders one sheet of a layout to a PNG Blob. designs maps a design ID to its stored SVG text.
 * onProgress receives 0 to 1; signal can cancel.
 */
export async function renderSheetPng({ sheet, settings, designs, dpi = PRINT_DPI, onProgress, signal }) {
    const pixels = sheetPixels(sheet, settings, dpi);
    const parts = new Map();
    for (const id of new Set(pixels.placements.map(item => item.designId))) {
        const svg = designs.get(id);
        if (!svg) throw new Error('A design on this sheet is missing. Reload and try again.');
        parts.set(id, designParts(svg));
    }
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = STRIP_PX;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser can\'t draw the sheet.');
    const blank = new Uint8ClampedArray(pixels.width * 4 * STRIP_PX);
    const png = createPngWriter({ width: pixels.width, height: pixels.height, dpi });
    try {
        for (let top = 0; top < pixels.height; top += STRIP_PX) {
            signal?.throwIfAborted();
            const rows = Math.min(STRIP_PX, pixels.height - top);
            const strip = stripSvg({ width: pixels.width, top, height: rows, placements: pixels.placements, parts });
            if (!strip.count) {
                await png.writeRows(blank.subarray(0, pixels.width * 4 * rows), rows);
            } else {
                const url = svgUrl(strip.svg);
                try {
                    const image = await loadImage(url);
                    context.clearRect(0, 0, pixels.width, STRIP_PX);
                    context.drawImage(image, 0, 0, pixels.width, rows);
                } finally {
                    URL.revokeObjectURL(url);
                }
                await png.writeRows(context.getImageData(0, 0, pixels.width, rows).data, rows);
            }
            onProgress?.((top + rows) / pixels.height);
        }
        return await png.finish();
    } catch (error) {
        png.abort(error);
        throw error;
    }
}

/** Saves a Blob as a download. */
export function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
