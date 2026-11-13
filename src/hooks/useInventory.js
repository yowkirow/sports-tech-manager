import { useMemo } from 'react';
import { getStockCounts } from '../lib/inventory.js';
import { reconstructBrands, reconstructColors, reconstructProducts } from '../lib/publicCatalog.js';

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
    return useMemo(() => reconstructColors(transactions), [transactions]);
};

// 4. Hook to manage "Brands" (Shirt brands like Sypik, etc.)
export const useBrands = (transactions) => {
    return useMemo(() => reconstructBrands(transactions), [transactions]);
};
