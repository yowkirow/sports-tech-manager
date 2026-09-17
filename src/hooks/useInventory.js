import { useMemo } from 'react';
import { getStockCounts } from '../lib/inventory.js';
import { reconstructBrands, reconstructProducts } from '../lib/publicCatalog.js';

// 1. Hook to track "Raw Material" Stock (The actual physical shirts)
export const useRawInventory = (transactions) => {
    return useMemo(() => {
        return getStockCounts(transactions);
    }, [transactions]);
};

// 2. Hook to list "Defined Products" (The Menu Items)
export const useProducts = (transactions) => {
    return useMemo(() => reconstructProducts(transactions), [transactions]);
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
    return useMemo(() => reconstructBrands(transactions), [transactions]);
};
