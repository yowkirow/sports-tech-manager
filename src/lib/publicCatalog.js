import { getStockCounts } from './inventory.js';
import { getVoucherUsage } from './voucherUsage.js';

// Input follows the transaction feed's newest-first ordering.
export const reconstructProducts = (transactions = []) => {
    const products = new Map();
    for (const transaction of [...transactions].reverse()) {
        const details = transaction.details;
        if (!details?.name) continue;
        const name = details.name.trim();
        const key = name.toLowerCase();
        if (transaction.type === 'delete_product') products.delete(key);
        if (transaction.type === 'define_product') {
            products.set(key, {
                id: transaction.id, name, price: details.price, imageUrl: details.imageUrl,
                images: details.images || (details.imageUrl ? [details.imageUrl] : []),
                linkedColor: details.linkedColor, brand: details.brand || 'Sypik',
                category: details.category || 'shirts', order: details.order !== undefined ? details.order : 9999,
                ...(typeof details.slug === 'string' && details.slug ? { slug: details.slug } : {})
            });
        }
    }
    return [...products.values()].sort((left, right) => left.order - right.order);
};

export const reconstructBrands = (transactions = []) => {
    const brands = new Map([['sypik', { name: 'Sypik' }]]);
    for (const transaction of [...transactions].reverse()) {
        const name = transaction.details?.name;
        if (!name) continue;
        if (transaction.type === 'define_brand') brands.set(name.toLowerCase(), { name: name.trim() });
        if (transaction.type === 'delete_brand') brands.delete(name.toLowerCase());
    }
    return [...brands.values()];
};

const DEFAULT_COLORS = [
    { name: 'White', hex: '#FFFFFF' },
    { name: 'Black', hex: '#000000' },
    { name: 'Kiwi', hex: '#bef264' },
    { name: 'Cream', hex: '#fef3c7' },
    { name: 'Baby Blue', hex: '#bae6fd' }
];

/** The shirt colors: the five defaults, then every color the owner added or deleted, in order. */
export const reconstructColors = (transactions = []) => {
    const colors = new Map(DEFAULT_COLORS.map(color => [color.name.toLowerCase(), { ...color }]));
    for (const transaction of [...transactions].reverse()) {
        const name = transaction.details?.name;
        if (typeof name !== 'string' || !name) continue;
        if (transaction.type === 'define_color') colors.set(name.toLowerCase(), { name: name.trim(), hex: transaction.details.hex || '#334155' });
        if (transaction.type === 'delete_color') colors.delete(name.toLowerCase());
    }
    return [...colors.values()];
};

export const buildPublicCatalog = (transactions = [], voucherUsage) => {
    const usage = voucherUsage || getVoucherUsage(transactions);
    const codes = new Set();
    const vouchers = transactions.flatMap(transaction => {
        const details = transaction.details;
        if (transaction.type !== 'voucher' || !details?.code) return [];
        const code = String(details.code).trim().toUpperCase();
        if (codes.has(code)) return [];
        codes.add(code);
        if (!details.active) return [];
        return [{
            code, active: true, discountType: details.discountType, value: details.value,
            expiryDate: details.expiryDate || null, usageLimit: details.usageLimit || null,
            used: [...usage].reduce((sum, [key, count]) => key.trim().toUpperCase() === code ? sum + count : sum, 0)
        }];
    });
    return {
        products: reconstructProducts(transactions), brands: reconstructBrands(transactions),
        stock: getStockCounts(transactions),
        vouchers
    };
};
