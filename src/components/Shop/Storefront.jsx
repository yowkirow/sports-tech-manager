import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Component, Loader2, Upload, ShoppingCart, X, Plus, Minus, CheckCircle, Store, Search, Package, Clock, Ticket, Copy, ExternalLink, SearchCode, Phone } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useProducts, useRawInventory } from '../../hooks/useInventory';
import { useToast } from '../ui/Toast';
import { getMMCities, getAllProvinces, getCitiesByProvince, getBarangays } from '../../lib/phLocations';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

export default function Storefront({ transactions, onPlaceOrder }) {
    const { showToast } = useToast();
    const products = useProducts(transactions);
    const rawInventory = useRawInventory(transactions);

    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [activeProduct, setActiveProduct] = useState(null); // For size selection
    const [searchTerm, setSearchTerm] = useState('');
    const [lastOrderId, setLastOrderId] = useState('');
    const [showSizeGuide, setShowSizeGuide] = useState(false);
    const [isTrackModalOpen, setIsTrackModalOpen] = useState(false);
    const [trackingContact, setTrackingContact] = useState('');
    const [isSearchingOrder, setIsSearchingOrder] = useState(false);

    // Checkout State
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [shippingAddress, setShippingAddress] = useState(''); // Street

    // Address Selection State
    const [shippingRegion, setShippingRegion] = useState('MM');
    const [province, setProvince] = useState(''); // Name
    const [city, setCity] = useState(''); // Name
    const [barangay, setBarangay] = useState(''); // Name

    // Codes for fetching
    const [provinceCode, setProvinceCode] = useState('');
    const [cityCode, setCityCode] = useState('');

    // Data Lists
    const [provincesList, setProvincesList] = useState([]);
    const [citiesList, setCitiesList] = useState([]);
    const [barangaysList, setBarangaysList] = useState([]);

    const [paymentMode, setPaymentMode] = useState('COD');
    const [proofFile, setProofFile] = useState(null);
    const [proofUrl, setProofUrl] = useState('');
    const [uploadingProof, setUploadingProof] = useState(false);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [orderComplete, setOrderComplete] = useState(false);
    const [isRushOrder, setIsRushOrder] = useState(false);

    // Initial Fetch for Provinces & MM Cities
    React.useEffect(() => {
        const loadInitialData = async () => {
            if (shippingRegion === 'MM') {
                const mmCities = await getMMCities();
                setCitiesList(mmCities);
                setProvincesList([]);
                setProvince('Metro Manila');
            } else {
                const provs = await getAllProvinces();
                setProvincesList(provs);
                setCitiesList([]);
                setProvince('');
            }
            // Reset lower fields
            setCity('');
            setCityCode('');
            setBarangay('');
            setBarangaysList([]);
        };
        loadInitialData();
    }, [shippingRegion]);

    // Fetch Cities when Province Changes (Provincial only)
    React.useEffect(() => {
        if (shippingRegion === 'Provincial' && provinceCode) {
            const loadCities = async () => {
                const cities = await getCitiesByProvince(provinceCode);
                setCitiesList(cities);
                setCity('');
                setCityCode('');
                setBarangay('');
                setBarangaysList([]);
            };
            loadCities();
        }
    }, [provinceCode, shippingRegion]);

    // Fetch Barangays when City Changes
    React.useEffect(() => {
        if (cityCode) {
            const loadBarangays = async () => {
                const bgs = await getBarangays(cityCode);
                setBarangaysList(bgs);
                setBarangay('');
            };
            loadBarangays();
        }
    }, [cityCode]);

    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const getStock = (product, size) => {
        if (!product.linkedColor || product.category !== 'shirts') {
            // For accessories and equipment, look up stock via the acc-{name} key
            if (product.category && product.category !== 'shirts') {
                const key = `acc-${product.name.replace(/\s+/g, '-').toLowerCase()}`;
                // If it's an accessory, fallback to 999 if tracking isn't strictly set up yet
                return typeof rawInventory[key] === 'number' ? rawInventory[key] : 999;
            }
            return 999;
        }
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
        setShowSizeGuide(false);
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

    // Voucher logic
    const [voucherCode, setVoucherCode] = useState('');
    const [appliedVoucher, setAppliedVoucher] = useState(null);

    const subtotal = useMemo(() => cart.reduce((a, b) => a + (b.price * b.quantity), 0), [cart]);
    const totalItems = useMemo(() => cart.reduce((a, b) => a + b.quantity, 0), [cart]);
    const rushableItemsCount = useMemo(() => cart.reduce((total, item) => {
        const product = products.find(p => p.name === item.name);
        const isShirt = !product || !product.category || product.category === 'shirts';
        return isShirt ? total + item.quantity : total;
    }, 0), [cart, products]);
    const rushFeeAmount = isRushOrder ? rushableItemsCount * 100 : 0;

    // Suggestive selling
    const suggestedProducts = useMemo(() => {
        return products
            .filter(p => !cart.some(item => item.name === p.name)) // Exclude items already in cart
            .sort((a, b) => {
                // Priority to non-shirts (accessories, equipment)
                const aIsShirt = a.category === 'shirts' || !a.category;
                const bIsShirt = b.category === 'shirts' || !b.category;
                if (aIsShirt && !bIsShirt) return 1;
                if (!aIsShirt && bIsShirt) return -1;
                return 0; // Maintain original order otherwise
            })
            .slice(0, 4); // Take up to 4 items
    }, [products, cart]);

    // Derived discount
    const discountAmount = useMemo(() => {
        if (!appliedVoucher) return 0;
        if (appliedVoucher.discountType === 'percent') {
            return (subtotal * appliedVoucher.value) / 100;
        }
        return Math.min(appliedVoucher.value, subtotal);
    }, [subtotal, appliedVoucher]);

    const handleApplyVoucher = () => {
        if (!voucherCode.trim()) return;

        // Find voucher in transactions
        const voucherTx = transactions.find(t =>
            t.type === 'voucher' &&
            t.details.code.toUpperCase() === voucherCode.trim().toUpperCase()
        );

        if (!voucherTx || !voucherTx.details.active) {
            showToast('Invalid or inactive voucher', 'error');
            setAppliedVoucher(null);
            return;
        }

        const details = voucherTx.details;

        // check expiry
        if (details.expiryDate) {
            const expiry = new Date(details.expiryDate);
            const now = new Date();
            // Reset times for accurate date comparison
            expiry.setHours(23, 59, 59, 999);
            if (now > expiry) {
                showToast('Voucher has expired', 'error');
                return;
            }
        }

        // check usage limit
        if (details.usageLimit) {
            const uniqueUses = new Set(
                transactions
                    .filter(tr => tr.type === 'sale' && tr.details?.voucherCode === details.code)
                    .map(tr => tr.details.orderId)
            ).size;

            if (uniqueUses >= details.usageLimit) {
                showToast('Voucher usage limit reached', 'error');
                return;
            }
        }

        setAppliedVoucher(details);
        showToast(`Voucher applied: ${details.code}`, 'success');
    };

    const handleRemoveVoucher = () => {
        setAppliedVoucher(null);
        setVoucherCode('');
    };

    const handleUploadProof = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploadingProof(true);
        try {
            const ext = file.name.split('.').pop();
            const fileName = `receipt-${Date.now()}.${ext}`;
            const path = fileName;

            const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type
            });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('product-images').getPublicUrl(path);
            setProofUrl(data.publicUrl);
            setProofFile(file);
            showToast('Receipt uploaded!', 'success');
        } catch (err) {
            console.error(err);
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            setUploadingProof(false);
        }
    };

    const generateOrderId = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous characters
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `ST-${result}`;
    };

    const handleCheckout = async () => {
        if (!firstName.trim()) return showToast('Please enter your first name', 'error');
        if (!lastName.trim()) return showToast('Please enter your last name', 'error');
        if (!contactNumber.trim()) return showToast('Please enter your contact number', 'error');
        if (!shippingAddress || !city || (shippingRegion === 'Provincial' && !province) || !barangay) return showToast('Please complete shipping details', 'error');

        const customerName = `${firstName.trim()} ${lastName.trim()}`;

        // Payment Validation
        const requiresProof = ['Gcash', 'Bank Transfer'].includes(paymentMode);
        if (requiresProof && !proofUrl) return showToast('Please upload proof of payment', 'error');

        setCheckoutLoading(true);

        try {
            const orderId = generateOrderId();
            const date = new Date().toISOString();

            const shippingFee = shippingRegion === 'MM' ? 100 : 200;

            // Create transactions for each item
            const newTransactions = cart.map(item => {
                const itemTotal = item.price * item.quantity;
                const ratio = itemTotal / subtotal;
                const itemDiscount = discountAmount * ratio;
                const itemRushFee = isRushOrder ? item.quantity * 100 : 0;
                // Add rush fee to the final amount so it gets tallied correctly as revenue
                const finalAmount = (itemTotal - itemDiscount) + itemRushFee;

                return {
                    id: crypto.randomUUID(),
                    date,
                    amount: finalAmount, // Discounted amount for revenue tracking
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
                        paymentStatus: 'unpaid', // Default to unpaid for checks
                        status: 'pending', // Legacy support
                        paymentMode,
                        shippingDetails: {
                            address: shippingAddress,
                            city,
                            province,
                            barangay,
                            // zipCode, // Removed
                            contactNumber,
                            region: shippingRegion,
                            shippingFee,
                            isRushOrder,
                            rushFee: itemRushFee
                        },
                        voucherCode: appliedVoucher ? appliedVoucher.code : null,
                        discountShare: itemDiscount,
                        originalAmount: itemTotal,
                        imageUrl: item.imageUrl,
                        isOnlineOrder: true,
                        proofOfPayment: requiresProof ? proofUrl : null
                    }
                };
            });

            // Submit all
            for (const t of newTransactions) {
                await onPlaceOrder(t);
            }

            setOrderComplete(true);
            setLastOrderId(orderId);
            setCart([]);
            // Reset after a delay or let them close
        } catch (err) {
            console.error(err);
            showToast('Order failed. Please try again.', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleTrackOrder = async () => {
        if (!trackingContact.trim()) return showToast('Please enter your contact number', 'error');

        setIsSearchingOrder(true);
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('details')
                .eq('details->>contactNumber', trackingContact.trim())
                .eq('type', 'sale')
                .order('date', { ascending: false })
                .limit(1);

            if (error) throw error;
            if (!data || data.length === 0) {
                showToast('No order found with this contact number', 'error');
                return;
            }

            const orderId = data[0].details.orderId;
            setIsTrackModalOpen(false);
            window.location.href = `/track/${orderId}`;
        } catch (err) {
            console.error(err);
            showToast('Search failed. Please try again.', 'error');
        } finally {
            setIsSearchingOrder(false);
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
                    <p className="text-slate-400 mb-6">Thank you, {firstName}. We've received your order and will begin processing it shortly.</p>

                    <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-4 mb-8 text-left">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Your Tracking Link</p>
                        <div className="flex items-center gap-3">
                            <div className="flex-1 text-xs font-mono text-primary truncate bg-black/40 p-2 rounded-lg border border-white/5">
                                {window.location.origin}/track/{lastOrderId}
                            </div>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/track/${lastOrderId}`);
                                    showToast('Tracking link copied!', 'success');
                                }}
                                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors border border-white/5"
                                title="Copy Link"
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-2 italic">* Use your contact number to verify and track in real-time.</p>
                    </div>

                    <div className="flex flex-col w-full gap-3">
                        <button
                            onClick={() => window.location.href = `/track/${lastOrderId}`}
                            className="bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all border border-white/10"
                        >
                            <ExternalLink size={18} /> View Status Now
                        </button>
                        <button
                            onClick={() => { setOrderComplete(false); setFirstName(''); setLastName(''); setLastOrderId(''); }}
                            className="btn-primary w-full py-3"
                        >
                            Place Another Order
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-primary/30">
            {/* Header */}
            <header className="h-20 border-b border-white/5 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-4 md:px-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="SportsTech" className="h-14 w-auto object-contain" />
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setIsTrackModalOpen(true)}
                        className="p-2 text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                        title="Track My Order"
                    >
                        <SearchCode size={24} />
                        <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider">Track</span>
                    </button>

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
                            onClick={() => {
                                if (product.category && product.category !== 'shirts') {
                                    addToCart(product, 'N/A');
                                } else {
                                    setActiveProduct(product);
                                }
                            }}
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
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setActiveProduct(null)}>
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

                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-slate-400 uppercase">Select Size</p>
                                <button
                                    onClick={() => setShowSizeGuide(!showSizeGuide)}
                                    className="text-[10px] font-bold text-primary hover:underline uppercase tracking-wider"
                                >
                                    {showSizeGuide ? 'Hide Size Guide' : 'Size Guide'}
                                </button>
                            </div>

                            <AnimatePresence>
                                {showSizeGuide && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden mb-4"
                                    >
                                        <div className="bg-black/40 rounded-xl border border-white/5 p-3">
                                            <table className="w-full text-[11px] text-center">
                                                <thead>
                                                    <tr className="text-slate-500 border-b border-white/5">
                                                        <th className="pb-2 font-bold uppercase">Size</th>
                                                        <th className="pb-2 font-bold uppercase">Chest</th>
                                                        <th className="pb-2 font-bold uppercase">Height</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-slate-300">
                                                    {[
                                                        { s: 'XS', c: '18"', h: '25"' },
                                                        { s: 'S', c: '19"', h: '26"' },
                                                        { s: 'M', c: '20"', h: '27"' },
                                                        { s: 'L', c: '21"', h: '28"' },
                                                        { s: 'XL', c: '22"', h: '29"' },
                                                        { s: '2XL', c: '23"', h: '30"' },
                                                    ].map((row) => (
                                                        <tr key={row.s} className="border-b border-white/5 last:border-0">
                                                            <td className="py-2 font-bold text-white">{row.s}</td>
                                                            <td className="py-2">{row.c}</td>
                                                            <td className="py-2">{row.h}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            <p className="text-[9px] text-slate-500 mt-2 text-center italic">All measurements are in inches</p>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <div className="grid grid-cols-4 gap-2">
                                {SIZES.map(size => {
                                    const stock = getStock(activeProduct, size);
                                    const hasStock = stock > 0;
                                    return (
                                        <button
                                            key={size}
                                            onClick={() => addToCart(activeProduct, size)}
                                            className="p-3 rounded-xl border text-center transition-all border-white/10 hover:border-primary hover:bg-primary/20 text-white"
                                        >
                                            <div className="font-bold">{size}</div>
                                            <div className="text-[10px] mt-1 text-slate-500">Available</div>
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
                            className="relative w-full sm:max-w-md h-[100dvh] bg-slate-900 border-l border-white/10 shadow-2xl flex flex-col"
                        >
                            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-900/50 backdrop-blur-md">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <ShoppingCart className="text-primary" /> Your Cart
                                </h2>
                                <button onClick={() => setIsCartOpen(false)} className="text-slate-400 hover:text-white p-2"><X size={24} /></button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                {/* Cart Items */}
                                <div className="space-y-4">
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
                                                {item.size !== 'N/A' && (
                                                    <p className="text-xs text-slate-400 mb-2">Size: {item.size}</p>
                                                )}

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

                                    {suggestedProducts.length > 0 && (
                                        <div className="mt-6 pt-4 border-t border-white/5">
                                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">You May Also Like</h3>
                                            <div className="flex gap-4 overflow-x-auto pb-4 snap-x hide-scrollbar">
                                                {suggestedProducts.map(product => (
                                                    <div key={product.id} className="min-w-[140px] max-w-[140px] bg-white/5 border border-white/10 rounded-xl flex flex-col overflow-hidden shrink-0 snap-center">
                                                        <div className="w-full h-24 bg-black/20 relative">
                                                            {product.imageUrl ? (
                                                                <img src={product.imageUrl} className="w-full h-full object-cover" alt={product.name} />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-slate-500"><Package size={24} /></div>
                                                            )}
                                                        </div>
                                                        <div className="p-3 flex flex-col flex-1">
                                                            <h4 className="text-xs font-bold text-white line-clamp-2 mb-1 min-h-[32px]">{product.name}</h4>
                                                            <p className="text-xs text-primary font-bold mb-3 mt-auto">₱{product.price}</p>
                                                            <button
                                                                onClick={() => {
                                                                    if (product.category && product.category !== 'shirts') {
                                                                        addToCart(product, 'N/A');
                                                                    } else {
                                                                        setActiveProduct(product);
                                                                    }
                                                                }}
                                                                className="w-full py-2 bg-white/10 hover:bg-primary hover:text-white transition-colors text-[10px] font-bold uppercase rounded-lg border border-white/5"
                                                            >
                                                                Quick Add
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Shipping & Payment Form (Scrollable) */}
                                {cart.length > 0 && (
                                    <div className="space-y-3 pt-4 border-t border-white/5">
                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Shipping Details</h3>

                                        <div className="grid grid-cols-2 gap-3">
                                            <input className="glass-input w-full py-3" placeholder="First Name *" value={firstName} onChange={e => setFirstName(e.target.value)} />
                                            <input className="glass-input w-full py-3" placeholder="Last Name *" value={lastName} onChange={e => setLastName(e.target.value)} />
                                        </div>
                                        <input className="glass-input w-full py-3" placeholder="Contact # (Required) *" value={contactNumber} onChange={e => setContactNumber(e.target.value)} />
                                        <input className="glass-input w-full py-3" placeholder="Street Address *" value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />

                                        {/* Region & City Selection */}
                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                                            <label className="text-xs text-slate-400 font-bold block uppercase tracking-wider">Shipping Area</label>

                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => setShippingRegion('MM')}
                                                    className={`flex-1 py-4 px-3 rounded-xl text-sm font-bold transition-all border-2 flex flex-col items-center gap-2 ${shippingRegion === 'MM'
                                                        ? 'bg-primary/20 border-primary text-primary'
                                                        : 'bg-black/40 border-white/5 text-slate-400 hover:border-white/20 hover:bg-white/5'
                                                        }`}
                                                >
                                                    <span className="text-lg">🏙️</span>
                                                    Metro Manila
                                                </button>
                                                <button
                                                    onClick={() => setShippingRegion('Provincial')}
                                                    className={`flex-1 py-4 px-3 rounded-xl text-sm font-bold transition-all border-2 flex flex-col items-center gap-2 ${shippingRegion === 'Provincial'
                                                        ? 'bg-amber-500/20 border-amber-500 text-amber-500'
                                                        : 'bg-black/40 border-white/5 text-slate-400 hover:border-white/20 hover:bg-white/5'
                                                        }`}
                                                >
                                                    <span className="text-lg">🏝️</span>
                                                    Outside MM
                                                </button>
                                            </div>

                                            {/* Dynamic Address Selectors */}
                                            <div className="space-y-3">
                                                {shippingRegion === 'Provincial' && (
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-slate-500 ml-1">Province</label>
                                                        <select
                                                            className="glass-input w-full py-3"
                                                            value={provinceCode}
                                                            onChange={e => {
                                                                const code = e.target.value;
                                                                const name = e.target.options[e.target.selectedIndex].text;
                                                                setProvinceCode(code);
                                                                setProvince(name);
                                                            }}
                                                        >
                                                            <option value="" disabled>Select Province *</option>
                                                            {provincesList.map(p => <option key={p.code} value={p.code} className="bg-slate-900">{p.name}</option>)}
                                                        </select>
                                                    </div>
                                                )}

                                                <div className="space-y-1">
                                                    <label className="text-xs text-slate-500 ml-1">City / Municipality</label>
                                                    <select
                                                        className="glass-input w-full py-3"
                                                        value={cityCode}
                                                        onChange={e => {
                                                            const code = e.target.value;
                                                            const name = e.target.options[e.target.selectedIndex].text;
                                                            setCityCode(code);
                                                            setCity(name);
                                                        }}
                                                        disabled={!citiesList.length}
                                                    >
                                                        <option value="" disabled>Select City *</option>
                                                        {citiesList.map(c => <option key={c.code} value={c.code} className="bg-slate-900">{c.name}</option>)}
                                                    </select>
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-xs text-slate-500 ml-1">Barangay</label>
                                                    <select
                                                        className="glass-input w-full py-3"
                                                        value={barangay}
                                                        onChange={e => setBarangay(e.target.value)}
                                                        disabled={!barangaysList.length}
                                                    >
                                                        <option value="" disabled>Select Barangay *</option>
                                                        {barangaysList.map(b => <option key={b.code} value={b.name} className="bg-slate-900">{b.name}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-start gap-2 text-xs text-slate-300 bg-black/20 p-3 rounded-lg border border-white/5">
                                                    <Store size={14} className="shrink-0 mt-0.5 text-primary" />
                                                    <div>
                                                        <p className="font-bold text-white mb-1">Standard Shipping: LBC</p>
                                                        <p className="opacity-80">
                                                            {shippingRegion === 'MM' ? "₱100 Fixed Rate" : "₱200 Fixed Rate"}
                                                        </p>
                                                        <p className="mt-1 text-[10px] text-slate-500 italic">
                                                            *For other couriers (J&T, Lalamove), buyer shoulders the cost.
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                                                    <Clock size={14} className="shrink-0 mt-0.5" />
                                                    <div>
                                                        <p className="font-bold text-amber-400 mb-1">Shipping Schedule</p>
                                                        <p>Cutoff: Every <span className="font-bold underline">Thursday</span></p>
                                                        <p>Shipping Day: Every <span className="font-bold underline">Sunday</span></p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-2 mt-4">
                                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Order Options</h3>
                                            <label className="flex items-center gap-3 cursor-pointer p-2 hover:bg-white/5 rounded-lg transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={isRushOrder}
                                                    onChange={(e) => setIsRushOrder(e.target.checked)}
                                                    className="w-5 h-5 rounded border-gray-300 text-primary accent-primary"
                                                />
                                                <div>
                                                    <span className="text-sm text-white font-bold block">Rush Order (Priority Processing)</span>
                                                    <span className="text-xs text-slate-400">₱100 additional fee per shirt</span>
                                                </div>
                                            </label>
                                        </div>

                                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">Payment</h3>
                                        <select
                                            className="glass-input w-full py-3"
                                            value={paymentMode}
                                            onChange={e => setPaymentMode(e.target.value)}
                                        >
                                            <option value="COD" className="bg-slate-900">Cash on Delivery</option>
                                            <option value="Gcash" className="bg-slate-900">Gcash</option>
                                            <option value="Bank Transfer" className="bg-slate-900">Bank Transfer</option>
                                        </select>

                                        {['Gcash', 'Bank Transfer'].includes(paymentMode) && (
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="mt-4 p-4 bg-white rounded-2xl flex flex-col items-center gap-2 shadow-2xl"
                                            >
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Scan to Pay Now</p>
                                                <div className="bg-white p-1 rounded-lg">
                                                    <img
                                                        src="/payment-qr.jpeg"
                                                        alt="Payment QR"
                                                        className="w-full max-w-[180px] h-auto rounded-md shadow-sm"
                                                        onError={(e) => {
                                                            e.currentTarget.style.display = 'none';
                                                            const parent = e.currentTarget.parentElement;
                                                            if (parent) parent.innerHTML = '<div class="p-6 text-slate-400 text-[10px] text-center font-sans uppercase tracking-tighter">QR Unavailable</div>';
                                                        }}
                                                    />
                                                </div>
                                                <p className="text-[9px] text-slate-400 text-center font-medium">Verify "Sports Tech" name before paying</p>
                                            </motion.div>
                                        )}

                                        {['Gcash', 'Bank Transfer'].includes(paymentMode) && (
                                            <div className="mt-4 p-4 border border-dashed border-white/20 rounded-xl bg-white/5">
                                                <p className="text-xs text-slate-400 mb-2 font-bold uppercase">Proof of Payment</p>

                                                {proofUrl ? (
                                                    <div className="relative">
                                                        <img src={proofUrl} alt="Proof" className="w-full max-h-48 object-contain rounded-lg bg-black/50" />
                                                        <button
                                                            onClick={() => { setProofUrl(''); setProofFile(null); }}
                                                            className="absolute top-2 right-2 p-1 bg-red-500 rounded-full text-white hover:bg-red-600 transition-colors"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <label className="flex flex-col items-center justify-center p-6 cursor-pointer hover:bg-white/5 transition-colors rounded-lg">
                                                        {uploadingProof ? (
                                                            <>
                                                                <Loader2 className="animate-spin text-primary mb-2" />
                                                                <span className="text-xs text-slate-400">Uploading...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Upload className="text-slate-400 mb-2" />
                                                                <span className="text-xs text-slate-400">Click to upload receipt</span>
                                                            </>
                                                        )}
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={handleUploadProof}
                                                            disabled={uploadingProof}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}


                                <div className="p-6 border-t border-white/10 bg-slate-900/50 backdrop-blur-md space-y-3">
                                    <div className="space-y-1 text-sm text-slate-400">
                                        <div className="flex justify-between">
                                            <span>Subtotal</span>
                                            <span>₱{subtotal.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Shipping ({shippingRegion === 'MM' ? 'MM' : 'Provincial'})</span>
                                            <span>₱{shippingRegion === 'MM' ? 100 : 200}</span>
                                        </div>
                                        {appliedVoucher && (
                                            <div className="flex justify-between text-emerald-400 font-bold">
                                                <span>Voucher ({appliedVoucher.code})</span>
                                                <span>-₱{discountAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                            </div>
                                        )}
                                        {isRushOrder && (
                                            <div className="flex justify-between text-amber-400">
                                                <span>Rush Fee (₱100/shirt x {totalItems})</span>
                                                <span>₱{rushFeeAmount}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Voucher Input */}
                                    <div className="py-2 border-t border-white/5 border-dashed">
                                        {!appliedVoucher ? (
                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                                    <input
                                                        placeholder="Voucher Code"
                                                        value={voucherCode}
                                                        onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                                                        className="glass-input pl-9 py-2 text-sm w-full uppercase"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleApplyVoucher}
                                                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors"
                                                >
                                                    Apply
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-between items-center bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg">
                                                <span className="text-xs text-emerald-400 font-bold flex items-center gap-2">
                                                    <CheckCircle size={14} /> Code Applied
                                                </span>
                                                <button onClick={handleRemoveVoucher} className="text-slate-400 hover:text-white p-1"><X size={14} /></button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex justify-between items-center text-xl font-bold text-white pt-2 border-t border-white/5">
                                        <span>Total</span>
                                        <span>₱{(subtotal - discountAmount + (shippingRegion === 'MM' ? 100 : 200) + rushFeeAmount).toLocaleString()}</span>
                                    </div>

                                    <button
                                        onClick={handleCheckout}
                                        disabled={cart.length === 0 || checkoutLoading}
                                        className="btn-primary w-full py-4 text-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {checkoutLoading ? 'Processing...' : 'Place Order'}
                                    </button>
                                    <div className="h-6 sm:hidden" /> {/* Spacer for bottom navs */}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
            {/* Tracking Lookup Modal */}
            <AnimatePresence>
                {isTrackModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setIsTrackModalOpen(false)}>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="glass-panel p-6 max-w-sm w-full relative"
                            onClick={e => e.stopPropagation()}
                        >
                            <button onClick={() => setIsTrackModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={24} /></button>

                            <div className="text-center mb-6">
                                <div className="w-16 h-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center mx-auto mb-4">
                                    <SearchCode size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-white">Track Your Order</h3>
                                <p className="text-sm text-slate-400 mt-1">Enter the mobile number used during checkout.</p>
                            </div>

                            <div className="space-y-4">
                                <div className="relative">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="tel"
                                        placeholder="Mobile Number (e.g. 09123456789)"
                                        value={trackingContact}
                                        onChange={e => setTrackingContact(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleTrackOrder()}
                                        className="glass-input pl-12 py-3 rounded-xl w-full"
                                    />
                                </div>
                                <button
                                    onClick={handleTrackOrder}
                                    disabled={isSearchingOrder}
                                    className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                                >
                                    {isSearchingOrder ? <Loader2 className="animate-spin" size={18} /> : 'Find My Order'}
                                </button>
                            </div>

                            <p className="text-[10px] text-slate-500 mt-4 text-center italic">
                                * This will find your most recent order.
                            </p>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
