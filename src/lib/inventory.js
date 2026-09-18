import { getItemCategory, getSaleItems } from './orderItems.js';

const DEFAULT_BRAND = 'Sypik';
const SHIRT_CATEGORIES = new Set(['blanks', 'shirts']);
const EXCLUDED_STOCK_CATEGORIES = new Set(['general', 'ads', 'club', 'system']);

const asString = (value) => {
    if (value === undefined || value === null) return '';
    return String(value);
};

const normalizeWhitespace = (value) => asString(value).trim().replace(/\s+/g, ' ');
const normalizeLower = (value) => normalizeWhitespace(value).toLowerCase();
const normalizeAccessoryKey = (value) => normalizeLower(value).replace(/\s+/g, '-');

const numberOr = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const quantityOr = (value, fallback = 1) => numberOr(value, fallback);
const getDetails = (source) => (source?.details && typeof source.details === 'object' ? source.details : source) || {};
const getCategory = (source, fallbackCategory = '') => normalizeLower(getDetails(source).category || fallbackCategory);

const getShirtDescriptor = (source) => {
    const details = getDetails(source);
    const brand = normalizeWhitespace(details.brand || DEFAULT_BRAND);
    const color = normalizeWhitespace(details.linkedColor || details.color);
    const size = normalizeWhitespace(details.size);

    if (!color || !size) return null;

    return {
        key: `shirt-${normalizeLower(brand)}-${normalizeLower(color)}-${normalizeLower(size)}`,
        name: `${color} Shirt`,
        variant: `${brand} - ${size}`
    };
};

const getAccessoryName = (source) => {
    const details = getDetails(source);
    return normalizeWhitespace(
        details.subCategory
        || details.itemName
        || details.name
        || source?.description
        || details.description
    );
};

const getAccessoryDescriptor = (source) => {
    const name = getAccessoryName(source);
    if (!name) return null;

    return {
        key: `acc-${normalizeAccessoryKey(name)}`,
        name,
        variant: 'N/A'
    };
};

const getInventoryDescriptor = (source, fallbackCategory = '') => {
    const category = getCategory(source, fallbackCategory);
    if (SHIRT_CATEGORIES.has(category)) return getShirtDescriptor(source);
    if (EXCLUDED_STOCK_CATEGORIES.has(category)) return null;
    return getAccessoryDescriptor(source);
};

export const getStockKey = (source, fallbackCategory = '') => (
    getInventoryDescriptor(source, fallbackCategory)?.key || null
);

const forEachMovement = (transactions, addMovement) => {
    for (const transaction of transactions) {
        if (!transaction?.id || !transaction.details) continue;
        if (transaction.type === 'expense' || transaction.type === 'update_stock') {
            const category = getCategory(transaction, transaction.category);
            const details = transaction.details;
            if (details.club || EXCLUDED_STOCK_CATEGORIES.has(category)) continue;
            if (!SHIRT_CATEGORIES.has(category) && !normalizeWhitespace(details.subCategory || details.itemName || details.name)) continue;
            const descriptor = getInventoryDescriptor(transaction, transaction.category);
            if (descriptor) addMovement(descriptor.key, descriptor, transaction.id, quantityOr(details.quantity));
            continue;
        }
        if (transaction.type !== 'sale') continue;
        for (const item of getSaleItems(transaction)) {
            if (item.details?.removedFromOrder) continue;
            const descriptor = getInventoryDescriptor(item, item.category);
            if (descriptor) addMovement(descriptor.key, descriptor, item.transactionId || transaction.id, -quantityOr(item.details?.quantity));
        }
    }
};

export const getStockCounts = (transactions = []) => {
    const counts = Object.create(null);
    const add = (source, category, quantity) => {
        const key = getStockKey(source, category);
        if (!key) return;
        counts[key] = (counts[key] || 0) + quantity;
    };
    for (const transaction of transactions) {
        const parent = transaction?.details;
        if (!transaction?.id || !parent) continue;
        if (transaction.type === 'expense' || transaction.type === 'update_stock') {
            const category = getCategory(transaction, transaction.category);
            if (parent.club || EXCLUDED_STOCK_CATEGORIES.has(category)) continue;
            if (!SHIRT_CATEGORIES.has(category) && !normalizeWhitespace(parent.subCategory || parent.itemName || parent.name)) continue;
            add(transaction, category, quantityOr(parent.quantity));
            continue;
        }
        if (transaction.type !== 'sale' || parent.club === 'downtown-dinks' || parent.removedFromOrder) continue;
        // Counts do not need financial allocation, customer data, shipping or
        // per-source history. Keep the same field precedence as getSaleItems.
        const items = Array.isArray(parent.items) ? parent.items : [parent];
        for (const source of items) {
            const item = source.details || source;
            if ((Object.hasOwn(parent, 'removedFromOrder') ? parent.removedFromOrder : item.removedFromOrder)) continue;
            const details = {
                subCategory: Object.hasOwn(parent, 'subCategory') ? parent.subCategory : item.subCategory,
                itemName: item.itemName || item.name || transaction.description || 'Unknown Item',
                brand: item.brand || parent.brand || DEFAULT_BRAND,
                category: getItemCategory(item, transaction.category),
                size: item.size || 'N/A',
                linkedColor: Object.hasOwn(parent, 'linkedColor') ? parent.linkedColor : item.linkedColor,
                color: item.linkedColor || item.color || parent.linkedColor || parent.color || ''
            };
            add(details, transaction.category, -quantityOr(item.quantity));
        }
    }
    return { ...counts };
};

export const getInventoryRows = (transactions = []) => {
    const rows = new Map();
    const transactionKeyMap = new Map();
    const chronoTransactions = [...transactions].reverse();

    const addMovement = (key, descriptor, transactionId, delta) => {
        if (!rows.has(key)) {
            rows.set(key, {
                id: key,
                name: descriptor.name,
                variant: descriptor.variant,
                count: 0,
                transactionIds: [],
                canDeleteHistory: true
            });
        }

        const row = rows.get(key);
        row.count += delta;

        if (!row.transactionIds.includes(transactionId)) {
            row.transactionIds.push(transactionId);
        }

        if (!transactionKeyMap.has(transactionId)) {
            transactionKeyMap.set(transactionId, new Set());
        }
        transactionKeyMap.get(transactionId).add(key);
    };

    forEachMovement(chronoTransactions, addMovement);

    const rowsList = Array.from(rows.values());
    rowsList.forEach(row => {
        row.canDeleteHistory = row.transactionIds.every(transactionId => (
            (transactionKeyMap.get(transactionId)?.size || 0) <= 1
        ));
    });

    return rowsList.sort((left, right) => (
        left.name.localeCompare(right.name) || left.variant.localeCompare(right.variant)
    ));
};
