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
                // Sypik Logic: A "Sale" of a product linked to "White" counts as a sale of "White Blank"
                const validColor = color || (t.details.linkedColor); // linkedColor comes from Product Sale
                if (!validColor || !size) return;
                key = `shirt-${validColor}-${size}`;
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
            if (t.type === 'define_product') {
                const { name, price, imageUrl, linkedColor, category, order } = t.details;
                if (!name) return;
                products.set(name, {
                    id: t.id, // Use latest ID
                    name,
                    price,
                    imageUrl,
                    linkedColor,
                    category: category || 'shirts',
                    order: order !== undefined ? order : 9999 // Default to end
                });
            } else if (t.type === 'delete_product') {
                const { name } = t.details;
                if (name) products.delete(name);
            }
        });

        // Sort by defined order, then fallback to name
        return Array.from(products.values()).sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return 0; // Keep insertion order if same (or add name sort)
        });
    }, [transactions]);
};
