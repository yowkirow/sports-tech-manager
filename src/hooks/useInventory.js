import { useMemo } from 'react';

// 1. Hook to track "Raw Material" Stock (The actual physical shirts)
export const useRawInventory = (transactions) => {
    return useMemo(() => {
        const inventory = {}; // key: "shirt-{color}-{size}" or "acc-{name}"

        // Process Chronologically (Oldest -> Newest)
        // transactions are passed as Newest -> Oldest from hook
        const chronoTransactions = [...transactions].reverse();

        chronoTransactions.forEach(t => {
            if (!t.details) return;
            const { quantity, size, color, subCategory, category } = t.details;

            // Only care about Stock movements (Expense = In, Sale = Out)
            // AND 'update_stock' which is a manual adjustment
            const type = t.type;
            if (!['expense', 'sale', 'update_stock'].includes(type) && t.category !== 'return') return;

            let key;
            if (t.category === 'blanks' || (category === 'blanks')) {
                // Multi-Brand Logic: Include brand in the key
                // validColor comes from Color or linkedColor
                const validColor = color || t.details.linkedColor;
                const validBrand = t.details.brand || 'Sypik'; // Default to Sypik for legacy orders
                if (!validColor || !size) return;
                key = `shirt-${validBrand.toLowerCase()}-${validColor.toLowerCase()}-${size}`;
            } else {
                const name = subCategory || t.details.itemName || t.description;
                if (!name) return;
                key = `acc-${name.replace(/\s+/g, '-').toLowerCase()}`;
            }

            if (!inventory[key]) inventory[key] = 0;

            if (type === 'expense' || type === 'update_stock' || type === 'return') {
                inventory[key] += (quantity || 0);
            } else if (type === 'sale') {
                inventory[key] -= (quantity || 0);
            }
        });
        return inventory;
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
                    id: t.id, // Use latest ID
                    name: name.trim(), // Clean up display name too
                    price,
                    imageUrl,
                    linkedColor,
                    brand: brand || 'Sypik',
                    category: category || 'shirts',
                    order: order !== undefined ? order : 9999 // Default to end
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
