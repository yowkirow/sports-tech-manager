import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, X, Plus, Minus, CheckCircle, Store, Search, Package } from 'lucide-react';
import { useProducts, useRawInventory } from '../../hooks/useInventory';
import { useToast } from '../ui/Toast';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

export default function Storefront({ transactions, onPlaceOrder }) {
    const { showToast } = useToast();
    const products = useProducts(transactions);
    const rawInventory = useRawInventory(transactions);

    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [activeProduct, setActiveProduct] = useState(null); // For size selection
    const [searchTerm, setSearchTerm] = useState('');

    // Checkout State
    const [customerName, setCustomerName] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [shippingAddress, setShippingAddress] = useState('');
    const [city, setCity] = useState('');
    const [province, setProvince] = useState('');
    const [zipCode, setZipCode] = useState('');
    const [paymentMode, setPaymentMode] = useState('Cash');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [orderComplete, setOrderComplete] = useState(false);

    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const getStock = (product, size) => {
        if (!product.linkedColor) return 999;
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
            return [...prev, { ...product, size, cartId, quantity: 1 }];
        });
        setActiveProduct(null);
        showToast('Added to cart', 'success');
    };

    const updateQuantity = (cartId, delta) => {
        setCart(prev => prev.map(item => {
            if (item.cartId === cartId) {
                const newQty = Math.max(0, item.quantity + delta);
                return { ...item, quantity: newQty };
            }
            return item;
        }).filter(i => i.quantity > 0));
    };

    const handleCheckout = async () => {
        if (!customerName) return showToast('Please enter your name', 'error');
        if (!shippingAddress || !city || !province || !contactNumber) return showToast('Please complete shipping details', 'error');
        setCheckoutLoading(true);

        try {
            const orderId = crypto.randomUUID();
            const date = new Date().toISOString();

            // Create transactions for each item
            const newTransactions = cart.map(item => ({
                id: crypto.randomUUID(),
                date,
                amount: item.price * item.quantity,
                type: 'sale',
                category: 'shirts', // Default
                description: `Online Order: ${item.name} (${item.size})`,
                details: {
                    orderId,
                    customerName,
                    contactNumber,
                    itemName: item.name,
                    size: item.size,
                    color: item.linkedColor || 'Varied',
                    quantity: item.quantity,
                    fulfillmentStatus: 'pending',
                    paymentStatus: 'unpaid',
                    status: 'pending', // Legacy support
                    paymentMode,
                    shippingDetails: {
                        address: shippingAddress,
                        city,
                        province,
                        zipCode,
                        contactNumber
                    },
                    imageUrl: item.imageUrl,
                    isOnlineOrder: true
                }
            }));

            // Submit all
            for (const t of newTransactions) {
                await onPlaceOrder(t);
            }

            setOrderComplete(true);
            setCart([]);
            // Reset after a delay or let them close
        } catch (err) {
            console.error(err);
            showToast('Order failed. Please try again.', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    if (orderComplete) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-center">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="glass-panel p-8 max-w-md w-full flex flex-col items-center"
                >
                    <div className="w-20 h-20 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mb-6">
                        <CheckCircle size={40} />
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Order Placed!</h2>
                    <p className="text-slate-400 mb-8">Thank you, {customerName}. We've received your order and will begin processing it shortly.</p>
                    <button
                        onClick={() => { setOrderComplete(false); setCustomerName(''); }}
                        className="btn-primary w-full py-3"
                    >
                        Place Another Order
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-primary/30">
            {/* Header */}
            <header className="h-16 border-b border-white/5 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-4 md:px-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                        <span className="font-bold text-xl italic">S</span>
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">SportsTech</h1>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest">Official Store</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setIsCartOpen(true)}
                        className="relative p-2 text-slate-400 hover:text-white transition-colors"
                    >
                        <ShoppingCart size={24} />
                        {cart.length > 0 && (
                            <span className="absolute top-0 right-0 w-5 h-5 bg-primary text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg">
                                {cart.reduce((a, b) => a + b.quantity, 0)}
                            </span>
                        )}
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">

                {/* Search */}
                <div className="mb-8 relative max-w-md mx-auto">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                    <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="glass-input pl-12 py-3 rounded-full w-full"
                    />
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 sm:gap-6">
                    {filteredProducts.map(product => (
                        <motion.div
                            key={product.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="glass-card p-0 overflow-hidden group cursor-pointer flex flex-col text-left"
                            onClick={() => setActiveProduct(product)}
                        >
                            <div className="aspect-[4/5] bg-black/40 relative overflow-hidden">
                                {product.imageUrl ? (
                                    <img
                                        src={product.imageUrl}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <Package size={40} />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                                    <span className="text-white font-bold flex items-center gap-2">
                                        <Plus size={16} /> Add to Cart
                                    </span>
                                </div>
                            </div>
                            <div className="p-4 flex flex-col flex-1">
                                <h3 className="font-bold text-white mb-1 line-clamp-2">{product.name}</h3>
                                <p className="text-primary font-bold mt-auto">₱{product.price}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {filteredProducts.length === 0 && (
                    <div className="text-center py-20 text-slate-500">
                        <Store size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No products found matching "{searchTerm}"</p>
                    </div>
                )}
            </main>

            {/* Size Selection Modal */}
            <AnimatePresence>
                {activeProduct && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setActiveProduct(null)}>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="glass-panel p-6 max-w-sm w-full relative"
                            onClick={e => e.stopPropagation()}
                        >
                            <button onClick={() => setActiveProduct(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={24} /></button>

                            <div className="flex gap-4 mb-6">
                                <div className="w-20 h-24 bg-black/40 rounded-lg overflow-hidden shrink-0">
                                    {activeProduct.imageUrl && <img src={activeProduct.imageUrl} className="w-full h-full object-cover" />}
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-white leading-tight mb-2">{activeProduct.name}</h3>
                                    <p className="text-primary font-bold text-xl">₱{activeProduct.price}</p>
                                </div>
                            </div>

                            <p className="text-xs font-bold text-slate-400 uppercase mb-3">Select Size</p>
                            <div className="grid grid-cols-4 gap-2">
                                {SIZES.map(size => {
                                    const stock = getStock(activeProduct, size);
                                    const hasStock = stock > 0;
                                    return (
                                        <button
                                            key={size}
                                            disabled={!hasStock}
                                            onClick={() => addToCart(activeProduct, size)}
                                            className={`p-3 rounded-xl border text-center transition-all ${hasStock
                                                ? 'border-white/10 hover:border-primary hover:bg-primary/20 text-white'
                                                : 'border-white/5 text-slate-600 bg-black/20 cursor-not-allowed'
                                                }`}
                                        >
                                            <div className="font-bold">{size}</div>
                                            <div className="text-[10px] mt-1 text-slate-500">{hasStock ? `${stock} left` : 'Out'}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Cart Modal */}
            <AnimatePresence>
                {isCartOpen && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-end">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsCartOpen(false)}
                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="relative w-full sm:max-w-md h-[80vh] sm:h-screen bg-slate-900 border-l border-white/10 shadow-2xl flex flex-col"
                        >
                            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-900/50 backdrop-blur-md">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <ShoppingCart className="text-primary" /> Your Cart
                                </h2>
                                <button onClick={() => setIsCartOpen(false)} className="text-slate-400 hover:text-white p-2"><X size={24} /></button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {cart.map(item => (
                                    <div key={item.cartId} className="flex gap-4 p-3 bg-white/5 rounded-xl">
                                        <div className="w-16 h-16 rounded-lg bg-black/20 overflow-hidden shrink-0">
                                            {item.imageUrl && <img src={item.imageUrl} className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-slate-200 truncate pr-2">{item.name}</h4>
                                                <p className="text-white font-mono">₱{item.price * item.quantity}</p>
                                            </div>
                                            <p className="text-xs text-slate-400 mb-2">Size: {item.size}</p>

                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center bg-black/40 rounded-lg p-1">
                                                    <button onClick={() => updateQuantity(item.cartId, -1)} className="p-1 hover:text-white text-slate-400"><Minus size={14} /></button>
                                                    <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                                                    <button onClick={() => updateQuantity(item.cartId, 1)} className="p-1 hover:text-white text-slate-400"><Plus size={14} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {cart.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                                        <ShoppingCart size={40} className="mb-4 opacity-50" />
                                        <p>Your cart is empty</p>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-white/10 bg-slate-900/50 backdrop-blur-md space-y-4">
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <input className="glass-input w-full py-3" placeholder="Name *" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                                        <input className="glass-input w-full py-3" placeholder="Contact # *" value={contactNumber} onChange={e => setContactNumber(e.target.value)} />
                                    </div>
                                    <input className="glass-input w-full py-3" placeholder="Street Address *" value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />
                                    <div className="grid grid-cols-2 gap-3">
                                        <input className="glass-input w-full py-3" placeholder="City *" value={city} onChange={e => setCity(e.target.value)} />
                                        <input className="glass-input w-full py-3" placeholder="Province *" value={province} onChange={e => setProvince(e.target.value)} />
                                    </div>
                                    <input className="glass-input w-full py-3" placeholder="Zip Code" value={zipCode} onChange={e => setZipCode(e.target.value)} />

                                    <select
                                        className="glass-input w-full py-3"
                                        value={paymentMode}
                                        onChange={e => setPaymentMode(e.target.value)}
                                    >
                                        <option value="Cash" className="bg-slate-900">Cash</option>
                                        <option value="Gcash" className="bg-slate-900">Gcash</option>
                                        <option value="Bank Transfer" className="bg-slate-900">Bank Transfer</option>
                                        <option value="COD" className="bg-slate-900">Cash on Delivery</option>
                                    </select>
                                </div>

                                <div className="flex justify-between items-center text-lg font-bold text-white pt-2">
                                    <span>Total</span>
                                    <span>₱{cart.reduce((a, b) => a + (b.price * b.quantity), 0).toLocaleString()}</span>
                                </div>

                                <button
                                    onClick={handleCheckout}
                                    disabled={cart.length === 0 || checkoutLoading}
                                    className="btn-primary w-full py-4 text-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {checkoutLoading ? 'Processing...' : 'Place Order'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
