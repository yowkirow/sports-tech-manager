import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2 } from 'lucide-react';

import { useToast } from '../ui/Toast';

// Helper to group inventory
const useInventory = (transactions) => {
    return useMemo(() => {
        const inventory = {}; // Key: "Color-Size" or "SubCategory"

        transactions.forEach(t => {
            if (!t.details) return;
            const { quantity, size, color, subCategory, imageUrl } = t.details;
            const key = t.category === 'blanks' ? `${color}-${size}` : subCategory;

            if (!key) return;

            if (!inventory[key]) {
                inventory[key] = {
                    id: key,
                    name: t.category === 'blanks' ? `${color} Shirt` : subCategory,
                    variant: t.category === 'blanks' ? size : '',
                    type: t.category,
                    stock: 0,
                    imageUrl: imageUrl || null, // Keep the latest image found
                    price: 70 // Default fixed price for now, logic can expand
                };
            }

            if (t.type === 'expense') {
                inventory[key].stock += (quantity || 0);
                if (imageUrl) inventory[key].imageUrl = imageUrl; // Update image if new stock has one
            } else if (t.type === 'sale') {
                inventory[key].stock -= (quantity || 0);
            }
        });

        // Filter out items with <= 0 stock for POS? Or show as out of stock?
        // Let's show all positive stock items
        return Object.values(inventory).filter(item => item.stock > 0);
    }, [transactions]);
};

export default function POSInterface({ transactions, onAddTransaction }) {
    const { showToast } = useToast();
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [customerName, setCustomerName] = useState('');

    const inventoryItems = useInventory(transactions);

    const filteredItems = inventoryItems.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.variant.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const addToCart = (item) => {
        setCart(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
                if (existing.quantity >= item.stock) {
                    showToast('Not enough stock!', 'error');
                    return prev;
                }
                return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const removeFromCart = (itemId) => {
        setCart(prev => prev.filter(i => i.id !== itemId));
    };

    const updateQuantity = (itemId, delta) => {
        setCart(prev => prev.map(item => {
            if (item.id === itemId) {
                const newQty = Math.max(1, item.quantity + delta);
                // Check stock limit
                const stockItem = inventoryItems.find(inv => inv.id === itemId);
                if (stockItem && newQty > stockItem.stock) {
                    showToast('Max stock reached', 'error');
                    return item;
                }
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const handleCheckout = async () => {
        if (cart.length === 0) return;
        if (!customerName.trim()) {
            showToast('Please enter customer name', 'error');
            return;
        }

        setCheckoutLoading(true);

        try {
            // Create a transaction for each item in cart logic, OR one big transaction?
            // Existing logic seems to be one transaction per item record (based on structure).
            // But we can batch or loop. Let's loop for now as `addTransaction` handles one.

            // Actually, best to record separate sales for analytics per item type
            for (const item of cart) {
                const transaction = {
                    id: crypto.randomUUID(),
                    type: 'sale',
                    amount: item.price * item.quantity,
                    description: `Sold ${item.quantity}x ${item.name} ${item.variant} to ${customerName}`,
                    category: 'sale',
                    date: new Date().toISOString(),
                    details: {
                        customerName,
                        quantity: item.quantity,
                        // Reconstruct details for schema consistency
                        ...(item.type === 'blanks'
                            ? {
                                size: item.variant,
                                color: item.name.replace(' Shirt', ''), // bit hacky, but works with current name gen
                            }
                            : { subCategory: item.name }
                        ),
                        imageUrl: item.imageUrl
                    }
                };

                await onAddTransaction(transaction);
            }

            showToast('Sale recorded successfully!', 'success');
            setCart([]);
            setCustomerName('');
        } catch (error) {
            console.error(error);
            showToast('Checkout failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-120px)]">
            {/* Product Grid Area */}
            <div className="flex-1 flex flex-col min-h-0">
                <div className="mb-6 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        className="glass-input pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 content-start">
                    <AnimatePresence>
                        {filteredItems.map(item => (
                            <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                onClick={() => addToCart(item)}
                                className="glass-card p-0 overflow-hidden cursor-pointer group flex flex-col h-full"
                            >
                                <div className="aspect-square bg-black/20 relative group-hover:bg-black/30 transition-colors">
                                    {item.imageUrl ? (
                                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                                            <Package size={32} />
                                        </div>
                                    )}
                                    <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">
                                        Qty: {item.stock}
                                    </div>
                                </div>
                                <div className="p-4 flex flex-col flex-1">
                                    <h3 className="font-semibold text-white leading-tight mb-1">{item.name}</h3>
                                    <p className="text-sm text-slate-400 mb-2">{item.variant}</p>
                                    <div className="mt-auto flex justify-between items-center">
                                        <span className="text-primary font-bold">₱{item.price}</span>
                                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                                            <Plus size={16} />
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>

            {/* Cart Sidebar */}
            <div className="w-full lg:w-[400px] glass-panel rounded-2xl flex flex-col h-[500px] lg:h-full">
                <div className="p-6 border-b border-white/10">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <ShoppingCart className="text-primary" />
                        Current Order
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="text-center text-slate-500 mt-10">
                            <p>Cart is empty</p>
                            <p className="text-sm">Select items to start selling</p>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.id} className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
                                <div className="w-12 h-12 rounded-lg bg-black/20 overflow-hidden shrink-0">
                                    {item.imageUrl && <img src={item.imageUrl} className="w-full h-full object-cover" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-medium text-slate-200 truncate">{item.name}</h4>
                                    <p className="text-xs text-primary">₱{item.price} x {item.quantity}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-white/10 rounded text-slate-400">-</button>
                                    <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-white/10 rounded text-slate-400">+</button>
                                </div>
                                <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-300 ml-2">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-6 border-t border-white/10 bg-black/20">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center text-lg font-bold text-white">
                            <span>Total</span>
                            <span>₱{cartTotal.toLocaleString()}</span>
                        </div>

                        <input
                            type="text"
                            placeholder="Customer Name"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="glass-input py-2 text-sm"
                        />

                        <button
                            onClick={handleCheckout}
                            disabled={cart.length === 0 || checkoutLoading}
                            className="btn-primary w-full py-4 text-lg shadow-xl shadow-primary/20"
                        >
                            {checkoutLoading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
                            Checkout
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
