import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2, Edit, X, Upload } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { supabase } from '../../lib/supabaseClient';

// Helper to group inventory
const useInventory = (transactions) => {
    return useMemo(() => {
        const inventory = {};

        transactions.forEach(t => {
            if (!t.details) return;
            const { quantity, size, color, subCategory, imageUrl, price } = t.details;
            // Improved Key Generation
            const key = t.category === 'blanks'
                ? `shirt-${color}-${size}`
                : `acc-${subCategory.replace(/\s+/g, '-').toLowerCase()}`;

            if (!inventory[key]) {
                inventory[key] = {
                    id: key,
                    name: t.category === 'blanks' ? `${color} Shirt` : subCategory,
                    variant: t.category === 'blanks' ? size : 'General',
                    type: t.category,
                    stock: 0,
                    imageUrl: imageUrl || null,
                    price: price || 70, // Default or fetched from latest transaction
                    description: t.description || ''
                };
            }

            // Update with latest metadata if available (simulating "Edit" persistence via latest record)
            if (t.type === 'update_product') {
                if (imageUrl) inventory[key].imageUrl = imageUrl;
                if (price) inventory[key].price = price;
                if (t.description) inventory[key].description = t.description;
            }

            if (t.type === 'expense' || t.type === 'update_stock') {
                inventory[key].stock += (quantity || 0);
            } else if (t.type === 'sale') {
                inventory[key].stock -= (quantity || 0);
            }
        });

        return Object.values(inventory).filter(item => item.stock > -100); // Show everything, even negative stock for tracking errors
    }, [transactions]);
};

// Start of Main Component
export default function POSInterface({ transactions, onAddTransaction }) {
    const { showToast } = useToast();

    // POS State
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    // Checkout Meta
    const [customerName, setCustomerName] = useState('');
    const [orderStatus, setOrderStatus] = useState('paid'); // paid, shipped, ready
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Product Modal State
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null); // If null, adding new

    const inventoryItems = useInventory(transactions);

    // Filter Items
    const filteredItems = inventoryItems.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.variant.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Unique Customers for Autocomplete
    const uniqueCustomers = useMemo(() => {
        const names = new Set();
        transactions.forEach(t => {
            if (t.details?.customerName) names.add(t.details.customerName);
        });
        return Array.from(names);
    }, [transactions]);

    const filteredCustomers = uniqueCustomers.filter(c =>
        c.toLowerCase().includes(customerName.toLowerCase())
    );

    // --- Cart Logic ---
    const addToCart = (item) => {
        setCart(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
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
                return { ...item, quantity: Math.max(1, item.quantity + delta) };
            }
            return item;
        }));
    };

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // --- Checkout Logic ---
    const handleCheckout = async () => {
        if (cart.length === 0) return;
        if (!customerName.trim()) {
            showToast('Please enter customer name', 'error');
            return;
        }

        setCheckoutLoading(true);

        try {
            for (const item of cart) {
                const transaction = {
                    id: crypto.randomUUID(),
                    type: 'sale',
                    amount: item.price * item.quantity,
                    description: `Sold ${item.quantity}x ${item.name} (${item.variant})`,
                    category: 'sale',
                    date: new Date().toISOString(),
                    details: {
                        customerName,
                        quantity: item.quantity,
                        itemId: item.id,
                        itemName: item.name,
                        itemVariant: item.variant,
                        imageUrl: item.imageUrl,
                        status: orderStatus // paid, shipped, ready
                    }
                };
                await onAddTransaction(transaction);
            }

            showToast('Order saved successfully!', 'success');
            setCart([]);
            setCustomerName('');
            setOrderStatus('paid');
        } catch (error) {
            console.error(error);
            showToast('Checkout failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    // --- Product Modal Components ---
    const ProductModal = ({ onClose }) => {
        const [formData, setFormData] = useState({
            name: editingItem?.name || '',
            variant: editingItem?.variant || '',
            price: editingItem?.price || 70,
            stockToAdd: 0,
            imageUrl: editingItem?.imageUrl || null
        });
        const [uploading, setUploading] = useState(false);
        const fileInputRef = useRef(null);

        const handleImageUpload = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                setUploading(true);
                const fileExt = file.name.split('.').pop();
                const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
                const filePath = `product-images/${fileName}`;

                const { error } = await supabase.storage.from('product-images').upload(filePath, file);
                if (error) throw error;

                const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
                setFormData(prev => ({ ...prev, imageUrl: data.publicUrl }));
            } catch (err) {
                showToast('Image upload failed', 'error');
            } finally {
                setUploading(false);
            }
        };

        const handleSave = async () => {
            if (!formData.name) return;

            setCheckoutLoading(true);
            try {
                // 1. If stock added -> 'update_stock' (or 'expense' if new)
                if (formData.stockToAdd !== 0) {
                    const stockTx = {
                        id: crypto.randomUUID(),
                        type: editingItem ? 'update_stock' : 'expense',
                        amount: 0, // Assume 0 cost for stock adjustment/init unless specified (simplified)
                        description: `Stock Adjustment: ${formData.stockToAdd}x ${formData.name}`,
                        category: 'blanks', // Defaulting to blanks for now
                        date: new Date().toISOString(),
                        details: {
                            quantity: parseInt(formData.stockToAdd),
                            subCategory: formData.name, // Using subCategory as generic name
                            size: formData.variant,
                            color: formData.name.split(' ')[0], // Hacky inference, but works for "Black Shirt"
                            imageUrl: formData.imageUrl,
                            price: parseFloat(formData.price)
                        }
                    };
                    await onAddTransaction(stockTx);
                }

                // 2. If details changed (Price/Image) -> 'update_product' (meta transaction)
                if (editingItem && (formData.price !== editingItem.price || formData.imageUrl !== editingItem.imageUrl)) {
                    const updateTx = {
                        id: crypto.randomUUID(),
                        type: 'update_product',
                        amount: 0,
                        description: `Updated Product: ${formData.name}`,
                        category: 'system',
                        date: new Date().toISOString(),
                        details: {
                            subCategory: formData.name,
                            size: formData.variant,
                            color: formData.name.split(' ')[0],
                            imageUrl: formData.imageUrl,
                            price: parseFloat(formData.price),
                            quantity: 0
                        }
                    };
                    await onAddTransaction(updateTx);
                }

                showToast('Product saved!', 'success');
                onClose();
            } catch (err) {
                showToast('Failed to save product', 'error');
            } finally {
                setCheckoutLoading(false);
            }
        };

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="glass-panel w-full max-w-lg p-6 rounded-2xl relative"
                >
                    <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
                        <X size={24} />
                    </button>

                    <h2 className="text-xl font-bold text-white mb-6">
                        {editingItem ? 'Edit Product' : 'Add New Product'}
                    </h2>

                    <div className="space-y-4">
                        {/* Image Upload */}
                        <div className="flex justify-center">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="w-32 h-32 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-white/5 transition-all relative overflow-hidden"
                            >
                                {formData.imageUrl ? (
                                    <img src={formData.imageUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center text-slate-500">
                                        {uploading ? <Loader2 className="animate-spin" /> : <Upload size={24} />}
                                        <span className="text-xs block mt-1">Upload</span>
                                    </div>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" className="hidden" onChange={handleImageUpload} accept="image/*" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-400">Product Name</label>
                                <input
                                    className="glass-input mt-1"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Black Shirt"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400">Variant / Size</label>
                                <input
                                    className="glass-input mt-1"
                                    value={formData.variant}
                                    onChange={e => setFormData({ ...formData, variant: e.target.value })}
                                    placeholder="e.g. M"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-400">Price (₱)</label>
                                <input
                                    type="number"
                                    className="glass-input mt-1"
                                    value={formData.price}
                                    onChange={e => setFormData({ ...formData, price: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400">
                                    {editingItem ? 'Add Stock (+/-)' : 'Initial Stock'}
                                </label>
                                <input
                                    type="number"
                                    className="glass-input mt-1"
                                    value={formData.stockToAdd}
                                    onChange={e => setFormData({ ...formData, stockToAdd: e.target.value })}
                                />
                            </div>
                        </div>

                        <button onClick={handleSave} className="btn-primary w-full py-3 mt-4">
                            <CheckCircle size={20} />
                            Save Product
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-120px)] relative">
            {showModal && <ProductModal onClose={() => setShowModal(false)} />}

            {/* Product Grid Area */}
            <div className="flex-1 flex flex-col min-h-0">
                <div className="mb-6 flex gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search products..."
                            className="glass-input pl-12"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={() => { setEditingItem(null); setShowModal(true); }}
                        className="btn-secondary whitespace-nowrap"
                    >
                        <Plus size={20} /> Add Product
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 content-start">
                    <AnimatePresence>
                        {filteredItems.map(item => (
                            <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="glass-card p-0 overflow-hidden cursor-pointer group flex flex-col h-full relative"
                                onClick={() => addToCart(item)}
                            >
                                <button
                                    onClick={(e) => { e.stopPropagation(); setEditingItem(item); setShowModal(true); }}
                                    className="absolute top-2 right-2 z-10 p-2 bg-black/60 hover:bg-primary rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <Edit size={14} />
                                </button>

                                <div className="aspect-square bg-black/20 relative">
                                    {item.imageUrl ? (
                                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                                            <Package size={32} />
                                        </div>
                                    )}
                                    <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-white font-mono">
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
                    {cart.map(item => (
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
                    ))}
                    {cart.length === 0 && (
                        <div className="text-center text-slate-500 mt-10">Empty Cart</div>
                    )}
                </div>

                <div className="p-6 border-t border-white/10 bg-black/20 space-y-4">
                    <div className="flex justify-between text-lg font-bold text-white">
                        <span>Total</span>
                        <span>₱{cartTotal.toLocaleString()}</span>
                    </div>

                    <div className="relative">
                        <label className="text-xs text-slate-500 mb-1 block">Customer</label>
                        <input
                            type="text"
                            value={customerName}
                            onChange={(e) => { setCustomerName(e.target.value); setShowSuggestions(true); }}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                            className="glass-input py-2 text-sm"
                            placeholder="Customer Name"
                        />
                        {showSuggestions && filteredCustomers.length > 0 && (
                            <div className="absolute bottom-full left-0 w-full mb-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-20">
                                {filteredCustomers.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => { setCustomerName(c); setShowSuggestions(false); }}
                                        className="w-full text-left px-4 py-2 hover:bg-white/5 text-sm"
                                    >
                                        {c}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="text-xs text-slate-500 mb-1 block">Order Status</label>
                        <div className="grid grid-cols-3 gap-2">
                            {['paid', 'shipped', 'ready'].map(status => (
                                <button
                                    key={status}
                                    onClick={() => setOrderStatus(status)}
                                    className={`py-2 rounded-lg text-xs font-semibold capitalize transition-all ${orderStatus === status
                                            ? 'bg-primary text-white shadow-lg'
                                            : 'bg-white/5 text-slate-400 hover:bg-white/10'
                                        }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleCheckout}
                        disabled={cart.length === 0 || checkoutLoading}
                        className="btn-primary w-full py-4 text-lg"
                    >
                        {checkoutLoading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
                        Checkout
                    </button>
                </div>
            </div>
        </div>
    );
}
