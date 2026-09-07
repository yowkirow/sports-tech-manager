import { useMemo } from 'react';
import { getInventoryRows } from '../lib/inventory.js';

// 1. Hook to track "Raw Material" Stock (The actual physical shirts)
export const useRawInventory = (transactions) => {
    return useMemo(() => {
        return Object.fromEntries(
            getInventoryRows(transactions).map(item => [item.id, item.count])
        );
    }, [transactions]);
};

// 2. Hook to list "Defined Products" (The Menu Items)
export const useProducts = (transactions) => {
    return useMemo(() => {
        const products = new Map(); // Name -> Product Details

        // CRITICAL: Process transactions Chronologically (Oldest First)
        // Because "Delete" must happen AFTER "Define"
        // The App passes transactions in Descending order (Newest First)
        const chronoTransactions = [...transactions].reverse();

        chronoTransactions.forEach(t => {
            // Safety check
            if (!t.details) return;

            if (t.type === 'define_product') {
                const { name, price, imageUrl, linkedColor, category, order, brand } = t.details;
                if (!name) return;
                // Normalize key to prevent duplicates from case/whitespace
                const key = name.trim().toLowerCase();

                products.set(key, {
                    id: t.id,
                    name: name.trim(),
                    price,
                    imageUrl,
                    images: t.details.images || (imageUrl ? [imageUrl] : []),
                    linkedColor,
                    brand: brand || 'Sypik',
                    category: category || 'shirts',
                    order: order !== undefined ? order : 9999
                });
            } else if (t.type === 'delete_product') {
                const { name } = t.details;
                if (name) {
                    const key = name.trim().toLowerCase();
                    // console.log(`[Reconstruct] Delete: ${name} (key: ${key})`);
                    products.delete(key);
                }
            }
        });

        // Sort by defined order, then fallback to name
        return Array.from(products.values()).sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return 0; // Keep insertion order if same (or add name sort)
        });
    }, [transactions]);
};

// 3. Hook to manage "Colors" (Custom shirt colors)
export const useColors = (transactions) => {
    return useMemo(() => {
        const DEFAULT_COLORS = [
            { name: 'White', hex: '#FFFFFF' },
            { name: 'Black', hex: '#000000' },
            { name: 'Kiwi', hex: '#bef264' },
            { name: 'Cream', hex: '#fef3c7' },
            { name: 'Baby Blue', hex: '#bae6fd' }
        ];

        const colorsMap = new Map();
        // Initialize with defaults
        DEFAULT_COLORS.forEach(c => colorsMap.set(c.name.toLowerCase(), c));

        const chronoTransactions = [...transactions].reverse();

        chronoTransactions.forEach(t => {
            if (!t.details) return;

            if (t.type === 'define_color') {
                const { name, hex } = t.details;
                if (name) {
                    colorsMap.set(name.toLowerCase(), {
                        name: name.trim(),
                        hex: hex || '#334155'
                    });
                }
            } else if (t.type === 'delete_color') {
                const { name } = t.details;
                if (name) {
                    colorsMap.delete(name.toLowerCase());
                }
            }
        });

        return Array.from(colorsMap.values());
    }, [transactions]);
};

// 4. Hook to manage "Brands" (Shirt brands like Sypik, etc.)
export const useBrands = (transactions) => {
    return useMemo(() => {
        const DEFAULT_BRANDS = [
            { name: 'Sypik' }
        ];

        const brandsMap = new Map();
        // Initialize with defaults
        DEFAULT_BRANDS.forEach(b => brandsMap.set(b.name.toLowerCase(), b));

        const chronoTransactions = [...transactions].reverse();

        chronoTransactions.forEach(t => {
            if (!t.details) return;

            if (t.type === 'define_brand') {
                const { name } = t.details;
                if (name) {
                    brandsMap.set(name.toLowerCase(), {
                        name: name.trim(),
                    });
                }
            } else if (t.type === 'delete_brand') {
                const { name } = t.details;
                if (name) {
                    brandsMap.delete(name.toLowerCase());
                }
            }
        });

        return Array.from(brandsMap.values());
    }, [transactions]);
};
