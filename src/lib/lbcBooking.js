// LBC helpers. LBC gives two numbers (owner, 2026-10-20 and 2026-10-21):
// - the BOOKING number, when the owner books the pickup. Print staff write it on the package with
//   the customer's name. Saving it never changes the order status.
// - the TRACKING number, once the parcel ships. It is the customer's: their order page shows it and
//   the tracking text sends it. Print staff never receive it.

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

// Pasted numbers become a clean code: an LBC tracking link becomes its number, and tabs or line
// breaks become single spaces. Other text is kept so the owner can still save it.
export function normalizeLbcNumber(value) {
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

// Mirrors migration 0013 (and 0012 before it): print staff see only a plain code of 4-40
// letters, digits, spaces or dashes. Anything else (links, notes, contacts) stays owner-only.
export function plainLabelCode(value) {
    if (typeof value !== 'string') return null;
    const code = value.replace(/^ +| +$/g, '');
    return /^[A-Za-z0-9 -]{4,40}$/.test(code) ? code : null;
}

// The booking number is saved while printing is still going on, so it never changes the status.
export const withBookingNumber = (details, bookingNumber) => ({ ...details, bookingNumber });

// Orders that can still be booked and shipped. Shipped, returned and cancelled orders only keep
// their numbers for reference.
export const SHIPPABLE_STATUSES = ['pending', 'in_progress', 'ready'];

// Corrects the tracking number of an order that has already shipped; the status stays as it is.
export const withTrackingNumber = (details, trackingNumber) => ({ ...details, trackingNumber });

// LBC's tracking number arrives once the parcel ships, so it is saved together with Shipped.
// Shipping without one (another courier, a pickup) keeps any number already saved.
export const shippedWith = (details, trackingNumber) => ({
    ...details, ...(trackingNumber ? { trackingNumber } : {}), fulfillmentStatus: 'shipped', status: 'shipped'
});

// Where the customer follows the parcel: a saved link as it is, or LBC's tracker for a plain code.
export function parcelTrackingUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (/^https?:\/\/[^\s]+$/i.test(raw)) return raw;
    const code = plainLabelCode(raw);
    return code ? `https://www.lbcexpress.com/track/?tracking_no=${encodeURIComponent(code.replace(/[\s-]+/g, ''))}` : null;
}
