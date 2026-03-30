import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2, Edit, X, Upload, Ruler, GripVertical } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { supabase } from '../../lib/supabaseClient';
import { useRawInventory, useProducts, useColors, useBrands } from '../../hooks/useInventory';
import useSupabaseCustomers from '../../hooks/useSupabaseCustomers';
import { getMMCities, getAllProvinces, getCitiesByProvince, getBarangays } from '../../lib/phLocations';
import { useActivityLog } from '../../hooks/useActivityLog';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

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
    const [customerContact, setCustomerContact] = useState('');
    const [customerAddress, setCustomerAddress] = useState('');
    const [customerProvince, setCustomerProvince] = useState('');
    const [customerBarangay, setCustomerBarangay] = useState('');
    const [fulfillmentStatus, setFulfillmentStatus] = useState('pending');
    const [paymentStatus, setPaymentStatus] = useState('paid');
    const [paymentMode, setPaymentMode] = useState('Cash');

    // Customer Search State
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [customerSuggestions, setCustomerSuggestions] = useState([]);
    const { searchCustomers, upsertCustomer } = useSupabaseCustomers();

    // Debounced Search
    React.useEffect(() => {
        const timer = setTimeout(async () => {
            if (showSuggestions && customerName.length > 1) {
                const results = await searchCustomers(customerName);
                if (results) setCustomerSuggestions(results);
                else setCustomerSuggestions([]);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [customerName, showSuggestions, searchCustomers]);

    // Location State
    const [shippingRegion, setShippingRegion] = useState('MM');
    const [customerCity, setCustomerCity] = useState('');
    const [provinceCode, setProvinceCode] = useState('');
    const [cityCode, setCityCode] = useState('');

    const [provincesList, setProvincesList] = useState([]);
    const [citiesList, setCitiesList] = useState([]);
    const [barangaysList, setBarangaysList] = useState([]);

    // Initial Fetch for Provinces & MM Cities
    React.useEffect(() => {
        const loadInitialData = async () => {
            if (shippingRegion === 'MM') {
                const mmCities = await getMMCities();
                setCitiesList(mmCities);
                setProvincesList([]);
                setCustomerProvince('Metro Manila');
            } else {
                const provs = await getAllProvinces();
                setProvincesList(provs);
                setCitiesList([]);
                setCustomerProvince('');
            }
            // Reset downstream
            if (shippingRegion !== 'MM') {
                setCityCode('');
                setCustomerCity('');
                setCustomerBarangay('');
            }
        };
        loadInitialData();
    }, [shippingRegion]);

    // Fetch Cities when Province Changes
    React.useEffect(() => {
        if (provinceCode && shippingRegion === 'Provincial') {
            const loadCities = async () => {
                const cities = await getCitiesByProvince(provinceCode);
                setCitiesList(cities);
                setCityCode('');
                setCustomerCity('');
                setBarangaysList([]);
            };
            loadCities();
        }
    }, [provinceCode, shippingRegion]);

    // Fetch Barangays when City Changes
    React.useEffect(() => {
        if (cityCode) {
            const loadBarangays = async () => {
                const brgys = await getBarangays(cityCode);
                setBarangaysList(brgys);
                setCustomerBarangay('');
            };
            loadBarangays();
        }
    }, [cityCode]);


    const handleSelectCustomer = (c) => {
        setCustomerName(c.name);
        setCustomerContact(c.contact_number || '');
        setCustomerAddress(c.address || ''); // This might be a legacy string address
        setShowSuggestions(false);
    };

    const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];

    // Derived Data
    const rawInventory = useRawInventory(transactions);
    const products = useProducts(transactions);
    const colors = useColors(transactions);
    const brands = useBrands(transactions);

    // Sync local order when products change (and not reordering)
    useMemo(() => {
        if (!isReorderMode) setLocalOrderedProducts(products); // Use raw products for ordering locally
    }, [products, isReorderMode]);

    // Filtering logic (Use local order if reordering, otherwise default)
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
        if (product.category !== 'shirts') return 999;
        const brand = (product.brand || 'Sypik').toLowerCase();
        const color = (product.linkedColor || 'Black').toLowerCase();
        const key = `shirt-${brand}-${color}-${size.toLowerCase()}`;
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
        if (cart.length === 0) {
            showToast('Cart is empty', 'error');
            return;
        }
        if (!customerName.trim()) {
            showToast('Enter customer name', 'error');
            return;
        }

        setCheckoutLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();

            const totalAmount = cart.reduce((a, b) => a + (b.price * b.quantity), 0);

            // Upsert Customer (Save for next time)
            if (customerName) {
                const fullAddress = `${customerAddress}${customerBarangay ? ', ' + customerBarangay : ''}${customerCity ? ', ' + customerCity : ''}${customerProvince ? ', ' + customerProvince : ''}`;
                await upsertCustomer({
                    name: customerName,
                    contact_number: customerContact,
                    address: fullAddress,
                    total_spent: totalAmount
                });
            }

            const transactionData = {
                id: crypto.randomUUID(),
                type: 'sale',
                category: 'Sales',
                amount: totalAmount,
                date: new Date().toISOString(),
                description: `POS Sale - ${customerName || 'Walk-in'}`,
                details: {
                    items: cart.map(item => ({
                        id: item.id,
                        name: item.name,
                        brand: item.brand,
                        price: item.price,
                        quantity: item.quantity,
                        size: item.size,
                        color: item.linkedColor,
                        imageUrl: item.imageUrl
                    })),
                    customer: customerName,
                    customerContact,
                    customerAddress,
                    shippingRegion,
                    customerProvince,
                    customerCity,
                    customerBarangay,
                    paymentMode,
                    paymentStatus,
                    fulfillmentStatus,
                    createdBy: user?.email || 'Unknown',
                    userRole: userRole
                }
            };

            await onAddTransaction(transactionData);

            await logActivity('POS Checkout', {
                customer: customerName,
                itemCount: cart.length,
                total: totalAmount,
                paymentMode
            }, transactionData.id);

            showToast('Order Processed!', 'success');
            setPaymentMode('Cash');
            setCustomerName('');
            setCustomerContact('');
            setCustomerAddress('');
            setCustomerProvince('');
            setCustomerCity('');
            setCustomerBarangay('');
            setProvinceCode('');
            setCityCode('');
            setCart([]);
        } catch (err) {
            console.error(err);
            showToast('Checkout Failed', 'error');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleSaveOrder = async () => {
        if (!window.confirm('Save new product order?')) return;
        setCheckoutLoading(true);
        try {
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
                    colors={colors}
                    brands={brands}
                    onClose={() => setShowProductModal(false)}
                    onSave={async (formData) => {
                        setCheckoutLoading(true);
                        try {
                            if (editingProduct && editingProduct.name !== formData.name) {
                                await onAddTransaction({
                                    id: crypto.randomUUID(),
                                    type: 'delete_product',
                                    category: 'system',
                                    amount: 0,
                                    description: `Renamed Product(Deleted Old): ${editingProduct.name}`,
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
                                    order: editingProduct?.order
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
                            const relatedIds = transactions
                                .filter(t => t.details?.name?.trim().toLowerCase() === normalizedName)
                                .map(t => t.id);

                            if (relatedIds.length === 0) {
                                showToast('No records found to delete', 'info');
                                return;
                            }

                            await Promise.all(relatedIds.map(id => onDeleteTransaction(id, true)));
                            showToast(`Product deleted(cleaned ${relatedIds.length} records)`, 'success');
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

                    <div className="flex gap-2">
                        {!isReseller && !isSelectionMode && !isReorderMode && (
                            <>
                                <button onClick={() => setIsSelectionMode(true)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold border border-white/10 transition-colors">Select</button>
                                <button onClick={() => setIsReorderMode(true)} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold border border-white/10 transition-colors">Reorder</button>
                                <button onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="btn-secondary whitespace-nowrap"><Plus size={20} /> <span className="hidden sm:inline">Define Product</span></button>
                            </>
                        )}
                        {isSelectionMode && (
                            <div className="flex gap-2">
                                <button onClick={handleBulkDelete} disabled={selectedProducts.size === 0} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors flex items-center gap-2"><Trash2 size={18} /> Delete ({selectedProducts.size})</button>
                                <button onClick={() => { setIsSelectionMode(false); setSelectedProducts(new Set()); }} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors">Cancel</button>
                            </div>
                        )}
                        {isReorderMode && (
                            <div className="flex gap-2">
                                <button onClick={handleSaveOrder} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold transition-colors flex items-center gap-2"><CheckCircle size={18} /> Save Order</button>
                                <button onClick={() => setIsReorderMode(false)} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 rounded-xl font-bold transition-colors">Cancel</button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4 content-start">
                    {!isSelectionMode && !isReorderMode && !isReseller && (
                        <div onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="glass-card flex flex-col items-center justify-center gap-4 border-dashed border-white/20 hover:border-primary/50 cursor-pointer min-h-[200px] group opacity-60 hover:opacity-100">
                            <Plus size={24} className="text-slate-400 group-hover:text-primary transition-transform group-hover:scale-110" />
                            <span className="font-medium text-slate-400 text-sm">New Product</span>
                        </div>
                    )}

                    {isReorderMode ? (
                        <Reorder.Group axis="y" values={localOrderedProducts} onReorder={setLocalOrderedProducts}>
                            {localOrderedProducts.map(product => (
                                <Reorder.Item key={product.id} value={product} className="bg-white/5 mb-2 rounded-xl flex items-center p-2 cursor-grab active:cursor-grabbing border border-white/5 hover:border-white/20">
                                    <GripVertical size={20} className="text-slate-400 mr-3" />
                                    <div className="w-12 h-12 rounded bg-black/30 overflow-hidden shrink-0">
                                        {product.imageUrl && <img src={product.imageUrl} className="w-full h-full object-cover" />}
                                    </div>
                                    <div className="ml-3 flex-1">
                                        <h3 className="font-bold text-white">{product.name}</h3>
                                        <p className="text-xs text-primary">₱{product.price}</p>
                                    </div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    ) : (
                        <AnimatePresence>
                            {filteredProducts.map(product => (
                                <motion.div
                                    key={product.id}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className={`glass-card p-0 overflow-hidden cursor-pointer group flex flex-col min-h-[220px] relative ${selectedProducts.has(product.name) ? 'ring-2 ring-primary bg-primary/10' : ''}`}
                                    onClick={() => isSelectionMode ? toggleSelection(product.name) : (product.category === 'shirts' ? setActiveProduct(product) : addToCart(product, 'N/A'))}
                                >
                                    {isSelectionMode && (
                                        <div className="absolute top-2 left-2 z-20"><div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedProducts.has(product.name) ? 'bg-primary border-primary' : 'border-white/40 bg-black/40'}`}>{selectedProducts.has(product.name) && <CheckCircle size={14} className="text-white" />}</div></div>
                                    )}
                                    {!isSelectionMode && !isReseller && (
                                        <button onClick={(e) => { e.stopPropagation(); setEditingProduct(product); setShowProductModal(true); }} className="absolute top-2 right-2 z-30 p-2 bg-black/60 hover:bg-primary rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all"><Edit size={14} /></button>
                                    )}
                                    <div className="relative w-full overflow-hidden bg-slate-800" style={{ paddingBottom: '120%' }}>
                                        {product.imageUrl ? <img src={product.imageUrl} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" /> : <div className="absolute inset-0 flex items-center justify-center opacity-20"><Package size={48} /></div>}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex flex-col items-center justify-center p-4 backdrop-blur-[2px]">
                                            <span className="text-white font-bold text-sm mb-2">{product.name}</span>
                                            <div className="bg-primary text-black text-[10px] font-bold px-3 py-1 rounded-full">QUICK ADD</div>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-white/5 flex-1 flex flex-col justify-between">
                                        <div>
                                            <h3 className="font-semibold text-white text-sm line-clamp-1">{product.name}</h3>
                                            <p className="text-[10px] text-slate-500 uppercase font-mono mt-0.5">{product.brand || 'Sypik'}</p>
                                        </div>
                                        <span className="text-primary font-bold text-sm mt-2">₱{product.price}</span>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>

            {/* Desktop Cart */}
            <div className="hidden lg:flex w-[400px] glass-panel rounded-2xl flex-col h-full overflow-hidden">
                <CartContent
                    cart={cart}
                    updateCartQuantity={updateCartQuantity}
                    handleCheckout={handleCheckout}
                    checkoutLoading={checkoutLoading}
                    customerName={customerName}
                    setCustomerName={setCustomerName}
                    customerContact={customerContact}
                    setCustomerContact={setCustomerContact}
                    customerAddress={customerAddress}
                    setCustomerAddress={setCustomerAddress}
                    fulfillmentStatus={fulfillmentStatus}
                    setFulfillmentStatus={setFulfillmentStatus}
                    paymentStatus={paymentStatus}
                    setPaymentStatus={setPaymentStatus}
                    paymentMode={paymentMode}
                    setPaymentMode={setPaymentMode}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    customerSuggestions={customerSuggestions}
                    handleSelectCustomer={handleSelectCustomer}
                    shippingRegion={shippingRegion}
                    setShippingRegion={setShippingRegion}
                    customerProvince={customerProvince}
                    setCustomerProvince={setCustomerProvince}
                    customerCity={customerCity}
                    setCustomerCity={setCustomerCity}
                    customerBarangay={customerBarangay}
                    setCustomerBarangay={setCustomerBarangay}
                    provinceCode={provinceCode}
                    setProvinceCode={setProvinceCode}
                    cityCode={cityCode}
                    setCityCode={setCityCode}
                    provincesList={provincesList}
                    citiesList={citiesList}
                    barangaysList={barangaysList}
                    isReseller={isReseller}
                />
            </div>

            {/* Mobile Float Cart */}
            <div className="fixed bottom-4 left-4 right-4 lg:hidden z-40">
                <button onClick={() => setCartOpenMobile(true)} disabled={cart.length === 0} className="w-full btn-primary py-4 shadow-2xl flex justify-between px-6 items-center">
                    <div className="flex items-center gap-3"><ShoppingCart size={20} /> <span className="font-bold">{cart.reduce((a, b) => a + b.quantity, 0)} items</span></div>
                    <span className="font-bold text-lg">₱{cart.reduce((a, b) => a + (b.price * b.quantity), 0).toLocaleString()}</span>
                </button>
            </div>

            {/* Mobile Cart Modal */}
            <AnimatePresence>
                {cartOpenMobile && (
                    <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="fixed inset-0 z-50 bg-slate-900 lg:hidden flex flex-col">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center"><h2 className="font-bold text-lg flex items-center gap-2 text-white"><ShoppingCart /> Cart</h2><button onClick={() => setCartOpenMobile(false)} className="p-2"><X /></button></div>
                        <div className="flex-1 overflow-hidden">
                            <CartContent
                                cart={cart}
                                updateCartQuantity={updateCartQuantity}
                                handleCheckout={handleCheckout}
                                checkoutLoading={checkoutLoading}
                                customerName={customerName}
                                setCustomerName={setCustomerName}
                                customerContact={customerContact}
                                setCustomerContact={setCustomerContact}
                                customerAddress={customerAddress}
                                setCustomerAddress={setCustomerAddress}
                                fulfillmentStatus={fulfillmentStatus}
                                setFulfillmentStatus={setFulfillmentStatus}
                                paymentStatus={paymentStatus}
                                setPaymentStatus={setPaymentStatus}
                                paymentMode={paymentMode}
                                setPaymentMode={setPaymentMode}
                                showSuggestions={showSuggestions}
                                setShowSuggestions={setShowSuggestions}
                                customerSuggestions={customerSuggestions}
                                handleSelectCustomer={handleSelectCustomer}
                                shippingRegion={shippingRegion}
                                setShippingRegion={setShippingRegion}
                                customerProvince={customerProvince}
                                setCustomerProvince={setCustomerProvince}
                                customerCity={customerCity}
                                setCustomerCity={setCustomerCity}
                                customerBarangay={customerBarangay}
                                setCustomerBarangay={setCustomerBarangay}
                                provinceCode={provinceCode}
                                setProvinceCode={setProvinceCode}
                                cityCode={cityCode}
                                setCityCode={setCityCode}
                                provincesList={provincesList}
                                citiesList={citiesList}
                                barangaysList={barangaysList}
                                isReseller={isReseller}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

const ProductDefinitionModal = ({ editingProduct, onClose, onSave, onDelete, colors, brands }) => {
    const [form, setForm] = useState({
        name: editingProduct?.name || '',
        price: editingProduct?.price || 450,
        brand: editingProduct?.brand || 'Sypik',
        category: editingProduct?.category || 'shirts',
        linkedColor: editingProduct?.linkedColor || 'Black',
        imageUrl: editingProduct?.imageUrl || null,
        images: editingProduct?.images || (editingProduct?.imageUrl ? [editingProduct.imageUrl] : [])
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
            const { error: uploadError } = await supabase.storage.from('product-images').upload(fileName, file);
            if (uploadError) throw uploadError;
            const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
            
            const newUrl = data.publicUrl;
            setForm(p => {
                const newImages = [...(p.images || []), newUrl];
                return { 
                    ...p, 
                    imageUrl: newImages[0], // Keep first as main
                    images: newImages 
                };
            });
            showToast('Image added to gallery!', 'success');
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            setUploading(true); // Wait, should be false. Fix it.
            setUploading(false);
        }
    };

    const removeImage = (url) => {
        setForm(p => ({
            ...p,
            images: p.images.filter(img => img !== url),
            imageUrl: p.images[0] === url ? p.images[1] || null : p.imageUrl
        }));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="glass-panel w-full max-w-md p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white"><X size={20} /></button>
                <h3 className="text-xl font-bold mb-6 text-white">{editingProduct ? 'Edit Product' : 'New Product'}</h3>
                <div className="space-y-4">
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                        <div 
                            onClick={() => fileRef.current?.click()} 
                            className="w-24 h-24 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 bg-black/20 shrink-0"
                        >
                            {uploading ? <Loader2 className="animate-spin text-primary" size={20} /> : <Plus size={20} className="text-slate-500" />}
                            <span className="text-[10px] uppercase font-bold text-slate-500 mt-1">Add Photo</span>
                        </div>
                        
                        {(form.images || []).map((img, idx) => (
                            <div key={idx} className="w-24 h-24 rounded-xl relative group shrink-0 overflow-hidden ring-1 ring-white/10">
                                <img src={img} className="w-full h-full object-cover" alt={`Product ${idx}`} />
                                <button 
                                    onClick={() => removeImage(img)}
                                    className="absolute top-1 right-1 p-1 bg-black/60 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={12} />
                                </button>
                                {idx === 0 && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-primary/90 text-black text-[8px] font-bold py-0.5 text-center uppercase tracking-tighter">Main Visual</div>
                                )}
                            </div>
                        ))}
                    </div>
                    <input type="file" ref={fileRef} className="hidden" onChange={handleUpload} />
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="text-[10px] text-slate-400 font-bold uppercase">Product Name</label>
                            <input className="glass-input mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sypik Classic White" />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-400 font-bold uppercase">Price (₱)</label>
                            <input type="number" className="glass-input mt-1" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-400 font-bold uppercase">Category</label>
                            <select className="glass-input mt-1" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{['shirts', 'accessories', 'equipment'].map(c => <option key={c} value={c} className="bg-slate-900 capitalize">{c}</option>)}</select>
                        </div>
                    </div>
                    {form.category === 'shirts' && (
                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                            <div>
                                <label className="text-[10px] text-slate-400 font-bold uppercase">Brand</label>
                                <select className="glass-input mt-1" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })}>{brands.map(b => <option key={b.name} value={b.name} className="bg-slate-900">{b.name}</option>)}</select>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-400 font-bold uppercase">Inventory Color</label>
                                <select className="glass-input mt-1" value={form.linkedColor} onChange={e => setForm({ ...form, linkedColor: e.target.value })}>{colors.map(c => <option key={c.name} value={c.name} className="bg-slate-900">{c.name}</option>)}</select>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-2 mt-6">
                        {editingProduct && <button onClick={() => window.confirm(`Delete ${form.name}?`) && onDelete(form.name)} className="p-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"><Trash2 size={20} /></button>}
                        <button onClick={() => onSave(form)} disabled={!form.name || uploading} className="btn-primary flex-1 py-3">{uploading ? 'Processing...' : 'Save Product'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SizeSelectorModal = ({ activeProduct, onClose, onSelectSize, getStockForProduct }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel p-6 max-w-sm w-full relative" onClick={e => e.stopPropagation()}>
            <div className="flex gap-4 mb-6">
                <div className="w-20 h-20 rounded-xl bg-white/5 overflow-hidden ring-1 ring-white/10">{activeProduct.imageUrl ? <img src={activeProduct.imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center opacity-20"><Package /></div>}</div>
                <div>
                    <h3 className="font-bold text-lg text-white leading-tight">{activeProduct.name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase font-mono mt-1">{activeProduct.brand} • {activeProduct.linkedColor} Canvas</p>
                    <p className="text-primary font-bold text-lg mt-2 font-sans">₱{activeProduct.price}</p>
                </div>
            </div>
            <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-3 tracking-widest flex items-center gap-2"><Ruler size={14} className="text-primary" /> Select Size</h4>
            <div className="grid grid-cols-3 gap-2">
                {SIZES.map(size => {
                    const stock = getStockForProduct(activeProduct, size);
                    const hasStock = stock > 0;
                    return (
                        <button key={size} disabled={!hasStock} onClick={() => onSelectSize(size)} className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center justify-center ${hasStock ? 'border-white/10 hover:border-primary hover:bg-primary/10 text-white' : 'border-white/5 text-slate-600 bg-black/20 cursor-not-allowed opacity-50'}`}>
                            <span className="font-bold text-sm">{size}</span>
                            <span className="text-[9px] mt-1 opacity-60">{stock} PCS</span>
                        </button>
                    );
                })}
            </div>
        </motion.div>
    </div>
);

const CartContent = ({ cart, updateCartQuantity, handleCheckout, checkoutLoading, customerName, setCustomerName, customerContact, setCustomerContact, customerAddress, setCustomerAddress, shippingRegion, setShippingRegion, customerProvince, setCustomerProvince, customerCity, setCustomerCity, customerBarangay, setCustomerBarangay, provinceCode, setProvinceCode, cityCode, setCityCode, provincesList, citiesList, barangaysList, fulfillmentStatus, setFulfillmentStatus, paymentStatus, setPaymentStatus, paymentMode, setPaymentMode, showSuggestions, setShowSuggestions, customerSuggestions, handleSelectCustomer, isReseller }) => (
    <div className="flex flex-col h-full bg-slate-900/50">
        <div className="p-6 border-b border-white/5"><h2 className="text-lg font-bold text-white flex items-center gap-2"><ShoppingCart className="text-primary" size={20} /> Current Cart</h2></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map(item => (
                <div key={item.cartId} className="bg-white/5 rounded-xl p-3 flex items-center gap-3 border border-white/5">
                    <div className="w-12 h-12 rounded-lg bg-black/40 overflow-hidden shrink-0 ring-1 ring-white/5">{item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover" /> : <Package size={20} className="m-auto mt-3 opacity-20" />}</div>
                    <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-200 text-sm truncate">{item.name}</h4>
                        <div className="flex gap-2 items-center mt-1">
                            {item.size !== 'N/A' && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold">{item.size}</span>}
                            <span className="text-[10px] text-slate-400">₱{item.price}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-black/40 rounded-lg p-1 border border-white/5">
                        <button onClick={() => updateCartQuantity(item.cartId, -1)} className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded transition-colors">-</button>
                        <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateCartQuantity(item.cartId, 1)} className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded transition-colors">+</button>
                    </div>
                    <button onClick={() => updateCartQuantity(item.cartId, -999)} className="text-red-400/60 hover:text-red-400 p-1 transition-colors"><Trash2 size={16} /></button>
                </div>
            ))}
            {cart.length === 0 && <div className="text-center py-20 text-slate-600 flex flex-col items-center gap-3"><ShoppingCart size={40} className="opacity-20" /><p className="text-sm">Your cart is feeling lonely</p></div>}
        </div>
        <div className="p-6 border-t border-white/10 bg-black/40 space-y-6">
            <div className="flex justify-between items-end border-b border-white/10 pb-4"><span className="text-slate-400 font-medium">Order Total</span><span className="text-2xl font-bold text-white">₱{cart.reduce((a, b) => a + (b.price * b.quantity), 0).toLocaleString()}</span></div>
            <div className="space-y-4">
                <div className="flex items-center justify-between"><h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Customer Profile</h3><button onClick={() => updateCartQuantity('clear')} className="text-[10px] text-red-400/60 hover:text-red-400 uppercase font-bold transition-colors">Clear Order</button></div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="relative z-30">
                        <input className="glass-input text-xs py-3" placeholder="Full Name" value={customerName} onChange={e => { setCustomerName(e.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} />
                        {showSuggestions && customerSuggestions?.length > 0 && (
                            <div className="absolute top-full left-0 w-full mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-40">
                                {customerSuggestions.map(c => <button key={c.id} onClick={() => handleSelectCustomer(c)} className="w-full text-left px-4 py-3 hover:bg-primary/20 hover:text-primary text-xs flex justify-between items-center transition-colors border-b border-white/5 last:border-0"><span className="font-semibold">{c.name}</span>{c.total_spent > 0 && <span className="opacity-60">₱{c.total_spent.toLocaleString()}</span>}</button>)}
                            </div>
                        )}
                    </div>
                    <input className="glass-input text-xs py-3" placeholder="Contact Number" value={customerContact} onChange={e => setCustomerContact(e.target.value)} />
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShippingRegion('MM')} className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${shippingRegion === 'MM' ? 'bg-primary/10 border-primary text-primary' : 'bg-black/20 border-white/5 text-slate-500'}`}>METRO MANILA</button>
                    <button onClick={() => setShippingRegion('Provincial')} className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${shippingRegion === 'Provincial' ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-black/20 border-white/5 text-slate-500'}`}>PROVINCIAL</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {shippingRegion === 'Provincial' && <select className="glass-input text-xs py-2 col-span-2" value={provinceCode} onChange={e => { setProvinceCode(e.target.value); setCustomerProvince(e.target.options[e.target.selectedIndex].text); }}><option value="" disabled>Select Province</option>{provincesList.map(p => <option key={p.code} value={p.code} className="bg-slate-900">{p.name}</option>)}</select>}
                    <select className="glass-input text-xs py-2" value={cityCode} onChange={e => { setCityCode(e.target.value); setCustomerCity(e.target.options[e.target.selectedIndex].text); }} disabled={!citiesList.length}><option value="" disabled>City / Town</option>{citiesList.map(c => <option key={c.code} value={c.code} className="bg-slate-900">{c.name}</option>)}</select>
                    <select className="glass-input text-xs py-2" value={customerBarangay} onChange={e => setCustomerBarangay(e.target.value)} disabled={!barangaysList.length}><option value="" disabled>Barangay</option>{barangaysList.map(b => <option key={b.code} value={b.name} className="bg-slate-900">{b.name}</option>)}</select>
                </div>
                <input className="glass-input text-xs py-3" placeholder="Street Address / Room / landmarks" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} />
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <select className="glass-input text-[11px] py-3" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>{['Cash', 'Gcash', 'Bank Transfer', 'COD'].map(m => <option key={m} value={m} className="bg-slate-900">{m}</option>)}</select>
                    <select className="glass-input text-[11px] py-3 capitalize" value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>{['unpaid', 'paid'].map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}</select>
                </div>
                {!isReseller && <select className="glass-input text-[11px] py-3 capitalize" value={fulfillmentStatus} onChange={e => setFulfillmentStatus(e.target.value)}>{['pending', 'in_progress', 'ready', 'shipped'].map(s => <option key={s} value={s} className="bg-slate-900">{s.replace('_', ' ')}</option>)}</select>}
            </div>
            <button onClick={handleCheckout} disabled={checkoutLoading || cart.length === 0} className="w-full btn-primary py-4 text-sm font-bold shadow-[0_10px_30px_rgba(var(--primary-rgb),0.3)]">{checkoutLoading ? <Loader2 className="animate-spin m-auto" /> : 'CONFIRM ORDER'}</button>
        </div>
    </div>
);

const ArrowRightIcon = ({ className, size = 16 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </svg>
);
