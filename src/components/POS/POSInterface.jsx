import React, { useState, useMemo, useRef } from 'react';
import { Reorder } from 'framer-motion';
import clsx from 'clsx';
import { Search, ShoppingCart, Trash2, CheckCircle, Package, Plus, Loader2, Edit, X, Upload, Ruler, GripVertical, Minus } from 'lucide-react';
import { useToast } from '../ui/Toast';
import Dialog from '../ui/Dialog';
import { api, apiRequest } from '../../lib/apiClient';
import { useRawInventory, useProducts, useColors, useBrands } from '../../hooks/useInventory';
import useCustomers from '../../hooks/useCustomers';
import { getMMCities, getAllProvinces, getCitiesByProvince, getBarangays } from '../../lib/phLocations';
import { useActivityLog } from '../../hooks/useActivityLog';
import { createOrderId } from '../../lib/orderItems';
import { getStockKey } from '../../lib/inventory';
import { getCartUnitPrice, isBallProduct, priceOrder } from '../../lib/orderPricing';
import { getCheckoutStatuses } from '../../lib/checkoutPolicy';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const BALL_QUANTITIES = [1, 5, 10, 20, 50, 100];
const PAYMENT_MODES = ['Cash', 'Gcash', 'Bank Transfer', 'COD'];
const CATEGORY_FALLBACK = 'shirts';
const BRAND_FALLBACK = 'Sypik';

const peso = (value) => `₱${(Number(value) || 0).toLocaleString()}`;
const titleCase = (value) => String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

export default function POSInterface({ transactions, onAddTransaction, onAddTransactions, onDeleteTransaction, userRole }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();

    const isReseller = userRole === 'reseller';
    const RESELLER_PRICE = 400; // Fixed price for resellers

    // State
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedBrand, setSelectedBrand] = useState('All');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const checkoutPending = useRef(false);
    const checkoutAttempt = useRef(null);

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
    const [paymentStatus, setPaymentStatus] = useState(() => getCheckoutStatuses(userRole).paymentStatus);
    const [paymentMode, setPaymentMode] = useState('Cash');

    // Customer Search State
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [customerSuggestions, setCustomerSuggestions] = useState([]);
    const { searchCustomers, upsertCustomer } = useCustomers();

    // Debounced Search
    React.useEffect(() => {
        let active = true;
        const timer = setTimeout(async () => {
            if (showSuggestions && customerName.length > 1) {
                try {
                    const results = await searchCustomers(customerName);
                    if (active) setCustomerSuggestions(results);
                } catch {
                    if (active) {
                        setCustomerSuggestions([]);
                        showToast('Customer search unavailable. You can still enter customer details.', 'error');
                    }
                }
            }
        }, 300);
        return () => { active = false; clearTimeout(timer); };
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

    const categoryOptions = useMemo(() => ['All', ...new Set(effectiveProducts.map(p => p.category || CATEGORY_FALLBACK))], [effectiveProducts]);
    const brandOptions = useMemo(() => ['All', ...new Set(effectiveProducts.map(p => p.brand || BRAND_FALLBACK))], [effectiveProducts]);
    const filteredProducts = useMemo(() => effectiveProducts.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || (p.category || CATEGORY_FALLBACK) === selectedCategory;
        const matchesBrand = selectedBrand === 'All' || (p.brand || BRAND_FALLBACK) === selectedBrand;
        return matchesSearch && matchesCategory && matchesBrand;
    }), [effectiveProducts, searchTerm, selectedCategory, selectedBrand]);

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
                if (item.cartId === id) {
                    const nextQuantity = Math.max(1, item.quantity + delta);
                    return { ...item, quantity: nextQuantity, price: getCartUnitPrice(item, nextQuantity) };
                }
                return item;
            });
        });
    }

    const getStockForProduct = (product, size) => {
        if (product.category !== 'shirts') return 999;
        const key = getStockKey({ ...product, size });
        return rawInventory[key] || 0;
    };

    const addToCart = (product, size, quantity = 1) => {
        const cartId = `${product.name}-${size}`;
        setCart(prev => {
            const existing = prev.find(i => i.cartId === cartId);
            if (existing) {
                return prev.map(i => {
                    if (i.cartId !== cartId) return i;
                    const nextQuantity = i.quantity + quantity;
                    return { ...i, quantity: nextQuantity, price: getCartUnitPrice(i, nextQuantity) };
                });
            }
            return [...prev, {
                ...product,
                price: getCartUnitPrice(product, quantity),
                size,
                cartId,
                quantity,
                linkedColor: product.linkedColor
            }];
        });
        setActiveProduct(null); // Close size selector
    };
    const handleCheckout = async () => {
        if (checkoutPending.current) return;
        if (cart.length === 0) {
            showToast('Cart is empty', 'error');
            return;
        }
        if (!customerName.trim()) {
            showToast('Enter customer name', 'error');
            return;
        }

        checkoutPending.current = true;
        setCheckoutLoading(true);
        try {
            const user = await api.getCurrentUser();
            if (!user) throw new Error('Sign in again before saving this order.');
            const fingerprint = JSON.stringify([cart, customerName, customerContact, customerAddress, customerCity,
                customerProvince, customerBarangay, shippingRegion, paymentMode, paymentStatus, fulfillmentStatus, user.id]);
            if (checkoutAttempt.current && checkoutAttempt.current.fingerprint !== fingerprint) {
                throw new Error('A previous checkout is unconfirmed. Restore that cart and retry, or reload Orders to verify it before starting another checkout.');
            }
            const attempt = checkoutAttempt.current || {
                fingerprint, requestId: crypto.randomUUID(), orderId: createOrderId(), date: new Date().toISOString(),
                itemIds: cart.map(() => crypto.randomUUID())
            };
            checkoutAttempt.current = attempt;
            const { orderId, date } = attempt;
            const priced = priceOrder(cart.map((item, index) => ({
                ...item,
                id: attempt.itemIds[index],
                unitPrice: getCartUnitPrice(item)
            })));
            const pricing = { version: 1, discount: null, shippingFee: 0, isRushOrder: false, rushFeePerShirt: 100, shippingLineId: priced.items[0].id };
            const transactionData = priced.items.map(item => ({
                id: item.id,
                type: 'sale',
                category: item.category || 'shirts',
                amount: item.amount,
                date,
                description: `POS Sale: ${item.name} (${item.size}) to ${customerName.trim()}`,
                details: {
                    orderId,
                    customerName: customerName.trim(),
                    contactNumber: customerContact.trim(),
                    itemName: item.name,
                    brand: item.brand || 'Sypik',
                    category: item.category || 'shirts',
                    unitPrice: item.unitPrice,
                    originalAmount: item.originalAmount,
                    discountShare: item.discountShare,
                    shippingShare: 0,
                    quantity: item.quantity,
                    size: item.size,
                    color: item.linkedColor || '',
                    imageUrl: item.imageUrl,
                    source: 'pos',
                    pricing,
                    shippingDetails: {
                        address: customerAddress,
                        city: customerCity,
                        province: customerProvince,
                        barangay: customerBarangay,
                        contactNumber: customerContact.trim(),
                        region: shippingRegion,
                        shippingFee: 0,
                        rushFee: 0,
                        isRushOrder: false
                    },
                    paymentMode,
                    ...getCheckoutStatuses(userRole, paymentStatus, fulfillmentStatus),
                    createdBy: user.email,
                    userRole
                }
            }));

            await onAddTransactions(transactionData, { requestId: attempt.requestId });
            checkoutAttempt.current = null;
            await logActivity('POS Checkout', {
                customer: customerName,
                itemCount: cart.length,
                total: priced.total,
                paymentMode
            }, orderId);

            showToast('Order Processed!', 'success');
            try {
                const fullAddress = `${customerAddress}${customerBarangay ? ', ' + customerBarangay : ''}${customerCity ? ', ' + customerCity : ''}${customerProvince ? ', ' + customerProvince : ''}`;
                await upsertCustomer({
                    name: customerName.trim(),
                    contact_number: customerContact,
                    address: fullAddress,
                    total_spent: priced.total
                });
            } catch (customerError) {
                console.error('Order saved, but customer profile update failed:', customerError);
                showToast('Order saved. The customer profile could not be updated.', 'error');
            }
            if (userRole === 'owner' && customerContact.trim()) {
                try {
                    const settings = await apiRequest('/api/settings/sms');
                    if (settings.enableSmsNotifications && settings.configured) {
                        await api.sendSms({
                            recipient: customerContact.trim(),
                            message: `SportsTech: Order ${orderId} confirmed. Total: ₱${priced.total}`,
                            orderId
                        });
                    }
                } catch {
                    showToast('Order saved. The SMS notification could not be sent.', 'error');
                }
            }
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
            if ([400, 401, 403, 404, 409, 422].includes(err.status)) checkoutAttempt.current = null;
            console.error(err);
            showToast(`Checkout failed: ${err.message}`, 'error');
        } finally {
            checkoutPending.current = false;
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

    const cartItemCount = cart.reduce((a, b) => a + b.quantity, 0);
    const cartTotal = cart.reduce((a, b) => a + (getCartUnitPrice(b) * b.quantity), 0);
    const showProductChoices = !isSelectionMode && !isReorderMode;

    const handleProductAction = (product) => {
        if (isSelectionMode) {
            toggleSelection(product.name);
            return;
        }
        if (product.category === 'shirts' || isBallProduct(product)) {
            setActiveProduct(product);
            return;
        }
        addToCart(product, 'N/A');
    };

    return (
        <div className="relative flex h-[calc(100dvh-8rem)] min-h-[620px] flex-col gap-4 lg:h-[calc(100vh-120px)] lg:flex-row lg:gap-6">
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
                    onSelectSize={(size, quantity) => addToCart(activeProduct, size, quantity)}
                    getStockForProduct={getStockForProduct}
                />
            )}
            <div className="flex min-h-0 flex-1 flex-col pb-24 lg:pb-0">
                <div className="surface mb-4 p-4 sm:p-5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-[min(100%,22rem)] flex-1">
                            <label htmlFor="pos-product-search" className="field-label">Search products</label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" size={20} aria-hidden="true" />
                                <input
                                    id="pos-product-search"
                                    type="text"
                                    placeholder="Search products..."
                                    className="field pl-11"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {!isReseller && !isSelectionMode && !isReorderMode && (
                                <>
                                    <button type="button" onClick={() => setIsSelectionMode(true)} className="btn-secondary">Select</button>
                                    <button type="button" onClick={() => setIsReorderMode(true)} className="btn-secondary">Reorder</button>
                                    <button type="button" onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="btn-secondary whitespace-nowrap"><Plus size={20} aria-hidden="true" /> <span className="hidden sm:inline">Define Product</span></button>
                                </>
                            )}
                            {isSelectionMode && (
                                <>
                                    <button type="button" onClick={handleBulkDelete} disabled={selectedProducts.size === 0} className="btn-danger"><Trash2 size={18} aria-hidden="true" /> Delete ({selectedProducts.size})</button>
                                    <button type="button" onClick={() => { setIsSelectionMode(false); setSelectedProducts(new Set()); }} className="btn-secondary">Cancel</button>
                                </>
                            )}
                            {isReorderMode && (
                                <>
                                    <button type="button" onClick={handleSaveOrder} className="btn-success"><CheckCircle size={18} aria-hidden="true" /> Save Order</button>
                                    <button type="button" onClick={() => setIsReorderMode(false)} className="btn-secondary">Cancel</button>
                                </>
                            )}
                        </div>
                    </div>

                    {showProductChoices && (
                        <div className="mt-4 space-y-3">
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Category filters">
                                {categoryOptions.map(category => (
                                    <button key={category} type="button" className="chip" aria-pressed={selectedCategory === category} onClick={() => setSelectedCategory(category)}>
                                        {category === 'All' ? 'All categories' : titleCase(category)}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Brand filters">
                                {brandOptions.map(brand => (
                                    <button key={brand} type="button" className="chip" aria-pressed={selectedBrand === brand} onClick={() => setSelectedBrand(brand)}>
                                        {brand === 'All' ? 'All brands' : brand}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {isReorderMode ? (
                        <Reorder.Group axis="y" values={localOrderedProducts} onReorder={setLocalOrderedProducts} className="space-y-2">
                            {localOrderedProducts.map(product => (
                                <Reorder.Item key={product.id} value={product} className="flex cursor-grab items-center rounded-xl border border-line bg-surface p-2 active:cursor-grabbing">
                                    <GripVertical size={20} className="mr-3 shrink-0 text-ink-3" aria-hidden="true" />
                                    <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-well">
                                        {product.imageUrl ? <img src={product.imageUrl} className="size-full object-cover" alt="" /> : <div className="grid size-full place-items-center text-ink-3"><Package size={20} aria-hidden="true" /></div>}
                                    </div>
                                    <div className="ml-3 min-w-0 flex-1">
                                        <h3 className="truncate text-sm font-semibold text-ink">{product.name}</h3>
                                        <p className="num text-sm font-semibold text-ink-2">{peso(product.price)}</p>
                                    </div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    ) : (
                        <div className="grid content-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(142px,1fr))]">
                            {!isSelectionMode && !isReseller && (
                                <button type="button" onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="min-h-[214px] rounded-2xl border border-dashed border-line bg-surface p-4 text-left transition-colors hover:border-slate-500">
                                    <span className="grid size-12 place-items-center rounded-xl bg-well text-ink-3" aria-hidden="true"><Plus size={24} /></span>
                                    <span className="mt-4 block text-sm font-semibold text-ink">New Product</span>
                                </button>
                            )}

                            {filteredProducts.map(product => {
                                const selected = selectedProducts.has(product.name);
                                return (
                                    <div key={product.id} className={clsx('relative rounded-2xl border bg-surface p-2 transition-colors', selected ? 'border-ink' : 'border-line hover:border-slate-500')}>
                                        {isSelectionMode && (
                                            <span className={clsx('absolute left-3 top-3 z-10 grid size-7 place-items-center rounded-full border-2', selected ? 'border-ink bg-ink text-ground' : 'border-slate-500 bg-ground/90 text-transparent')} aria-hidden="true">
                                                {selected && <CheckCircle size={16} />}
                                            </span>
                                        )}
                                        {!isSelectionMode && !isReseller && (
                                            <button type="button" onClick={(e) => { e.stopPropagation(); setEditingProduct(product); setShowProductModal(true); }} className="icon-btn absolute right-3 top-3 z-10 bg-ground/90" aria-label={`Edit ${product.name}`}>
                                                <Edit size={16} />
                                            </button>
                                        )}
                                        <button type="button" className="flex h-full w-full flex-col text-left" onClick={() => handleProductAction(product)} aria-pressed={isSelectionMode ? selected : undefined}>
                                            <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-well">
                                                {product.imageUrl ? <img src={product.imageUrl} className="size-full object-cover" alt="" /> : <span className="grid size-full place-items-center text-ink-3"><Package size={40} aria-hidden="true" /></span>}
                                            </span>
                                            <span className="flex flex-1 flex-col px-1 pt-3 pb-1">
                                                <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{product.name}</span>
                                                <span className="mt-1 truncate text-xs text-ink-2">{product.brand || BRAND_FALLBACK}</span>
                                                <span className="num mt-2 text-[15px] font-semibold text-ink">{peso(product.price)}</span>
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                            {filteredProducts.length === 0 && (
                                <div className="col-span-full rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                                    <Package size={30} className="mx-auto text-ink-3" aria-hidden="true" />
                                    <p className="mt-3 text-ink-2">{searchTerm || selectedCategory !== 'All' || selectedBrand !== 'All' ? 'No products match your search or filters.' : 'No products to sell yet.'}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="hidden w-[400px] shrink-0 overflow-hidden rounded-2xl border border-line bg-surface lg:flex">
                <CartContent
                    idPrefix="desktop-pos"
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

            <div className="fixed inset-x-4 bottom-16 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden">
                <button type="button" onClick={() => setCartOpenMobile(true)} disabled={cart.length === 0} className="btn-primary min-h-14 w-full justify-between px-5 text-base">
                    <span className="flex items-center gap-3"><ShoppingCart size={20} aria-hidden="true" /> <span>{cartItemCount} items</span></span>
                    <span className="num text-lg font-semibold">{peso(cartTotal)}</span>
                </button>
            </div>
            {cartOpenMobile && (
                <Dialog variant="drawer" onClose={() => setCartOpenMobile(false)} title="Cart" closeLabel="Close cart" bodyClassName="p-0" className="lg:hidden">
                    <CartContent
                        idPrefix="mobile-pos"
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
                </Dialog>
            )}
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
            const { url: newUrl } = await api.uploadProductImage(file);
            if (!newUrl) throw new Error('The uploaded image could not be verified.');
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
        <Dialog
            onClose={onClose}
            title={editingProduct ? 'Edit Product' : 'New Product'}
            closeLabel="Close product form"
            size="md"
            footer={(
                <div className="flex gap-2">
                    {editingProduct && <button type="button" onClick={() => window.confirm(`Delete ${form.name}?`) && onDelete(form.name)} className="btn-danger px-4" aria-label={`Delete ${form.name}`}><Trash2 size={20} aria-hidden="true" /></button>}
                    <button type="button" onClick={() => onSave(form)} disabled={!form.name || uploading} className="btn-primary flex-1">{uploading ? 'Processing...' : 'Save Product'}</button>
                </div>
            )}
        >
            <div className="space-y-5">
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="flex size-24 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-well text-ink-2 transition-colors hover:border-slate-500 hover:text-ink"
                        aria-label="Add photo"
                    >
                        {uploading ? <Loader2 className="animate-spin text-primary" size={20} aria-hidden="true" /> : <Upload size={20} aria-hidden="true" />}
                        <span className="mt-1 text-xs font-semibold">Add photo</span>
                    </button>

                    {(form.images || []).map((img, idx) => (
                        <div key={idx} className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-line bg-well">
                            <img src={img} className="size-full object-cover" alt={`Product ${idx}`} />
                            <button
                                type="button"
                                onClick={() => removeImage(img)}
                                className="icon-btn absolute right-1 top-1 size-9 bg-ground/90"
                                aria-label={`Remove product image ${idx + 1}`}
                            >
                                <X size={14} />
                            </button>
                            {idx === 0 && (
                                <div className="absolute inset-x-0 bottom-0 bg-ground/90 py-1 text-center text-xs font-semibold text-ink">Main visual</div>
                            )}
                        </div>
                    ))}
                </div>
                <input type="file" ref={fileRef} className="hidden" onChange={handleUpload} aria-label="Product photo" />

                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label htmlFor="product-name" className="field-label">Product name</label>
                        <input id="product-name" className="field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sypik Classic White" />
                    </div>
                    <div>
                        <label htmlFor="product-price" className="field-label">Price (₱)</label>
                        <input id="product-price" type="number" className="field num" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
                    </div>
                    <div>
                        <label htmlFor="product-category" className="field-label">Category</label>
                        <select id="product-category" className="field" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{['shirts', 'balls', 'accessories', 'equipment'].map(c => <option key={c} value={c} className="capitalize">{c}</option>)}</select>
                    </div>
                </div>

                {form.category === 'shirts' && (
                    <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
                        <div>
                            <label htmlFor="product-brand" className="field-label">Brand</label>
                            <select id="product-brand" className="field" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })}>{brands.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}</select>
                        </div>
                        <div>
                            <label htmlFor="product-color" className="field-label">Inventory color</label>
                            <select id="product-color" className="field" value={form.linkedColor} onChange={e => setForm({ ...form, linkedColor: e.target.value })}>{colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
                        </div>
                    </div>
                )}
            </div>
        </Dialog>
    );
};
const SizeSelectorModal = ({ activeProduct, onClose, onSelectSize, getStockForProduct }) => {
    const isBall = isBallProduct(activeProduct);
    const [selectedQuantity, setSelectedQuantity] = useState(BALL_QUANTITIES[0]);
    const [selectedSize, setSelectedSize] = useState('');

    return (
        <Dialog
            onClose={onClose}
            title={activeProduct.name}
            description={[activeProduct.brand, activeProduct.linkedColor].filter(Boolean).join(' • ') || undefined}
            closeLabel="Close product"
            footer={(
                <button type="button" onClick={() => isBall ? onSelectSize('N/A', selectedQuantity) : onSelectSize(selectedSize)} disabled={!isBall && !selectedSize} className="btn-primary h-12 w-full text-base">
                    Add to cart
                </button>
            )}
        >
            <div className="space-y-5">
                <div className="flex gap-4">
                    <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-well">
                        {activeProduct.imageUrl ? <img src={activeProduct.imageUrl} className="size-full object-cover" alt="" /> : <div className="grid size-full place-items-center text-ink-3"><Package size={28} aria-hidden="true" /></div>}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="num text-2xl font-semibold text-ink">{peso(activeProduct.price)}</p>
                        <p className="mt-1 text-sm text-ink-2">{isBall ? 'Choose the quantity for this cart line.' : 'Choose an available size.'}</p>
                    </div>
                </div>

                {isBall ? (
                    <div>
                        <h3 id="ball-quantity-label" className="flex items-center gap-2 text-sm font-semibold text-ink"><ShoppingCart size={18} className="text-ink-3" aria-hidden="true" /> Select quantity</h3>
                        <div role="radiogroup" aria-labelledby="ball-quantity-label" className="mt-3 grid grid-cols-3 gap-2">
                            {BALL_QUANTITIES.map(quantity => {
                                const selected = selectedQuantity === quantity;
                                const unitPrice = getCartUnitPrice(activeProduct, quantity);
                                return (
                                    <button key={quantity} type="button" role="radio" aria-checked={selected} onClick={() => setSelectedQuantity(quantity)}
                                        className={clsx('min-h-14 rounded-lg border px-2 py-2 text-center transition-colors', selected ? 'border-ink bg-ink text-ground' : 'border-slate-600 text-ink hover:border-slate-300')}>
                                        <span className="num block text-base font-semibold">{quantity} {quantity === 1 ? 'pc' : 'pcs'}</span>
                                        <span className={clsx('num mt-1 block text-xs', selected ? 'text-ground/70' : 'text-ink-2')}>{peso(unitPrice)}/pc</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div>
                        <h3 id="size-label" className="flex items-center gap-2 text-sm font-semibold text-ink"><Ruler size={18} className="text-ink-3" aria-hidden="true" /> Select size</h3>
                        <div role="radiogroup" aria-labelledby="size-label" className="mt-3 grid grid-cols-3 gap-2">
                            {SIZES.map(size => {
                                const stock = getStockForProduct(activeProduct, size);
                                const hasStock = stock > 0;
                                const selected = selectedSize === size;
                                return (
                                    <button key={size} type="button" role="radio" aria-checked={selected} disabled={!hasStock} onClick={() => setSelectedSize(size)}
                                        className={clsx('min-h-14 rounded-lg border px-3 py-2 text-center transition-colors disabled:cursor-not-allowed disabled:border-line disabled:text-ink-3 disabled:opacity-60', selected ? 'border-ink bg-ink text-ground' : 'border-slate-600 text-ink hover:border-slate-300')}>
                                        <span className="block text-base font-semibold">{size}</span>
                                        <span className={clsx('num mt-1 block text-xs', selected ? 'text-ground/70' : 'text-ink-2')}>{stock} pcs</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </Dialog>
    );
};

const CartContent = ({ idPrefix, cart, updateCartQuantity, handleCheckout, checkoutLoading, customerName, setCustomerName, customerContact, setCustomerContact, customerAddress, setCustomerAddress, shippingRegion, setShippingRegion, customerProvince, setCustomerProvince, customerCity, setCustomerCity, customerBarangay, setCustomerBarangay, provinceCode, setProvinceCode, cityCode, setCityCode, provincesList, citiesList, barangaysList, fulfillmentStatus, setFulfillmentStatus, paymentStatus, setPaymentStatus, paymentMode, setPaymentMode, showSuggestions, setShowSuggestions, customerSuggestions, handleSelectCustomer, isReseller }) => {
    const total = cart.reduce((a, b) => a + (getCartUnitPrice(b) * b.quantity), 0);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4 sm:px-5">
                <h2 className="section-title flex items-center gap-2"><ShoppingCart className="text-ink-3" size={20} aria-hidden="true" /> Current Cart</h2>
                <span className="badge border-line text-ink-2"><span className="num">{cart.length}</span> lines</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
                {cart.length > 0 ? (
                    <div className="divide-y divide-line">
                        {cart.map(item => (
                            <div key={item.cartId} className="flex items-center gap-3 py-3">
                                <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-well">
                                    {item.imageUrl ? <img src={item.imageUrl} className="size-full object-cover" alt="" /> : <div className="grid size-full place-items-center text-ink-3"><Package size={20} aria-hidden="true" /></div>}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="truncate text-sm font-semibold text-ink">{item.name}</h4>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                                        {item.size !== 'N/A' && <span className="badge border-line text-ink-2">{item.size}</span>}
                                        <span className="num">{peso(getCartUnitPrice(item))}/pc</span>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-raised p-1">
                                    <button type="button" onClick={() => updateCartQuantity(item.cartId, -1)} className="icon-btn size-9" aria-label={`Decrease quantity for ${item.name}`}><Minus size={16} /></button>
                                    <span className="num min-w-6 text-center text-sm font-semibold text-ink">{item.quantity}</span>
                                    <button type="button" onClick={() => updateCartQuantity(item.cartId, 1)} className="icon-btn size-9" aria-label={`Increase quantity for ${item.name}`}><Plus size={16} /></button>
                                </div>
                                <button type="button" onClick={() => updateCartQuantity(item.cartId, -999)} className="icon-btn size-10 text-red-400 hover:bg-red-500/10 hover:text-red-300" aria-label={`Remove ${item.name} from cart`}><Trash2 size={17} /></button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="my-5 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 text-center text-ink-2">
                        <ShoppingCart size={32} className="text-ink-3" aria-hidden="true" />
                        <p className="mt-3 text-sm">Your cart is feeling lonely</p>
                    </div>
                )}
            </div>
            <div className="shrink-0 space-y-5 border-t border-line bg-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
                <div className="flex items-end justify-between border-b border-line pb-4">
                    <span className="text-sm font-medium text-ink-2">Order Total</span>
                    <span className="num text-2xl font-semibold text-ink">{peso(total)}</span>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-ink">Customer Profile</h3>
                        <button type="button" onClick={() => updateCartQuantity('clear')} className="btn-ghost text-red-400 hover:bg-red-500/10 hover:text-red-300">Clear Order</button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        <div className="relative z-30">
                            <label htmlFor={`${idPrefix}-customer-name`} className="field-label">Full Name</label>
                            <input id={`${idPrefix}-customer-name`} className="field" placeholder="Full Name" value={customerName} onChange={e => { setCustomerName(e.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} />
                            {showSuggestions && customerSuggestions?.length > 0 && (
                                <div className="absolute left-0 top-full z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-raised shadow-lift">
                                    {customerSuggestions.map(c => <button key={c.id} type="button" onClick={() => handleSelectCustomer(c)} className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-sm transition-colors last:border-0 hover:bg-white/[0.04]"><span className="font-semibold text-ink">{c.name}</span>{c.total_spent > 0 && <span className="num text-ink-2">{peso(c.total_spent)}</span>}</button>)}
                                </div>
                            )}
                        </div>
                        <div>
                            <label htmlFor={`${idPrefix}-customer-contact`} className="field-label">Contact Number</label>
                            <input id={`${idPrefix}-customer-contact`} className="field" placeholder="Contact Number" value={customerContact} onChange={e => setCustomerContact(e.target.value)} />
                        </div>
                    </div>

                    <div className="flex gap-2" role="group" aria-label="Shipping region">
                        <button type="button" onClick={() => setShippingRegion('MM')} className="chip flex-1 justify-center" aria-pressed={shippingRegion === 'MM'}>Metro Manila</button>
                        <button type="button" onClick={() => setShippingRegion('Provincial')} className="chip flex-1 justify-center" aria-pressed={shippingRegion === 'Provincial'}>Provincial</button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        {shippingRegion === 'Provincial' && (
                            <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
                                <label htmlFor={`${idPrefix}-province`} className="field-label">Province</label>
                                <select id={`${idPrefix}-province`} className="field" value={provinceCode} onChange={e => { setProvinceCode(e.target.value); setCustomerProvince(e.target.options[e.target.selectedIndex].text); }}><option value="" disabled>Select Province</option>{provincesList.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
                            </div>
                        )}
                        <div>
                            <label htmlFor={`${idPrefix}-city`} className="field-label">City / Town</label>
                            <select id={`${idPrefix}-city`} className="field" value={cityCode} onChange={e => { setCityCode(e.target.value); setCustomerCity(e.target.options[e.target.selectedIndex].text); }} disabled={!citiesList.length}><option value="" disabled>City / Town</option>{citiesList.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                        </div>
                        <div>
                            <label htmlFor={`${idPrefix}-barangay`} className="field-label">Barangay</label>
                            <select id={`${idPrefix}-barangay`} className="field" value={customerBarangay} onChange={e => setCustomerBarangay(e.target.value)} disabled={!barangaysList.length}><option value="" disabled>Barangay</option>{barangaysList.map(b => <option key={b.code} value={b.name}>{b.name}</option>)}</select>
                        </div>
                    </div>

                    <div>
                        <label htmlFor={`${idPrefix}-address`} className="field-label">Street Address / Room / landmarks</label>
                        <input id={`${idPrefix}-address`} className="field" placeholder="Street Address / Room / landmarks" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        <div>
                            <label htmlFor={`${idPrefix}-payment-mode`} className="field-label">Payment mode</label>
                            <select id={`${idPrefix}-payment-mode`} className="field" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>{PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select>
                        </div>
                        <div>
                            <label htmlFor={`${idPrefix}-payment-status`} className="field-label">Payment status</label>
                            <select id={`${idPrefix}-payment-status`} disabled={isReseller} className="field capitalize" value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>{['unpaid', 'paid'].map(s => <option key={s} value={s}>{s}</option>)}</select>
                        </div>
                    </div>

                    {!isReseller && (
                        <div>
                            <label htmlFor={`${idPrefix}-fulfillment-status`} className="field-label">Fulfillment status</label>
                            <select id={`${idPrefix}-fulfillment-status`} className="field capitalize" value={fulfillmentStatus} onChange={e => setFulfillmentStatus(e.target.value)}>{['pending', 'in_progress', 'ready', 'shipped'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
                        </div>
                    )}
                </div>

                <button type="button" onClick={handleCheckout} disabled={checkoutLoading || cart.length === 0} className="btn-primary h-12 w-full text-base font-semibold">
                    {checkoutLoading ? <Loader2 className="animate-spin" aria-label="Processing" /> : 'Confirm order'}
                </button>
            </div>
        </div>
    );
};