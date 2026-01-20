import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2, Edit, X, Upload, Ruler } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { supabase } from '../../lib/supabaseClient';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['White', 'Black', 'Kiwi', 'Cream', 'Baby Blue'];

// 1. Hook to track "Raw Material" Stock (The actual physical shirts)
const useRawInventory = (transactions) => {
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
const useProducts = (transactions) => {
    return useMemo(() => {
        const products = new Map(); // Name -> Product Details

        // CRITICAL: Process transactions Chronologically (Oldest First)
        // Because "Delete" must happen AFTER "Define"
        // The App passes transactions in Descending order (Newest First)
        const chronoTransactions = [...transactions].reverse();

        chronoTransactions.forEach(t => {
            if (t.type === 'define_product') {
                const { name, price, imageUrl, linkedColor, category } = t.details;
                if (!name) return;
                products.set(name, {
                    id: t.id, // Use latest ID
                    name,
                    price,
                    imageUrl,
                    linkedColor,
                    category: category || 'shirts'
                });
            } else if (t.type === 'delete_product') {
                const { name } = t.details;
                if (name) products.delete(name);
            }
        });

        return Array.from(products.values());
    }, [transactions]);
};


export default function POSInterface({ transactions, onAddTransaction }) {
    const { showToast } = useToast();

    // State
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [checkoutLoading, setCheckoutLoading] = useState(false);

    // UI State
    const [showProductModal, setShowProductModal] = useState(false);
    const [activeProduct, setActiveProduct] = useState(null); // The product clicked, waiting for size override
    const [editingProduct, setEditingProduct] = useState(null); // For the Edit Modal
    const [cartOpenMobile, setCartOpenMobile] = useState(false);

    // Bulk Selection State
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedProducts, setSelectedProducts] = useState(new Set());

    // Derived Data
    const rawInventory = useRawInventory(transactions);
    const products = useProducts(transactions);

    // Filtering
    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // --- Bulk Actions ---
    const toggleSelection = (productName) => {
        const newSet = new Set(selectedProducts);
        if (newSet.has(productName)) newSet.delete(productName);
        else newSet.add(productName);
        setSelectedProducts(newSet);
    };

    const handleBulkDelete = async () => {
        if (!window.confirm(`Delete ${selectedProducts.size} products? This cannot be undone.`)) return;
        setCheckoutLoading(true);
        try {
            for (const name of selectedProducts) {
                await onAddTransaction({
                    id: crypto.randomUUID(),
                    type: 'delete_product', // Safe "Soft Delete"
                    category: 'system',
                    amount: 0,
                    description: `Bulk Deleted: ${name}`,
                    date: new Date().toISOString(),
                    details: { name }
                });
            }
            showToast(`Deleted ${selectedProducts.size} products`, 'success');
            setIsSelectionMode(false);
            setSelectedProducts(new Set());
        } catch (err) {
            console.error(err);
            showToast('Bulk Delete Failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    // ... (rest of component)
    // Note: I will need to use a second Replace to inject the UI elements into the JSX.
    // This replace block only handles the logic setup.

    // ... [existing imports and code] ...

    // --- Checkout Meta ---
    const [customerName, setCustomerName] = useState('');
    const [orderStatus, setOrderStatus] = useState('paid');
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Unique Customers
    const uniqueCustomers = useMemo(() => {
        const names = new Set();
        transactions.forEach(t => { if (t.details?.customerName) names.add(t.details.customerName) });
        return Array.from(names);
    }, [transactions]);
    const filteredCustomers = uniqueCustomers.filter(c => c.toLowerCase().includes(customerName.toLowerCase()));


    // --- Logic ---

    const getStockForProduct = (product, size) => {
        if (!product.linkedColor) return 999; // Unlimited if no link
        const key = `shirt-${product.linkedColor}-${size}`;
        return rawInventory[key] || 0;
    };

    const addToCart = (product, size) => {
        const cartId = `${product.name}-${size}`;
        setCart(prev => {
            const existing = prev.find(i => i.cartId === cartId);
            if (existing) {
                return prev.map(i => i.cartId === cartId ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, {
                ...product,
                size,
                cartId,
                quantity: 1,
                // Snapshot current link for history
                linkedColor: product.linkedColor
            }];
        });
        setActiveProduct(null); // Close size selector
    };

    const handleCheckout = async () => {
        if (cart.length === 0 || !customerName.trim()) {
            showToast(!customerName.trim() ? 'Enter customer name' : 'Cart is empty', 'error');
            return;
        }

        setCheckoutLoading(true);
        try {
            for (const item of cart) {
                // Determine Raw Material to deduct
                // If it's a shirt with a linked color, we deduct that blank
                const isShirt = !!item.linkedColor;

                const transaction = {
                    id: crypto.randomUUID(),
                    type: 'sale', // Adds to Sales, Deducts from Inventory
                    amount: item.price * item.quantity,
                    category: isShirt ? 'blanks' : 'accessories', // Important for useRawInventory hook to see it
                    date: new Date().toISOString(),
                    description: `Sold ${item.name} (${item.size})`,
                    details: {
                        customerName,
                        status: orderStatus,
                        quantity: item.quantity,
                        itemName: item.name,
                        price: item.price,
                        imageUrl: item.imageUrl,
                        // Context for Inventory deduction
                        ...(isShirt && {
                            size: item.size,
                            color: item.linkedColor, // Deducts 'Black Shirt'
                            linkedColor: item.linkedColor
                        }),
                        ...(!isShirt && {
                            subCategory: item.name
                        })
                    }
                };
                await onAddTransaction(transaction);
            }
            showToast('Order Processed!', 'success');
            setCart([]);
            setCustomerName('');
            setOrderStatus('paid');
        } catch (err) {
            console.error(err);
            showToast('Checkout Failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    // --- Sub-Components ---

    const ProductDefinitionModal = () => {
        const [form, setForm] = useState({
            name: editingProduct?.name || '',
            price: editingProduct?.price || 70,
            linkedColor: editingProduct?.linkedColor || 'Black',
            imageUrl: editingProduct?.imageUrl || null
        });
        const [uploading, setUploading] = useState(false);
        const fileRef = useRef(null);

        const handleUpload = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setUploading(true);
            try {
                const ext = file.name.split('.').pop();
                const fileName = `${Date.now()}.${ext}`;
                const path = fileName;

                // CRITICAL: Force correct MIME type
                const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: file.type
                });

                if (uploadError) throw uploadError;

                const { data } = supabase.storage.from('product-images').getPublicUrl(path);
                const publicUrl = data.publicUrl;

                console.log("Upload successful:", publicUrl);
                showToast('Upload Verified & Accessible!', 'success');
                setForm(p => ({ ...p, imageUrl: publicUrl }));

            } catch (err) {
                console.error("Upload failed:", err);
                showToast(`Upload Error: ${err.message}`, 'error');
            } finally {
                setUploading(false);
            }
        };

        const saveProduct = async () => {
            if (!form.name) return;
            setCheckoutLoading(true);
            try {
                await onAddTransaction({
                    id: crypto.randomUUID(),
                    type: 'define_product',
                    category: 'system',
                    amount: 0,
                    description: `Defined Product: ${form.name}`,
                    date: new Date().toISOString(),
                    details: form
                });
                showToast('Product Saved!', 'success');
                setShowProductModal(false);
            } catch (err) {
                console.error("Save failed:", err);
                showToast(`Save Error: ${err.message}`, 'error');
            } finally {
                setCheckoutLoading(false);
            }
        };

        const deleteProduct = async () => {
            if (!editingProduct || !window.confirm(`Delete ${editingProduct.name}? This will remove it from the menu.`)) return;
            setCheckoutLoading(true);
            try {
                await onAddTransaction({
                    id: crypto.randomUUID(),
                    type: 'delete_product',
                    category: 'system',
                    amount: 0,
                    description: `Deleted Product: ${editingProduct.name}`,
                    date: new Date().toISOString(),
                    details: { name: editingProduct.name }
                });
                showToast('Product Deleted', 'info');
                setShowProductModal(false);
            } catch (err) { showToast('Delete Failed', 'error'); }
            finally { setCheckoutLoading(false); }
        };

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="glass-panel w-full max-w-md p-6 relative">
                    <button onClick={() => setShowProductModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={24} /></button>
                    <h3 className="text-xl font-bold mb-6 text-white">{editingProduct ? 'Edit Product' : 'New Product'}</h3>

                    <div className="space-y-4">
                        <div onClick={() => fileRef.current?.click()} className="h-32 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:bg-white/5 relative overflow-hidden">
                            {form.imageUrl ? <img src={form.imageUrl} className="w-full h-full object-cover" /> : (
                                <div className="text-center text-slate-500">
                                    {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                                    <span className="text-xs block">Upload Image</span>
                                </div>
                            )}
                        </div>
                        <input type="file" ref={fileRef} className="hidden" onChange={handleUpload} />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-slate-400">Name</label>
                                <input className="glass-input mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sypik Classic" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400">Price</label>
                                <input type="number" className="glass-input mt-1" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs text-slate-400">Raw Material (Inventory Link)</label>
                            <select className="glass-input mt-1" value={form.linkedColor} onChange={e => setForm({ ...form, linkedColor: e.target.value })}>
                                {COLORS.map(c => <option key={c} value={c} className="bg-slate-900">{c} Shirt</option>)}
                            </select>
                            <p className="text-[10px] text-slate-500 mt-1">Deducts from "{form.linkedColor} Shirt" inventory when sold.</p>
                        </div>

                        <div className="flex gap-2 mt-4">
                            {editingProduct && (
                                <button onClick={deleteProduct} className="px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20">
                                    <Trash2 size={20} />
                                </button>
                            )}
                            <button onClick={saveProduct} className="btn-primary flex-1 py-3">Save Definition</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const CartContent = () => (
        <>
            <div className="p-6 border-b border-white/10 hidden lg:block">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <ShoppingCart className="text-primary" /> Current Order
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.map(item => (
                    <div key={item.cartId} className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-black/20 overflow-hidden shrink-0">
                            {item.imageUrl && <img src={item.imageUrl} className="w-full h-full object-cover" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-slate-200 truncate">{item.name}</h4>
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                                <span className="bg-white/10 px-1.5 py-0.5 rounded text-white">{item.size}</span>
                                <span>₱{item.price}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => updateCartQuantity(item.cartId, -1)} className="p-1 hover:bg-white/10 rounded text-slate-400">-</button>
                            <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                            <button onClick={() => updateCartQuantity(item.cartId, 1)} className="p-1 hover:bg-white/10 rounded text-slate-400">+</button>
                        </div>
                        <button onClick={() => setCart(c => c.filter(x => x.cartId !== item.cartId))} className="text-red-400 ml-2"><Trash2 size={16} /></button>
                    </div>
                ))}
                {cart.length === 0 && <div className="text-center text-slate-500 mt-10">Cart is empty</div>}
            </div>

            <div className="p-6 border-t border-white/10 bg-black/20 space-y-4">
                <div className="flex justify-between text-lg font-bold text-white"><span>Total</span><span>₱{cart.reduce((a, b) => a + (b.price * b.quantity), 0).toLocaleString()}</span></div>

                <div className="relative">
                    <label className="text-xs text-slate-500 mb-1 block">Customer</label>
                    <input
                        className="glass-input py-2 text-sm"
                        placeholder="Customer Name"
                        value={customerName}
                        onChange={e => { setCustomerName(e.target.value); setShowSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    />
                    {showSuggestions && filteredCustomers.length > 0 && (
                        <div className="absolute bottom-full left-0 w-full mb-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-20">
                            {filteredCustomers.map(c => (
                                <button key={c} onClick={() => { setCustomerName(c); setShowSuggestions(false); }} className="w-full text-left px-4 py-2 hover:bg-white/5 text-sm">{c}</button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {['paid', 'shipped', 'ready'].map(s => (
                        <button key={s} onClick={() => setOrderStatus(s)} className={`py-2 rounded-lg text-xs font-semibold capitalize ${orderStatus === s ? 'bg-primary text-white' : 'bg-white/5 text-slate-400'}`}>{s}</button>
                    ))}
                </div>

                <button onClick={handleCheckout} disabled={checkoutLoading || cart.length === 0} className="btn-primary w-full py-4 text-lg">
                    {checkoutLoading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />} Checkout
                </button>
            </div>
        </>
    );

    const SizeSelectorModal = () => {
        if (!activeProduct) return null;
        return (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4" onClick={() => setActiveProduct(null)}>
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="glass-panel p-6 max-w-sm w-full relative"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex gap-4 mb-4">
                        <div className="w-16 h-16 rounded-lg bg-white/5 overflow-hidden">
                            {activeProduct.imageUrl && <img src={activeProduct.imageUrl} className="w-full h-full object-cover" />}
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-white">{activeProduct.name}</h3>
                            <p className="text-primary">₱{activeProduct.price}</p>
                        </div>
                    </div>

                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                        <Ruler size={14} /> Select Size
                    </h4>

                    <div className="grid grid-cols-4 gap-2">
                        {SIZES.map(size => {
                            const stock = getStockForProduct(activeProduct, size);
                            const hasStock = stock > 0;
                            return (
                                <button
                                    key={size}
                                    disabled={!hasStock}
                                    onClick={() => addToCart(activeProduct, size)}
                                    className={`p-2 rounded-lg border text-center transition-all ${hasStock
                                        ? 'border-white/20 hover:border-primary hover:bg-primary/20 text-white'
                                        : 'border-white/5 text-slate-600 bg-black/20 cursor-not-allowed'
                                        }`}
                                >
                                    <div className="font-bold">{size}</div>
                                    <div className="text-[10px] mt-1">{stock} left</div>
                                </button>
                            );
                        })}
                    </div>
                </motion.div>
            </div>
        );
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-120px)] relative">
            {showProductModal && <ProductDefinitionModal />}
            {activeProduct && <SizeSelectorModal />}

            {/* Product Grid */}
            <div className="flex-1 flex flex-col min-h-0 pb-20 lg:pb-0"> {/* Padding bottom for mobile sticky bar */}
                <div className="mb-6 flex gap-4 items-center">
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

                    {isSelectionMode ? (
                        <div className="flex gap-2">
                            <button
                                onClick={handleBulkDelete}
                                disabled={selectedProducts.size === 0}
                                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={18} /> Delete ({selectedProducts.size})
                            </button>
                            <button
                                onClick={() => { setIsSelectionMode(false); setSelectedProducts(new Set()); }}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsSelectionMode(true)}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold border border-white/10 transition-colors"
                            >
                                Select
                            </button>
                            <button
                                onClick={() => { setEditingProduct(null); setShowProductModal(true); }}
                                className="btn-secondary whitespace-nowrap"
                            >
                                <Plus size={20} /> <span className="hidden sm:inline">Define Product</span>
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 content-start">
                    {!isSelectionMode && (
                        <div onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="glass-card flex flex-col items-center justify-center gap-4 border-dashed border-white/20 hover:border-primary/50 cursor-pointer min-h-[200px] lg:min-h-[250px] group opacity-60 hover:opacity-100">
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Plus size={24} className="text-slate-400 group-hover:text-primary" />
                            </div>
                            <span className="font-medium text-slate-400">New Product</span>
                        </div>
                    )}

                    <AnimatePresence>
                        {filteredProducts.map(product => (
                            <motion.div
                                key={product.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className={`glass-card p-0 overflow-hidden cursor-pointer group flex flex-col h-full relative ${selectedProducts.has(product.name) ? 'ring-2 ring-primary bg-primary/10' : ''}`}
                                onClick={() => {
                                    if (isSelectionMode) toggleSelection(product.name);
                                    else setActiveProduct(product);
                                }}
                            >
                                {isSelectionMode && (
                                    <div className="absolute top-2 left-2 z-20 pointer-events-none">
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedProducts.has(product.name) ? 'bg-primary border-primary' : 'border-white/40 bg-black/40'}`}>
                                            {selectedProducts.has(product.name) && <CheckCircle size={14} className="text-white" />}
                                        </div>
                                    </div>
                                )}

                                {!isSelectionMode && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setEditingProduct(product); setShowProductModal(true); }}
                                        className="absolute top-2 right-2 z-10 p-2 bg-black/60 hover:bg-primary rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all focus:opacity-100 lg:opacity-0"
                                    >
                                        <Edit size={14} />
                                    </button>
                                )}

                                <div className="aspect-square bg-black/20 relative">
                                    {product.imageUrl ? (
                                        <img
                                            src={product.imageUrl}
                                            alt={product.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                console.error("Image load failed for:", product.name, product.imageUrl);
                                                e.target.style.display = 'none';
                                                e.target.nextSibling.classList.remove('hidden');
                                                e.target.nextSibling.classList.add('flex');
                                            }}
                                        />
                                    ) : null}
                                    {/* Fallback - RED if error (url exists), GRAY if no url */}
                                    <div className={`w-full h-full flex items-center justify-center ${product.imageUrl ? 'text-red-500 bg-red-500/10' : 'text-slate-600'} ${product.imageUrl && !product.hasError ? 'hidden' : 'flex'}`}>
                                        <Package size={32} />
                                        {product.imageUrl && <span className="text-[10px] absolute bottom-8">Failed Load</span>}
                                    </div>

                                    {/* DEBUG: Show URL */}
                                    <div className="absolute top-0 left-0 bg-black/80 text-[8px] text-white p-1 max-w-full break-all z-20">
                                        {product.imageUrl || 'NULL'}
                                    </div>

                                    <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white backdrop-blur-md">
                                        Uses: {product.linkedColor}
                                    </div>
                                </div>
                                <div className="p-4 flex flex-col flex-1">
                                    <h3 className="font-semibold text-white leading-tight mb-1">{product.name}</h3>
                                    <div className="mt-auto flex justify-between items-center">
                                        <span className="text-primary font-bold">₱{product.price}</span>
                                        <ArrowRightIcon className="text-white/20 group-hover:text-white transition-colors" />
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>

            {/* Sticky Mobile Cart Bar */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-white/10 lg:hidden flex justify-between items-center z-30">
                <div>
                    <p className="text-xs text-slate-400 mb-0.5">{cart.reduce((a, b) => a + b.quantity, 0)} items in cart</p>
                    <p className="font-bold text-lg text-white">₱{cart.reduce((a, b) => a + (b.price * b.quantity), 0).toLocaleString()}</p>
                </div>
                <button
                    onClick={() => setCartOpenMobile(true)}
                    className="btn-primary py-3 px-6 flex items-center gap-2"
                    disabled={cart.length === 0}
                >
                    <ShoppingCart size={20} /> View Cart
                </button>
            </div>

            {/* Desktop Cart Section (Hidden on Mobile) */}
            <div className="hidden lg:flex w-full lg:w-[400px] glass-panel rounded-2xl flex-col h-full">
                <CartContent
                    cart={cart}
                    cartOpenMobile={false}
                    setCartOpenMobile={setCartOpenMobile}
                    updateCartQuantity={updateCartQuantity}
                    handleCheckout={handleCheckout}
                    checkoutLoading={checkoutLoading}
                    customerName={customerName}
                    setCustomerName={setCustomerName}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    filteredCustomers={filteredCustomers}
                    orderStatus={orderStatus}
                    setOrderStatus={setOrderStatus}
                />
            </div>

            {/* Mobile Cart Modal */}
            <AnimatePresence>
                {cartOpenMobile && (
                    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 lg:hidden">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-900">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <ShoppingCart className="text-primary" /> Current Order
                            </h2>
                            <button onClick={() => setCartOpenMobile(false)} className="text-slate-400 p-2"><X /></button>
                        </div>
                        <div className="flex-1 overflow-hidden flex flex-col">
                            <CartContent
                                cart={cart}
                                cartOpenMobile={true}
                                setCartOpenMobile={setCartOpenMobile}
                                updateCartQuantity={updateCartQuantity}
                                handleCheckout={handleCheckout}
                                checkoutLoading={checkoutLoading}
                                customerName={customerName}
                                setCustomerName={setCustomerName}
                                showSuggestions={showSuggestions}
                                setShowSuggestions={setShowSuggestions}
                                filteredCustomers={filteredCustomers}
                                orderStatus={orderStatus}
                                setOrderStatus={setOrderStatus}
                            />
                        </div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

function CreditCardIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></svg>
    )
}

// Helper Simple Icon
const ArrowRightIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </svg>
);

export default POSInterface;
