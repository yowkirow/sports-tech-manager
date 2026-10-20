// LBC booking helpers (owner request 2026-10-20). The owner books each parcel on LBC with the
// receiver's details, then pastes the tracking number on the order for the print staff's label.

const text = value => (typeof value === 'string' ? value.trim() : '');
const pick = (...values) => values.map(text).find(Boolean) || '';
const digits = value => String(value ?? '').replace(/\D/g, '');

// Receiver details from an order's first line, covering current and legacy field names.
export function lbcReceiver(order) {
    const details = order?.items?.[0]?.details || {};
    const shipping = details.shippingDetails || {};
    return {
        name: pick(details.customerName, order?.customerName),
        mobile: pick(shipping.contactNumber, details.customerContact, details.contactNumber),
        street: pick(shipping.address, details.customerAddress),
        barangay: pick(shipping.barangay, details.customerBarangay),
        city: pick(shipping.city, details.customerCity),
        province: pick(shipping.province, details.customerProvince)
    };
}

// LBC's mobile field already shows +63, so it takes the ten digits starting with 9.
export function mobileForLbc(value) {
    let clean = digits(value);
    if (clean.startsWith('639')) clean = clean.slice(2);
    else if (clean.startsWith('09')) clean = clean.slice(1);
    return clean;
}

// "09171234567" for notes and messages; anything unrecognised is kept as typed.
export function localMobile(value) {
    const ten = mobileForLbc(value);
    return /^9\d{9}$/.test(ten) ? `0${ten}` : text(value);
}

export const receiverAddress = receiver => [receiver.street, receiver.barangay, receiver.city, receiver.province].filter(Boolean).join(', ');

// One block with everything needed to book the parcel. Empty fields are left out.
export function lbcCopyText(receiver) {
    return [
        receiver.name && `Name: ${receiver.name}`,
        receiver.mobile && `Mobile: ${localMobile(receiver.mobile)}`,
        receiverAddress(receiver) && `Address: ${receiverAddress(receiver)}`
    ].filter(Boolean).join('\n');
}

// Pasted values become a clean code: an LBC tracking link becomes its tracking number, and
// tabs or line breaks become single spaces. Other text is kept so the owner can still save it.
export function normalizeTracking(value) {
    const raw = String(value ?? '').trim();
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            const code = url.searchParams.get('tracking_no') || url.searchParams.get('trackingNo') || url.searchParams.get('tn');
            if (code && /lbcexpress\.com$/i.test(url.hostname)) return code.replace(/\s+/g, ' ').trim();
        } catch { /* Not a URL after all; keep the text. */ }
        return raw;
    }
    return raw.replace(/\s+/g, ' ');
}

// Mirrors migration 0012: print staff see only a plain code of 4-40 letters, digits, spaces
// or dashes. Anything else (links, notes, contacts) stays owner-only.
export function plainTrackingCode(value) {
    if (typeof value !== 'string') return null;
    const code = value.replace(/^ +| +$/g, '');
    return /^[A-Za-z0-9 -]{4,40}$/.test(code) ? code : null;
}

// Saving a tracking number never changes the order status: parcels are booked before printing
// and packing finish. The owner marks the order Shipped when the parcel is handed to LBC.
export const withTrackingNumber = (details, trackingNumber) => ({ ...details, trackingNumber });
