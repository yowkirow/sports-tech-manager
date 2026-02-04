import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2, Edit, X, Upload, Ruler, GripVertical } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { supabase } from '../../lib/supabaseClient';
import { useRawInventory, useProducts } from '../../hooks/useInventory';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['White', 'Black', 'Kiwi', 'Cream', 'Baby Blue'];



import { useActivityLog } from '../../hooks/useActivityLog';

export default function POSInterface({ transactions, onAddTransaction, onDeleteTransaction, userRole }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();

    const isReseller = userRole === 'reseller';
    const RESELLER_PRICE = 400; // Fixed price for resellers

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

    // Reorder State
    const [isReorderMode, setIsReorderMode] = useState(false);
    const [localOrderedProducts, setLocalOrderedProducts] = useState([]);

    // Checkout Meta State
    const [customerName, setCustomerName] = useState('');
    const [fulfillmentStatus, setFulfillmentStatus] = useState('pending');
    const [paymentStatus, setPaymentStatus] = useState('paid');
    const [paymentMode, setPaymentMode] = useState('Cash');
    const [showSuggestions, setShowSuggestions] = useState(false);

    const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];

    // Derived Data
    const rawInventory = useRawInventory(transactions);
    const products = useProducts(transactions);

    // Sync local order when products change (and not reordering)
    useMemo(() => {
        if (!isReorderMode) setLocalOrderedProducts(products); // Use raw products for ordering locally
    }, [products, isReorderMode]);

    // Filtering logic (Use local order if reordering, otherwise default)
    // APPLY RESELLER PRICING HERE
    const effectiveProducts = useMemo(() => {
        const base = isReorderMode ? localOrderedProducts : products;
        if (!isReseller) return base;

        return base.map(p => ({
            ...p,
            price: RESELLER_PRICE // Override Price
        }));
    }, [isReorderMode, localOrderedProducts, products, isReseller]);

    const filteredProducts = effectiveProducts.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Unique Customers for suggestions
    const uniqueCustomers = useMemo(() => {
        const names = new Set();
        transactions.forEach(t => { if (t.details?.customerName) names.add(t.details.customerName) });
        return Array.from(names);
    }, [transactions]);
    const filteredCustomers = uniqueCustomers.filter(c => c.toLowerCase().includes(customerName.toLowerCase()));

    // --- Logic Helpers ---

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
                    type: 'delete_product',
                    category: 'system',
                    amount: 0,
                    description: `Bulk Deleted: ${name}`,
                    date: new Date().toISOString(),
                    details: { name }
                });
            }
            await logActivity('Bulk Delete Products', { count: selectedProducts.size, currentProducts: Array.from(selectedProducts) });
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

    function updateCartQuantity(id, delta) {
        if (id === 'clear') {
            if (window.confirm('Clear current cart?')) setCart([]);
            return;
        }
        setCart(prev => {
            if (delta === -999) return prev.filter(item => item.cartId !== id);
            return prev.map(item => {
                if (item.cartId === id) return { ...item, quantity: Math.max(1, item.quantity + delta) };
                return item;
            });
        });
    }

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
            // Generate a unique Order ID for this entire cart
            const orderId = crypto.randomUUID();
            const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

            const { data: { user } } = await supabase.auth.getUser();

            for (const item of cart) {
                const isShirt = !!item.linkedColor;
                const transaction = {
                    id: crypto.randomUUID(),
                    type: 'sale',
                    amount: item.price * item.quantity,
                    category: isShirt ? 'blanks' : 'accessories',
                    date: new Date().toISOString(),
                    description: `Sold ${item.name} (${item.size})`,
                    details: {
                        orderId, // Link all items to this order
                        customerName,
                        fulfillmentStatus,
                        paymentStatus,
                        status: fulfillmentStatus, // Legacy support
                        paymentMode,
                        createdBy: user?.email || 'Unknown',
                        quantity: item.quantity,
                        itemName: item.name,
                        price: item.price,
                        imageUrl: item.imageUrl,
                        ...(isShirt && {
                            size: item.size,
                            color: item.linkedColor,
                            linkedColor: item.linkedColor
                        }),
                        ...(!isShirt && {
                            subCategory: item.name
                        })
                    }
                };
                await onAddTransaction(transaction);
            }

            await logActivity('POS Checkout', {
                customer: customerName,
                itemCount: cart.length,
                total: totalAmount,
                paymentMode
            }, orderId);

            showToast('Order Processed!', 'success');
            setCart([]);
            setCustomerName('');
            setFulfillmentStatus('pending');
            setPaymentStatus('paid');
        } catch (err) {
            console.error(err);
            showToast('Checkout Failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleMoveProduct = (index, direction) => {
        const newOrder = [...localOrderedProducts];
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= newOrder.length) return;

        // Swap
        [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
        setLocalOrderedProducts(newOrder);
    };

    const handleSaveOrder = async () => {
        if (!window.confirm('Save new product order?')) return;
        setCheckoutLoading(true);
        try {
            // Re-define all products with new 'order' index
            for (let i = 0; i < localOrderedProducts.length; i++) {
                const p = localOrderedProducts[i];
                await onAddTransaction({
                    id: crypto.randomUUID(),
                    type: 'define_product',
                    category: 'system',
                    amount: 0,
                    description: `Reorder: ${p.name}`,
                    date: new Date().toISOString(),
                    details: {
                        ...p,
                        order: i
                    }
                });
            }
            await logActivity('Reordered Products', { count: localOrderedProducts.length });
            showToast('Order Saved!', 'success');
            setIsReorderMode(false);
        } catch (err) {
            console.error(err);
            showToast('Failed to save order', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-120px)] relative">
            {showProductModal && (
                <ProductDefinitionModal
                    editingProduct={editingProduct}
                    onClose={() => setShowProductModal(false)}
                    onSave={async (formData) => {
                        setCheckoutLoading(true);
                        try {
                            // If renaming, delete the old one first
                            if (editingProduct && editingProduct.name !== formData.name) {
                                await onAddTransaction({
                                    id: crypto.randomUUID(),
                                    type: 'delete_product',
                                    category: 'system',
                                    amount: 0,
                                    description: `Renamed Product (Deleted Old): ${editingProduct.name}`,
                                    date: new Date().toISOString(),
                                    details: { name: editingProduct.name }
                                });
                            }

                            await onAddTransaction({
                                id: crypto.randomUUID(),
                                type: 'define_product',
                                category: 'system',
                                amount: 0,
                                description: `Defined Product: ${formData.name}`,
                                date: new Date().toISOString(),
                                details: {
                                    ...formData,
                                    order: editingProduct?.order // Persist existing order
                                }
                            });
                            showToast('Product Saved!', 'success');
                            setShowProductModal(false);
                        } catch (err) {
                            showToast(`Save Error: ${err.message}`, 'error');
                        } finally {
                            setCheckoutLoading(false);
                        }
                    }}
                    onDelete={async (productName) => {
                        setCheckoutLoading(true);
                        try {
                            const normalizedName = productName.trim().toLowerCase();

                            // Find ALL related transactions (Define, Reorder, Delete)
                            const relatedIds = transactions
                                .filter(t => {
                                    if (!t.details || !t.details.name) return false;
                                    return t.details.name.trim().toLowerCase() === normalizedName;
                                })
                                .map(t => t.id);

                            if (relatedIds.length === 0) {
                                showToast('No records found to delete', 'info');
                                return;
                            }

                            // Execute Hard Deletes
                            await Promise.all(relatedIds.map(id => onDeleteTransaction(id, true)));

                            showToast(`Product deleted (cleaned ${relatedIds.length} records)`, 'success');
                            setShowProductModal(false);
                            setEditingProduct(null);
                        } catch (err) {
                            showToast(`Delete Error: ${err.message}`, 'error');
                        } finally {
                            setCheckoutLoading(false);
                        }
                    }}
                />
            )}

            {activeProduct && (
                <SizeSelectorModal
                    activeProduct={activeProduct}
                    onClose={() => setActiveProduct(null)}
                    onSelectSize={(size) => addToCart(activeProduct, size)}
                    getStockForProduct={getStockForProduct}
                />
            )}

            {/* Product Grid Area */}
            <div className="flex-1 flex flex-col min-h-0 pb-20 lg:pb-0">
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
                            {isReorderMode ? (
                                <>
                                    <button
                                        onClick={handleSaveOrder}
                                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
                                    >
                                        <CheckCircle size={18} /> Save Order
                                    </button>
                                    <button
                                        onClick={() => setIsReorderMode(false)}
                                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl font-bold transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </>
                            ) : (
                                <>
                                    {!isReseller && (
                                        <>
                                            <button
                                                onClick={() => setIsSelectionMode(true)}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold border border-white/10 transition-colors"
                                            >
                                                Select
                                            </button>
                                            <button
                                                onClick={() => setIsReorderMode(true)}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold border border-white/10 transition-colors"
                                            >
                                                Reorder
                                            </button>
                                            <button
                                                onClick={() => { setEditingProduct(null); setShowProductModal(true); }}
                                                className="btn-secondary whitespace-nowrap"
                                            >
                                                <Plus size={20} /> <span className="hidden sm:inline">Define Product</span>
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4 content-start">
                    {!isSelectionMode && !isReorderMode && !isReseller && (
                        <div onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="glass-card flex flex-col items-center justify-center gap-4 border-dashed border-white/20 hover:border-primary/50 cursor-pointer min-h-[180px] sm:min-h-[220px] lg:min-h-[250px] group opacity-60 hover:opacity-100">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Plus size={20} className="text-slate-400 group-hover:text-primary" />
                            </div>
                            <span className="font-medium text-slate-400 text-sm sm:text-base">New Product</span>
                        </div>
                    )}

                    {isReorderMode ? (
                        <Reorder.Group axis="y" values={localOrderedProducts} onReorder={setLocalOrderedProducts}>
                            {localOrderedProducts.map(product => (
                                <Reorder.Item key={product.id} value={product} className="bg-white/5 mb-2 rounded-xl flex items-center p-2 cursor-grab active:cursor-grabbing border border-white/5 hover:border-white/20">
                                    <div className="p-2 text-slate-400">
                                        <GripVertical size={20} />
                                    </div>
                                    <div className="w-12 h-12 rounded bg-black/30 overflow-hidden shrink-0 mx-3">
                                        {product.imageUrl && <img src={product.imageUrl} className="w-full h-full object-cover" />}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-white">{product.name}</h3>
                                        <p className="text-xs text-primary">₱{product.price}</p>
                                    </div>
                                    <div className="text-xs text-slate-500 font-mono px-4">
                                        #{localOrderedProducts.indexOf(product) + 1}
                                    </div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    ) : (
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

                                    {/* Edit Button - Hide for resellers */}
                                    {!isSelectionMode && !isReseller && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setEditingProduct(product); setShowProductModal(true); }}
                                            className="absolute top-2 right-2 z-10 p-2 bg-black/60 hover:bg-primary rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all focus:opacity-100 lg:opacity-0"
                                        >
                                            <Edit size={14} />
                                        </button>
                                    )}

                                    {/* Cinematic Hover Overlay */}
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 flex flex-col items-center justify-center p-4 text-center backdrop-blur-[2px]">
                                        <h3 className="font-bold text-white text-lg leading-tight mb-2 drop-shadow-md">{product.name}</h3>
                                        <div className="bg-primary text-black text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1 shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                                            <Plus size={14} /> Quick Add
                                        </div>
                                    </div>

                                    <div className="aspect-[4/5] bg-black/40 relative overflow-hidden">
                                        {product.imageUrl ? (
                                            <img
                                                src={product.imageUrl}
                                                alt={product.name}
                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                onError={(e) => {
                                                    console.error("Image load failed:", product.name);
                                                    e.target.style.display = 'none';
                                                    const fb = e.target.parentElement.querySelector('.fallback-placeholder');
                                                    if (fb) fb.classList.remove('hidden');
                                                    if (fb) fb.classList.add('flex');
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center transition-colors"
                                                style={product.linkedColor ? {
                                                    backgroundColor:
                                                        product.linkedColor === 'White' ? '#f1f5f9' :
                                                            product.linkedColor === 'Black' ? '#1e293b' :
                                                                product.linkedColor === 'Kiwi' ? '#bef264' :
                                                                    product.linkedColor === 'Cream' ? '#fef3c7' :
                                                                        product.linkedColor === 'Baby Blue' ? '#bae6fd' : '#334155'
                                                } : {}}
                                            >
                                                {product.linkedColor ? (
                                                    <div className="opacity-50 transform group-hover:scale-110 transition-transform duration-500">
                                                        <svg width="60" height="60" viewBox="0 0 24 24" fill={product.linkedColor === 'Black' || product.linkedColor === 'Navy' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'} xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M20.38 3.46L16 2L13 3L12 3L11 3L8 2L3.62 3.46C3.2 3.6 2.93 4.02 2.98 4.45L3.81 11.36C3.86 11.41 3.91 11.45 3.97 11.5L6.61 13.56C7.03 13.96 7.74 13.91 8.1 13.43L9.17 12H9.27C9.27 12 14.83 12 14.83 12H14.93L16 13.43C16.36 13.91 17.07 13.95 17.49 13.56L20.13 11.5C20.19 11.45 20.24 11.41 20.29 11.36L21.12 4.45C21.17 4.02 20.9 3.6 20.48 3.46H20.38ZM17 11L14 11V21C14 21.55 13.55 22 13 22H11C10.45 22 10 21.55 10 21V11L7 11L6.72 5L9 5L12 5L15 5L17.28 5L17 11Z" />
                                                        </svg>
                                                    </div>
                                                ) : (
                                                    <Package size={32} className="opacity-50 text-slate-500" />
                                                )}
                                            </div>
                                        )}

                                        {/* Hidden Fallback for Error Case */}
                                        <div className="fallback-placeholder hidden w-full h-full absolute inset-0 flex-col items-center justify-center transition-colors"
                                            style={product.linkedColor ? {
                                                backgroundColor:
                                                    product.linkedColor === 'White' ? '#f1f5f9' :
                                                        product.linkedColor === 'Black' ? '#1e293b' :
                                                            product.linkedColor === 'Kiwi' ? '#bef264' :
                                                                product.linkedColor === 'Cream' ? '#fef3c7' :
                                                                    product.linkedColor === 'Baby Blue' ? '#bae6fd' : '#334155'
                                            } : {}}
                                        >
                                            <div className="flex flex-col items-center gap-2">
                                                <Package size={24} className="opacity-50 text-slate-500" />
                                                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Image Error</span>
                                            </div>
                                        </div>

                                        <div className="absolute bottom-2 left-2 z-20 bg-black/60 px-2 py-1 rounded text-[10px] text-white backdrop-blur-md">
                                            Uses: {product.linkedColor}
                                        </div>
                                    </div>
                                    <div className="p-3 sm:p-4 flex flex-col flex-1">
                                        <h3 className="font-semibold text-white leading-tight mb-1 line-clamp-2 text-sm sm:text-base">{product.name}</h3>
                                        <div className="mt-auto flex justify-between items-center">
                                            <span className="text-primary font-bold text-sm sm:text-base">₱{product.price}</span>
                                            <ArrowRightIcon className="text-white/20 group-hover:text-white transition-colors" />
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    )}
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

            {/* Desktop Cart Section */}
            <div className="hidden lg:flex w-full lg:w-[400px] glass-panel rounded-2xl flex-col h-full">
                <CartContent
                    cart={cart}
                    updateCartQuantity={updateCartQuantity}
                    handleCheckout={handleCheckout}
                    checkoutLoading={checkoutLoading}
                    customerName={customerName}
                    setCustomerName={setCustomerName}
                    fulfillmentStatus={fulfillmentStatus}
                    setFulfillmentStatus={setFulfillmentStatus}
                    paymentStatus={paymentStatus}
                    setPaymentStatus={setPaymentStatus}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    filteredCustomers={filteredCustomers}
                    isReseller={isReseller}
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
                                updateCartQuantity={updateCartQuantity}
                                handleCheckout={handleCheckout}
                                checkoutLoading={checkoutLoading}
                                customerName={customerName}
                                setCustomerName={setCustomerName}
                                fulfillmentStatus={fulfillmentStatus}
                                setFulfillmentStatus={setFulfillmentStatus}
                                paymentStatus={paymentStatus}
                                setPaymentStatus={setPaymentStatus}
                                showSuggestions={showSuggestions}
                                setShowSuggestions={setShowSuggestions}
                                filteredCustomers={filteredCustomers}
                                isReseller={isReseller}
                            />
                        </div>
                    </div>
                )}
            </AnimatePresence>
        </div >
    );
}

// --- Standalone Sub-Components ---

const ProductDefinitionModal = ({ editingProduct, onClose, onSave, onDelete }) => {
    const [form, setForm] = useState({
        name: editingProduct?.name || '',
        price: editingProduct?.price || 70,
        linkedColor: editingProduct?.linkedColor || 'Black',
        imageUrl: editingProduct?.imageUrl || null
    });
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);
    const { showToast } = useToast();

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        try {
            const ext = file.name.split('.').pop();
            const fileName = `${Date.now()}.${ext}`;
            const path = fileName;

            const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type
            });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('product-images').getPublicUrl(path);
            const publicUrl = data.publicUrl;

            showToast('Upload Verified!', 'success');
            setForm(p => ({ ...p, imageUrl: publicUrl }));
        } catch (err) {
            showToast(`Upload Error: ${err.message}`, 'error');
        } finally {
            setUploading(false);
        }
    };

    const handleConfirmDelete = () => {
        if (window.confirm(`Delete ${editingProduct.name}?`)) {
            onDelete(editingProduct.name);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-panel w-full max-w-md p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={24} /></button>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-400">Name</label>
                            <input className="glass-input mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sypik Classic" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-400">Price (₱)</label>
                            <input type="number" className="glass-input mt-1" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-slate-400">Raw Material (Inventory Link)</label>
                        <select className="glass-input mt-1" value={form.linkedColor} onChange={e => setForm({ ...form, linkedColor: e.target.value })}>
                            {COLORS.map(c => <option key={c} value={c} className="bg-slate-900">{c} Shirt</option>)}
                        </select>
                    </div>

                    <div className="flex gap-2 mt-4">
                        {editingProduct && (
                            <button onClick={handleConfirmDelete} className="px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20">
                                <Trash2 size={20} />
                            </button>
                        )}
                        <button onClick={() => onSave(form)} disabled={!form.name || uploading} className="btn-primary flex-1 py-3">
                            {uploading ? 'Uploading...' : 'Save Definition'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SizeSelectorModal = ({ activeProduct, onClose, onSelectSize, getStockForProduct }) => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4" onClick={onClose}>
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
                            onClick={() => onSelectSize(size)}
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

const CartContent = ({
    cart,
    updateCartQuantity,
    handleCheckout,
    checkoutLoading,
    customerName,
    setCustomerName,
    fulfillmentStatus,
    setFulfillmentStatus,
    paymentStatus,
    setPaymentStatus,
    paymentMode,
    setPaymentMode,
    showSuggestions,
    setShowSuggestions,
    filteredCustomers,
    isReseller
}) => (
    <div className="flex flex-col h-full">
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
                    <button onClick={() => updateCartQuantity(item.cartId, -999)} className="text-red-400 ml-2"><Trash2 size={16} /></button>
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

            <div className="flex flex-col sm:grid sm:grid-cols-2 gap-4">
                <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Payment Mode</label>
                    <select
                        className="glass-input py-2 text-sm w-full"
                        value={paymentMode}
                        onChange={e => setPaymentMode(e.target.value)}
                    >
                        {['Cash', 'Gcash', 'Bank Transfer', 'COD'].map(m => (
                            <option key={m} value={m} className="bg-slate-900">{m}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Payment Status</label>
                    <select
                        className="glass-input py-2 text-sm w-full capitalize"
                        value={paymentStatus}
                        onChange={e => setPaymentStatus(e.target.value)}
                    >
                        {['unpaid', 'paid'].map(s => (
                            <option key={s} value={s} className="bg-slate-900">{s}</option>
                        ))}
                    </select>
                </div>
                {!isReseller && (
                    <div className="col-span-1 sm:col-span-2">
                        <label className="text-xs text-slate-500 mb-1 block">Fulfillment</label>
                        <select
                            className="glass-input py-2 text-sm w-full capitalize"
                            value={fulfillmentStatus}
                            onChange={e => setFulfillmentStatus(e.target.value)}
                        >
                            {['pending', 'in_progress', 'ready', 'shipped'].map(s => (
                                <option key={s} value={s} className="bg-slate-900">{s.replace('_', ' ')}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <button onClick={handleCheckout} disabled={checkoutLoading || cart.length === 0} className="btn-primary w-full py-4 text-lg">
                {checkoutLoading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />} Checkout
            </button>
        </div >
    </div >
);

function CreditCardIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></svg>
    )
}

const ArrowRightIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </svg>
);
