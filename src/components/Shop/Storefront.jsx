import React, { useState, useMemo, useRef } from 'react';
import clsx from 'clsx';
import {
    ArrowLeft, Building2, CheckCircle2, Copy, CreditCard, ExternalLink, ImageOff, Loader2, MapPin, Minus,
    PackageSearch, Plus, Search, ShoppingBag, Ticket, Truck, Upload, Wallet, X, Zap
} from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { rememberTracking, trackOrder, uploadReceipt } from '../../lib/publicShopApi';
import { useToast } from '../ui/Toast';
import Dialog from '../ui/Dialog';
import Logo from '../ui/Logo';
import { getMMCities, getAllProvinces, getCitiesByProvince, getBarangays } from '../../lib/phLocations';
import { getSizeGuideForBrand } from '../../data/sizeGuides';
import { getStockKey } from '../../lib/inventory';
import { getBallUnitPrice, getCartUnitPrice, isBallProduct, priceOrder } from '../../lib/orderPricing';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const BALL_QUANTITIES = [1, 5, 10, 20, 50, 100];
const PAYMENT_OPTIONS = [
    { value: 'COD', label: 'Cash on delivery', detail: 'Pay the courier when it arrives' },
    { value: 'Gcash', label: 'GCash', detail: 'Scan the QR, then upload your receipt' },
    { value: 'Bank Transfer', label: 'Bank transfer', detail: 'Scan the QR, then upload your receipt' },
];

const peso = (value, options) => `₱${(Number(value) || 0).toLocaleString(undefined, options)}`;
const productKind = (product) => {
    if (isBallProduct(product)) return 'ball';
    if (product.category && product.category !== 'shirts') return 'item';
    return 'shirt';
};

function StoreHeader({ itemCount, onOpenBag, onTrack }) {
    return (
        <>
            <div className="border-b border-line bg-raised">
                <p className="mx-auto flex h-9 max-w-7xl items-center justify-center gap-2 px-4 text-center text-[13px] font-medium text-ink">
                    <Truck size={15} className="shrink-0 text-primary" aria-hidden="true" />
                    Order by Thursday, ships Sunday via LBC
                </p>
            </div>
            <header className="sticky top-0 z-40 border-b border-line bg-ground">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                    <a href="/" className="-ml-1 rounded-md p-1" aria-label="SportsTech home">
                        <Logo className="h-9 sm:h-10" />
                    </a>
                    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Shop">
                        <button type="button" onClick={onTrack} className="btn-ghost hidden sm:inline-flex">
                            <PackageSearch size={18} aria-hidden="true" /> Track order
                        </button>
                        <button type="button" onClick={onTrack} className="icon-btn sm:hidden" aria-label="Track an order">
                            <PackageSearch size={22} />
                        </button>
                        <button type="button" onClick={onOpenBag} className="relative inline-flex h-11 items-center gap-2 rounded-full pr-3 pl-2.5 text-ink hover:bg-white/8 sm:pr-4 sm:pl-3.5"
                            aria-label={`Open bag, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}>
                            <ShoppingBag size={22} aria-hidden="true" />
                            <span className="hidden text-[15px] font-semibold sm:inline">Bag</span>
                            <span key={itemCount} className={clsx(
                                'num inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-6',
                                itemCount > 0 ? 'animate-bump bg-primary-strong text-white' : 'bg-raised text-ink-2'
                            )}>{itemCount}</span>
                        </button>
                    </nav>
                </div>
            </header>
        </>
    );
}

function Hero({ onTrack }) {
    return (
        <section className="relative isolate overflow-hidden border-b border-line" aria-labelledby="store-title">
            <div className="absolute inset-0 -z-10 lg:left-auto lg:w-1/2" aria-hidden="true">
                <img src="/hero-court.jpg" alt="" width="585" height="455" fetchPriority="high"
                    className="size-full object-cover object-[22%_45%] lg:object-[30%_50%]" />
                <div className="absolute inset-0 bg-gradient-to-t from-ground from-10% via-ground/80 to-ground/30 lg:bg-gradient-to-r lg:from-ground lg:from-0% lg:via-ground/0 lg:via-30% lg:to-transparent" />
            </div>
            <div className="mx-auto max-w-7xl">
                <div className="flex min-h-[312px] flex-col justify-end px-4 pt-14 pb-6 sm:min-h-[420px] sm:px-6 sm:pb-10 lg:min-h-[540px] lg:w-1/2 lg:justify-center lg:px-8 lg:py-16">
                    <h1 id="store-title" className="display max-w-[11ch] text-[50px] italic sm:text-7xl lg:text-8xl">
                        Shirts &amp; pickleball gear
                    </h1>
                    <p className="mt-3 max-w-md text-[15px] text-ink-2 sm:mt-4 sm:text-lg">
                        Custom and plain shirts, pickleball balls and accessories from SportsTech PH, shipped anywhere in the Philippines.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3 sm:mt-7">
                        <a href="#shop" className="btn-primary h-12 px-7">Shop now</a>
                        <button type="button" onClick={onTrack} className="btn-secondary h-12 px-6">Track an order</button>
                    </div>
                </div>
            </div>
        </section>
    );
}

const FACTS = [
    { icon: Truck, title: 'Shipping from ₱100', detail: '₱100 Metro Manila, ₱200 provincial via LBC' },
    { icon: Wallet, title: 'GCash, bank or COD', detail: 'GCash and bank transfers need a receipt upload' },
    { icon: PackageSearch, title: 'Track by phone', detail: 'Check your order status with your mobile number' },
];

function Facts() {
    return (
        <section aria-label="Shipping, payment and tracking" className="border-b border-line">
            <ul className="mx-auto grid max-w-7xl grid-cols-3 divide-x divide-line">
                {FACTS.map(({ icon: Icon, title, detail }) => (
                    <li key={title} className="flex flex-col gap-1.5 px-3 py-3.5 sm:flex-row sm:items-center sm:gap-3 sm:px-6 sm:py-5 lg:px-8">
                        <Icon size={20} className="shrink-0 text-primary" aria-hidden="true" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold leading-tight sm:text-[15px]">{title}</p>
                            <p className="mt-0.5 hidden text-sm text-ink-2 sm:block">{detail}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function ProductImage({ src, alt = '', className }) {
    if (!src) {
        return (
            <div className={clsx('grid size-full place-items-center text-ink-3', className)}>
                <ImageOff size={32} aria-hidden="true" />
            </div>
        );
    }
    return <img src={src} alt={alt} loading="lazy" decoding="async" className={clsx('size-full object-cover', className)} />;
}

function ProductTile({ product, onOpen }) {
    const kind = productKind(product);
    return (
        <li>
            <button type="button" onClick={() => onOpen(product)} className="group block w-full rounded-xl text-left">
                <div className="aspect-[4/5] overflow-hidden rounded-xl bg-well">
                    <ProductImage src={product.imageUrl} className="transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
                </div>
                <div className="mt-3 px-0.5">
                    <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink group-hover:underline">{product.name}</h3>
                    {product.brand && <p className="mt-0.5 truncate text-sm text-ink-2">{product.brand}</p>}
                    <p className="num mt-1.5 text-[15px] font-semibold text-ink">
                        {peso(product.price)}{kind === 'ball' && <span className="font-normal text-ink-2"> /pc</span>}
                    </p>
                </div>
            </button>
        </li>
    );
}

function ProductSheet({ product, getStock, onClose, onAdd }) {
    const kind = productKind(product);
    const images = product.images?.length ? product.images : [product.imageUrl].filter(Boolean);
    const [imageIdx, setImageIdx] = useState(0);
    const [size, setSize] = useState(null);
    const [quantity, setQuantity] = useState(null);
    const [showSizeGuide, setShowSizeGuide] = useState(false);
    const ready = kind === 'item' || (kind === 'shirt' ? Boolean(size) : Boolean(quantity));
    const addLabel = kind === 'shirt' && !size ? 'Select a size'
        : kind === 'ball' && !quantity ? 'Select a quantity'
            : kind === 'ball' ? `Add ${quantity} to bag · ${peso(getBallUnitPrice(quantity) * quantity)}`
                : 'Add to bag';

    const add = () => {
        if (!ready) return;
        if (kind === 'shirt') onAdd(product, size);
        else if (kind === 'ball') onAdd(product, 'N/A', quantity);
        else onAdd(product, 'N/A');
    };

    return (
        <Dialog onClose={onClose} title={product.name} description={product.brand || undefined} size="xl" closeLabel="Close product"
            footer={<button type="button" onClick={add} disabled={!ready} className="btn-primary h-12 w-full text-base">{addLabel}</button>}>
            <div className="grid gap-6 sm:grid-cols-2">
                <div>
                    <div className="mx-auto aspect-square max-h-[38dvh] overflow-hidden rounded-xl bg-well sm:max-h-none">
                        <ProductImage src={images[imageIdx]} alt={images.length ? `${product.name}, image ${imageIdx + 1} of ${images.length}` : ''} />
                    </div>
                    {images.length > 1 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide" role="group" aria-label="Product images">
                            {images.map((img, idx) => (
                                <button key={img + idx} type="button" onClick={() => setImageIdx(idx)} aria-pressed={imageIdx === idx}
                                    aria-label={`Show image ${idx + 1}`}
                                    className={clsx('size-16 shrink-0 overflow-hidden rounded-lg border-2 bg-well transition-colors',
                                        imageIdx === idx ? 'border-ink' : 'border-transparent opacity-60 hover:opacity-100')}>
                                    <img src={img} alt="" className="size-full object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col">
                    <p className="num text-2xl font-semibold">
                        {kind === 'ball' ? <>{peso(getBallUnitPrice(1))}<span className="text-base font-normal text-ink-2"> per piece</span></> : peso(product.price)}
                    </p>

                    {kind === 'shirt' && (
                        <div className="mt-6">
                            <div className="flex items-center justify-between">
                                <h3 id="size-label" className="font-semibold">Select size</h3>
                                <button type="button" onClick={() => setShowSizeGuide(value => !value)} aria-expanded={showSizeGuide}
                                    className="text-sm font-medium text-ink-2 underline hover:text-ink">
                                    {showSizeGuide ? 'Hide size guide' : 'Size guide'}
                                </button>
                            </div>
                            {showSizeGuide && (
                                <div className="mt-3 overflow-hidden rounded-lg border border-line">
                                    <table className="w-full text-center text-sm">
                                        <caption className="sr-only">Size guide for {product.brand}</caption>
                                        <thead className="bg-raised text-ink-2">
                                            <tr><th className="py-2 font-semibold">Size</th><th className="py-2 font-semibold">Chest</th><th className="py-2 font-semibold">Height</th></tr>
                                        </thead>
                                        <tbody>
                                            {getSizeGuideForBrand(product.brand).map(row => (
                                                <tr key={row.s} className="border-t border-line">
                                                    <th scope="row" className="py-2 font-semibold">{row.s}</th>
                                                    <td className="py-2 text-ink-2">{row.c}</td>
                                                    <td className="py-2 text-ink-2">{row.h}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className="border-t border-line px-3 py-2 text-xs text-ink-2">Measurements for {product.brand}.</p>
                                </div>
                            )}
                            <div role="radiogroup" aria-labelledby="size-label" className="mt-3 grid grid-cols-3 gap-2">
                                {SIZES.map(option => {
                                    const available = getStock(product, option) > 0;
                                    return (
                                        <button key={option} type="button" role="radio" aria-checked={size === option} disabled={!available}
                                            onClick={() => setSize(option)}
                                            className={clsx('h-12 rounded-lg border text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through',
                                                size === option ? 'border-ink bg-ink text-ground' : 'border-slate-600 hover:border-slate-300')}>
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {kind === 'ball' && (
                        <div className="mt-6">
                            <h3 id="qty-label" className="font-semibold">Select quantity</h3>
                            <p className="mt-1 text-sm text-ink-2">₱90 each from 21 pieces, ₱80 from 50, ₱70 from 100.</p>
                            <div role="radiogroup" aria-labelledby="qty-label" className="mt-3 grid grid-cols-3 gap-2">
                                {BALL_QUANTITIES.map(option => (
                                    <button key={option} type="button" role="radio" aria-checked={quantity === option} onClick={() => setQuantity(option)}
                                        className={clsx('rounded-lg border px-2 py-3 text-center transition-colors',
                                            quantity === option ? 'border-ink bg-ink text-ground' : 'border-slate-600 hover:border-slate-300')}>
                                        <span className="block text-lg font-bold leading-none">{option} {option === 1 ? 'pc' : 'pcs'}</span>
                                        <span className={clsx('num mt-1.5 block text-xs', quantity === option ? 'text-ground/70' : 'text-ink-2')}>{peso(getBallUnitPrice(option))}/pc</span>
                                        <span className="num mt-0.5 block text-sm font-semibold">{peso(getBallUnitPrice(option) * option)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {kind === 'shirt' && (
                        <p className="mt-6 text-sm text-ink-2">Rush printing is available at checkout for ₱100 per shirt.</p>
                    )}
                </div>
            </div>
        </Dialog>
    );
}

function Field({ id, label, children, hint }) {
    return (
        <div>
            <label htmlFor={id} className="field-label">{label}</label>
            {children}
            {hint && <p className="mt-1.5 text-xs text-ink-2">{hint}</p>}
        </div>
    );
}

function ChoiceCard({ name, value, checked, onChange, icon: Icon, label, detail, aside }) {
    return (
        <label className={clsx('relative flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
            checked ? 'border-ink bg-white/[0.04]' : 'border-line hover:border-slate-600')}>
            <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
            <span className={clsx('grid size-5 shrink-0 place-items-center rounded-full border-2', checked ? 'border-ink' : 'border-slate-600')} aria-hidden="true">
                {checked && <span className="size-2.5 rounded-full bg-ink" />}
            </span>
            {Icon && <Icon size={20} className="shrink-0 text-ink-2" aria-hidden="true" />}
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{label}</span>
                {detail && <span className="block text-sm text-ink-2">{detail}</span>}
            </span>
            {aside && <span className="num shrink-0 text-[15px] font-semibold">{aside}</span>}
        </label>
    );
}

export default function Storefront({ catalog }) {
    const { showToast } = useToast();
    const { products = [], stock: rawInventory = {}, brands = [], vouchers = [] } = catalog || {};
    const checkoutRequest = useRef(null);
    const checkoutInFlight = useRef(false);

    const [cart, setCart] = useState([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [bagStep, setBagStep] = useState('bag');
    const [activeProduct, setActiveProduct] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedBrand, setSelectedBrand] = useState('All');
    const [lastOrderId, setLastOrderId] = useState('');
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
    const [proofUrl, setProofUrl] = useState('');
    const [proofReceipt, setProofReceipt] = useState(null);
    const [uploadingProof, setUploadingProof] = useState(false);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [orderComplete, setOrderComplete] = useState(false);
    const [isRushOrder, setIsRushOrder] = useState(false);
    const [qrFailed, setQrFailed] = useState(false);

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

    const filteredProducts = useMemo(() => products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesBrand = selectedBrand === 'All' || p.brand === selectedBrand;
        return matchesSearch && matchesBrand;
    }), [products, searchTerm, selectedBrand]);
    const productsByName = useMemo(() => new Map(products.map(product => [product.name, product])), [products]);
    React.useEffect(() => () => { if (proofUrl) URL.revokeObjectURL(proofUrl); }, [proofUrl]);

    const getStock = (product, size) => {
        if (!product.linkedColor || product.category !== 'shirts') {
            if (product.category && product.category !== 'shirts') {
                const key = getStockKey(product);
                return typeof rawInventory[key] === 'number' ? rawInventory[key] : 999;
            }
            return 999;
        }
        // Shirts are pre-ordered/print-on-demand, so default to infinite (999) stock
        return 999;
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
            return [...prev, { ...product, size, cartId, quantity, price: getCartUnitPrice(product, quantity) }];
        });
        setActiveProduct(null);
        showToast(`Added to bag: ${product.name}${size !== 'N/A' ? `, size ${size}` : ''}`, 'success');
    };

    const updateQuantity = (cartId, delta) => {
        setCart(prev => prev.map(item => {
            if (item.cartId === cartId) {
                const newQty = Math.max(0, item.quantity + delta);
                return { ...item, quantity: newQty, price: newQty > 0 ? getCartUnitPrice(item, newQty) : item.price };
            }
            return item;
        }).filter(i => i.quantity > 0));
    };

    // Voucher logic
    const [voucherCode, setVoucherCode] = useState('');
    const [appliedVoucher, setAppliedVoucher] = useState(null);

    const pricingOptions = useMemo(() => ({
        discount: appliedVoucher ? { type: appliedVoucher.discountType, value: Number(appliedVoucher.value) } : null,
        shippingFee: shippingRegion === 'MM' ? 100 : 200,
        isRushOrder,
        rushFeePerShirt: 100
    }), [appliedVoucher, shippingRegion, isRushOrder]);
    const cartPricing = useMemo(() => priceOrder(cart.map(item => ({
        ...item, id: item.cartId, unitPrice: getCartUnitPrice(item)
    })), pricingOptions), [cart, pricingOptions]);
    const { subtotal, discountAmount, rushFeeAmount } = cartPricing;
    const rushableItemsCount = useMemo(() => cart.reduce((total, item) => {
        const product = productsByName.get(item.name);
        const isShirt = !isBallProduct(item) && (!product || !product.category || product.category === 'shirts');
        return isShirt ? total + (Number(item.quantity) || 0) : total;
    }, 0), [cart, productsByName]);
    const itemCount = cart.reduce((total, item) => total + item.quantity, 0);

    // Suggestive selling
    const suggestedProducts = useMemo(() => {
        const cartNames = new Set(cart.map(item => item.name));
        return products
            .filter(p => !cartNames.has(p.name))
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

    const handleApplyVoucher = () => {
        if (!voucherCode.trim()) return;

        const voucher = vouchers.find(entry => entry.code.toUpperCase() === voucherCode.trim().toUpperCase());

        if (!voucher || !voucher.active) {
            showToast('Invalid or inactive voucher', 'error');
            setAppliedVoucher(null);
            return;
        }

        const details = voucher;
        const value = Number(details.value);
        if (!['fixed', 'percent'].includes(details.discountType) || !Number.isFinite(value) || value < 0
            || (details.discountType === 'percent' && value > 100)) {
            showToast('This voucher is not configured correctly. Please contact the store.', 'error');
            return;
        }

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
            const uniqueUses = details.used || 0;

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
            const receipt = await uploadReceipt(file);
            setProofReceipt(receipt);
            setProofUrl(URL.createObjectURL(file));
            showToast('Receipt uploaded!', 'success');
        } catch (err) {
            console.error(err);
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            setUploadingProof(false);
            e.target.value = '';
        }
    };

    const handleCheckout = async () => {
        if (checkoutInFlight.current || uploadingProof) return;
        if (cart.length === 0) return showToast('Add an item before checking out.', 'error');
        if (!firstName.trim()) return showToast('Please enter your first name', 'error');
        if (!lastName.trim()) return showToast('Please enter your last name', 'error');
        if (!contactNumber.trim()) return showToast('Please enter your contact number', 'error');
        if (!shippingAddress || !city || (shippingRegion === 'Provincial' && !province) || !barangay) return showToast('Please complete shipping details', 'error');

        const customerName = `${firstName.trim()} ${lastName.trim()}`;

        // Payment Validation
        const requiresProof = ['Gcash', 'Bank Transfer'].includes(paymentMode);
        if (requiresProof && !proofReceipt) return showToast('Please upload proof of payment', 'error');

        checkoutInFlight.current = true;
        setCheckoutLoading(true);

        try {
            const intent = {
                items: cart.map(item => ({
                    productId: item.id, name: item.name, size: item.size,
                    color: item.linkedColor || 'Varied', quantity: item.quantity
                })),
                customerName, contactNumber, shippingDetails: { address: shippingAddress, city, province, barangay },
                region: shippingRegion, rush: isRushOrder, voucherCode: appliedVoucher?.code || null, paymentMode,
                ...(requiresProof ? { receipt: proofReceipt } : {})
            };
            const signature = JSON.stringify(intent);
            if (checkoutRequest.current && checkoutRequest.current.signature !== signature) {
                throw new Error('A previous checkout is unconfirmed. Restore that cart and retry, or track your order before starting a different checkout.');
            }
            checkoutRequest.current ||= { signature, requestId: crypto.randomUUID() };
            const result = await apiRequest('/api/public/checkout', {
                method: 'POST', body: { ...intent, requestId: checkoutRequest.current.requestId }
            });
            rememberTracking(result.orderId, result.token);

            setOrderComplete(true);
            setLastOrderId(result.orderId);
            checkoutRequest.current = null;
            setCart([]);
            setProofUrl('');
            setProofReceipt(null);
            setAppliedVoucher(null);
            setVoucherCode('');
            setIsCartOpen(false);
            setBagStep('bag');
            window.scrollTo(0, 0);
        } catch (err) {
            if (['invalid_input', 'payload_too_large', 'catalog_changed', 'receipt_conflict'].includes(err.code)) checkoutRequest.current = null;
            console.error(err);
            showToast(`Order could not be confirmed: ${err.message || 'Please check your connection and try again.'}`, 'error');
        } finally {
            checkoutInFlight.current = false;
            setCheckoutLoading(false);
        }
    };

    const handleTrackOrder = async (event) => {
        event?.preventDefault();
        if (!trackingContact.trim()) return showToast('Please enter your contact number', 'error');

        setIsSearchingOrder(true);
        try {
            const { order } = await trackOrder(trackingContact.trim());
            setIsTrackModalOpen(false);
            window.location.href = `/track/${order.id}`;
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Search failed. Please try again.', 'error');
        } finally {
            setIsSearchingOrder(false);
        }
    };

    const openBag = () => { setBagStep('bag'); setIsCartOpen(true); };
    const trackingUrl = `${window.location.origin}/track/${lastOrderId}`;

    if (orderComplete) {
        return (
            <div className="min-h-dvh bg-ground text-ink">
                <header className="border-b border-line">
                    <div className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
                        <a href="/" aria-label="SportsTech home"><Logo className="h-9 sm:h-10" /></a>
                    </div>
                </header>
                <main className="mx-auto w-full max-w-lg px-4 py-14 sm:py-20">
                    <CheckCircle2 size={52} className="text-emerald-400" aria-hidden="true" />
                    <h1 className="display mt-5 text-5xl sm:text-6xl">Order placed</h1>
                    <p className="mt-3 text-lg text-ink-2">Thank you, {firstName}. We've received your order and will begin processing it shortly.</p>

                    <section className="surface mt-8 p-5" aria-labelledby="tracking-link-title">
                        <h2 id="tracking-link-title" className="font-semibold">Your tracking link</h2>
                        <div className="mt-3 flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ground px-3 py-2.5 text-sm text-ink-2">{trackingUrl}</code>
                            <button type="button" className="icon-btn border border-line" aria-label="Copy tracking link"
                                onClick={() => { navigator.clipboard.writeText(trackingUrl); showToast('Tracking link copied!', 'success'); }}>
                                <Copy size={18} />
                            </button>
                        </div>
                        <p className="mt-3 text-sm text-ink-2">Use your contact number to verify and track in real time.</p>
                    </section>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                        <a href={`/track/${lastOrderId}`} className="btn-light h-12"><ExternalLink size={18} aria-hidden="true" /> View order status</a>
                        <button type="button" className="btn-secondary h-12"
                            onClick={() => { setOrderComplete(false); setFirstName(''); setLastName(''); setLastOrderId(''); }}>
                            Place another order
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    const requiresProof = ['Gcash', 'Bank Transfer'].includes(paymentMode);
    const showStickyBag = cart.length > 0 && !isCartOpen && !activeProduct;

    return (
        <div className="min-h-dvh bg-ground text-ink">
            <a href="#shop" className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-ground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to products</a>
            <StoreHeader itemCount={itemCount} onOpenBag={openBag} onTrack={() => setIsTrackModalOpen(true)} />

            <main>
                <Hero onTrack={() => setIsTrackModalOpen(true)} />
                <Facts />

                <section id="shop" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-7 pb-28 sm:px-6 sm:pt-14 lg:px-8" aria-labelledby="shop-title">
                    <div className="flex items-end justify-between gap-4">
                        <h2 id="shop-title" className="display text-4xl sm:text-5xl">{selectedBrand === 'All' ? 'All products' : selectedBrand}</h2>
                        <p className="num pb-1 text-sm text-ink-2" aria-live="polite">{filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'}</p>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:mt-5 md:flex-row md:items-center md:justify-between">
                        <div role="group" aria-label="Filter by brand" className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                            <button type="button" className="chip" aria-pressed={selectedBrand === 'All'} onClick={() => setSelectedBrand('All')}>All</button>
                            {brands.map(b => (
                                <button key={b.name} type="button" className="chip" aria-pressed={selectedBrand === b.name} onClick={() => setSelectedBrand(b.name)}>
                                    {b.name}
                                </button>
                            ))}
                        </div>
                        <div className="relative md:w-72">
                            <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
                            <input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                placeholder="Search products" aria-label="Search products" className="field rounded-full pl-10" />
                        </div>
                    </div>

                    {filteredProducts.length > 0 ? (
                        <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-8 sm:mt-6 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-10">
                            {filteredProducts.map(product => <ProductTile key={product.id} product={product} onOpen={setActiveProduct} />)}
                        </ul>
                    ) : (
                        <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
                            <Search size={32} className="mx-auto text-ink-3" aria-hidden="true" />
                            <p className="mt-4 font-semibold">{searchTerm ? `No products match "${searchTerm}"` : 'No products in this brand yet'}</p>
                            <button type="button" className="btn-secondary mt-5" onClick={() => { setSearchTerm(''); setSelectedBrand('All'); }}>Show all products</button>
                        </div>
                    )}
                </section>
            </main>

            <footer className="border-t border-line">
                <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6 lg:px-8">
                    <div>
                        <Logo className="h-10" />
                        <p className="mt-4 max-w-xs text-sm text-ink-2">Shirts and pickleball gear from SportsTech PH.</p>
                    </div>
                    <div>
                        <h2 className="section-title text-base">Orders</h2>
                        <ul className="mt-3 space-y-2 text-sm text-ink-2">
                            <li><button type="button" onClick={() => setIsTrackModalOpen(true)} className="underline hover:text-ink">Track an order</button></li>
                            <li>Cutoff every Thursday</li>
                            <li>Ships every Sunday via LBC</li>
                        </ul>
                    </div>
                    <div>
                        <h2 className="section-title text-base">Payment</h2>
                        <ul className="mt-3 space-y-2 text-sm text-ink-2">
                            <li>GCash</li>
                            <li>Bank transfer</li>
                            <li>Cash on delivery</li>
                        </ul>
                        <p className="mt-5 text-sm text-ink-2">
                            Questions? Message us on{' '}
                            <a href="https://facebook.com/sportstech.fb" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Facebook</a> or{' '}
                            <a href="https://instagram.com/sportstech.ig" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">Instagram</a>.
                        </p>
                    </div>
                </div>
                <div className="border-t border-line">
                    <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-ink-3 sm:px-6 lg:px-8">© {new Date().getFullYear()} SportsTech PH · www.sportstechph.store</p>
                </div>
            </footer>

            {showStickyBag && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ground px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
                    <button type="button" onClick={openBag} className="btn-primary h-12 w-full justify-between px-5 text-base">
                        <span>View bag ({itemCount})</span>
                        <span className="num">{peso(subtotal)}</span>
                    </button>
                </div>
            )}

            {activeProduct && (
                <ProductSheet product={activeProduct} getStock={getStock} onClose={() => setActiveProduct(null)} onAdd={addToCart} />
            )}

            {isCartOpen && bagStep === 'bag' && (
                <Dialog variant="drawer" onClose={() => setIsCartOpen(false)} title="Your bag" description={itemCount ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : undefined}
                    closeLabel="Close bag" bodyClassName="p-0"
                    footer={cart.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-baseline justify-between">
                                <span className="text-ink-2">Subtotal</span>
                                <span className="num text-lg font-semibold">{peso(subtotal)}</span>
                            </div>
                            <p className="text-xs text-ink-2">Shipping, rush printing and vouchers are added at checkout.</p>
                            <button type="button" onClick={() => setBagStep('checkout')} className="btn-primary h-12 w-full text-base">Checkout</button>
                        </div>
                    )}>
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center px-6 py-16 text-center">
                            <ShoppingBag size={40} className="text-ink-3" aria-hidden="true" />
                            <p className="mt-4 text-lg font-semibold">Your bag is empty</p>
                            <p className="mt-1 text-sm text-ink-2">Shirts and pickleball gear are waiting.</p>
                            <button type="button" className="btn-light mt-6" onClick={() => setIsCartOpen(false)}>Browse products</button>
                        </div>
                    ) : (
                        <ul className="divide-y divide-line">
                            {cart.map(item => (
                                <li key={item.cartId} className="flex gap-4 px-5 py-4">
                                    <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-well">
                                        <ProductImage src={item.imageUrl} />
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-semibold leading-snug">{item.name}</p>
                                            <p className="num shrink-0 font-semibold">{peso(getCartUnitPrice(item) * (Number(item.quantity) || 0))}</p>
                                        </div>
                                        <p className="mt-0.5 text-sm text-ink-2">
                                            {item.size !== 'N/A' ? `Size ${item.size}` : isBallProduct(item) ? `${peso(getCartUnitPrice(item))} per piece` : item.brand}
                                        </p>
                                        <div className="mt-auto flex items-center justify-between pt-2">
                                            <div className="flex items-center rounded-full border border-line">
                                                <button type="button" className="icon-btn size-10" aria-label={`Decrease quantity for ${item.name}`} onClick={() => updateQuantity(item.cartId, -1)}><Minus size={16} /></button>
                                                <span className="num w-8 text-center text-sm font-semibold" aria-label={`Quantity ${item.quantity}`}>{item.quantity}</span>
                                                <button type="button" className="icon-btn size-10" aria-label={`Increase quantity for ${item.name}`} onClick={() => updateQuantity(item.cartId, 1)}><Plus size={16} /></button>
                                            </div>
                                            <button type="button" className="text-sm text-ink-2 underline hover:text-ink" onClick={() => updateQuantity(item.cartId, -item.quantity)}>Remove</button>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {suggestedProducts.length > 0 && (
                        <section className="border-t border-line px-5 py-5" aria-labelledby="suggested-title">
                            <h3 id="suggested-title" className="section-title text-base">You may also like</h3>
                            <ul className="-mx-5 mt-3 flex snap-x gap-3 overflow-x-auto px-5 pb-1 scrollbar-hide">
                                {suggestedProducts.map(product => (
                                    <li key={product.id} className="w-36 shrink-0 snap-start">
                                        <button type="button" onClick={() => setActiveProduct(product)} className="group block w-full text-left">
                                            <div className="aspect-square overflow-hidden rounded-lg bg-well"><ProductImage src={product.imageUrl} /></div>
                                            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{product.name}</p>
                                            <p className="num mt-0.5 text-sm text-ink-2">{peso(product.price)}</p>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </Dialog>
            )}

            {isCartOpen && bagStep === 'checkout' && (
                <Dialog variant="drawer" onClose={() => setIsCartOpen(false)} title="Checkout" closeLabel="Close checkout"
                    headerExtra={<button type="button" className="icon-btn" aria-label="Back to bag" onClick={() => setBagStep('bag')}><ArrowLeft size={22} /></button>}
                    footer={(
                        <div className="space-y-3">
                            <div className="flex items-baseline justify-between">
                                <span className="font-semibold">Total</span>
                                <span className="num text-2xl font-bold">{peso(cartPricing.total)}</span>
                            </div>
                            <button type="button" onClick={handleCheckout} disabled={cart.length === 0 || checkoutLoading || uploadingProof}
                                className="btn-primary h-12 w-full text-base">
                                {checkoutLoading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Placing order…</> : 'Place order'}
                            </button>
                        </div>
                    )}>
                    <form className="space-y-8" onSubmit={e => { e.preventDefault(); handleCheckout(); }} noValidate>
                        <section className="space-y-4" aria-labelledby="ck-contact">
                            <h3 id="ck-contact" className="section-title">Contact</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <Field id="ck-first" label="First name">
                                    <input id="ck-first" className="field" autoComplete="given-name" required value={firstName} onChange={e => setFirstName(e.target.value)} />
                                </Field>
                                <Field id="ck-last" label="Last name">
                                    <input id="ck-last" className="field" autoComplete="family-name" required value={lastName} onChange={e => setLastName(e.target.value)} />
                                </Field>
                            </div>
                            <Field id="ck-phone" label="Mobile number" hint="We use this to verify your order when you track it.">
                                <input id="ck-phone" type="tel" inputMode="tel" className="field" autoComplete="tel" placeholder="09123456789" required value={contactNumber} onChange={e => setContactNumber(e.target.value)} />
                            </Field>
                        </section>

                        <section className="space-y-4" aria-labelledby="ck-delivery">
                            <h3 id="ck-delivery" className="section-title">Delivery</h3>
                            <div role="radiogroup" aria-label="Shipping area" className="grid gap-2">
                                <ChoiceCard name="region" value="MM" checked={shippingRegion === 'MM'} onChange={() => setShippingRegion('MM')}
                                    icon={Building2} label="Metro Manila" detail="LBC standard shipping" aside="₱100" />
                                <ChoiceCard name="region" value="Provincial" checked={shippingRegion === 'Provincial'} onChange={() => setShippingRegion('Provincial')}
                                    icon={MapPin} label="Outside Metro Manila" detail="LBC standard shipping" aside="₱200" />
                            </div>
                            {shippingRegion === 'Provincial' && (
                                <Field id="ck-province" label="Province">
                                    <select id="ck-province" className="field" value={provinceCode} onChange={e => {
                                        const code = e.target.value;
                                        const name = e.target.options[e.target.selectedIndex].text;
                                        setProvinceCode(code);
                                        setProvince(name);
                                    }}>
                                        <option value="" disabled>Select province</option>
                                        {provincesList.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                                    </select>
                                </Field>
                            )}
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field id="ck-city" label="City / municipality">
                                    <select id="ck-city" className="field" value={cityCode} disabled={!citiesList.length} onChange={e => {
                                        const code = e.target.value;
                                        const name = e.target.options[e.target.selectedIndex].text;
                                        setCityCode(code);
                                        setCity(name);
                                    }}>
                                        <option value="" disabled>Select city</option>
                                        {citiesList.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                                    </select>
                                </Field>
                                <Field id="ck-barangay" label="Barangay">
                                    <select id="ck-barangay" className="field" value={barangay} disabled={!barangaysList.length} onChange={e => setBarangay(e.target.value)}>
                                        <option value="" disabled>Select barangay</option>
                                        {barangaysList.map(b => <option key={b.code} value={b.name}>{b.name}</option>)}
                                    </select>
                                </Field>
                            </div>
                            <Field id="ck-street" label="Street address">
                                <input id="ck-street" className="field" autoComplete="street-address" placeholder="House no., street, building" required value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} />
                            </Field>
                            <div className="rounded-xl border border-line bg-raised p-4 text-sm">
                                <p className="font-semibold">Standard shipping: LBC, {shippingRegion === 'MM' ? '₱100' : '₱200'} fixed rate</p>
                                <p className="mt-1 text-ink-2">Cutoff every Thursday. Shipping day every Sunday.</p>
                                <p className="mt-1 text-ink-2">For other couriers (J&amp;T, Lalamove), buyer shoulders the cost.</p>
                            </div>
                        </section>

                        <section className="space-y-3" aria-labelledby="ck-options">
                            <h3 id="ck-options" className="section-title">Options</h3>
                            <label className={clsx('flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors', isRushOrder ? 'border-ink bg-white/[0.04]' : 'border-line hover:border-slate-600')}>
                                <input type="checkbox" checked={isRushOrder} onChange={e => setIsRushOrder(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
                                <span className="flex-1">
                                    <span className="flex items-center gap-2 text-[15px] font-semibold"><Zap size={16} className="text-amber-400" aria-hidden="true" /> Rush order (priority processing)</span>
                                    <span className="block text-sm text-ink-2">₱100 additional fee per shirt</span>
                                </span>
                            </label>
                        </section>

                        <section className="space-y-3" aria-labelledby="ck-payment">
                            <h3 id="ck-payment" className="section-title">Payment</h3>
                            <div role="radiogroup" aria-labelledby="ck-payment" className="grid gap-2">
                                {PAYMENT_OPTIONS.map(option => (
                                    <ChoiceCard key={option.value} name="payment" value={option.value} checked={paymentMode === option.value}
                                        onChange={() => setPaymentMode(option.value)} icon={option.value === 'COD' ? Wallet : CreditCard}
                                        label={option.label} detail={option.detail} />
                                ))}
                            </div>
                            {requiresProof && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="flex flex-col items-center rounded-xl bg-white p-4 text-center text-neutral-900">
                                        <p className="text-xs font-bold tracking-wide uppercase text-neutral-600">Scan to pay now</p>
                                        {qrFailed ? (
                                            <p className="grid h-44 place-items-center text-sm text-neutral-600">QR unavailable. Contact the store for payment details.</p>
                                        ) : (
                                            <img src="/payment-qr.jpeg" alt="SportsTech payment QR code" onError={() => setQrFailed(true)} className="mt-2 h-auto w-full max-w-[180px] rounded-md" />
                                        )}
                                        <p className="mt-2 text-xs font-medium text-neutral-700">Verify the "Sports Tech" name before paying</p>
                                    </div>
                                    <div className="flex flex-col">
                                        <p className="field-label">Proof of payment</p>
                                        {proofUrl ? (
                                            <div className="relative flex-1 overflow-hidden rounded-xl border border-line bg-ground">
                                                <img src={proofUrl} alt="Uploaded payment receipt" className="h-full max-h-56 w-full object-contain" />
                                                <button type="button" onClick={() => { setProofUrl(''); setProofReceipt(null); }}
                                                    className="absolute top-2 right-2 inline-flex h-9 items-center gap-1 rounded-full bg-ground/90 px-3 text-sm font-semibold hover:bg-ground">
                                                    <X size={14} aria-hidden="true" /> Remove
                                                </button>
                                            </div>
                                        ) : (
                                            <label className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 p-6 text-center transition-colors hover:border-slate-400 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
                                                {uploadingProof ? (
                                                    <><Loader2 size={22} className="animate-spin text-ink-2" aria-hidden="true" /><span className="text-sm text-ink-2">Uploading…</span></>
                                                ) : (
                                                    <><Upload size={22} className="text-ink-2" aria-hidden="true" /><span className="text-sm font-semibold">Upload receipt</span><span className="text-xs text-ink-2">Screenshot or photo</span></>
                                                )}
                                                <input type="file" accept="image/*" className="sr-only" onChange={handleUploadProof} disabled={uploadingProof} />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className="space-y-3" aria-labelledby="ck-voucher">
                            <h3 id="ck-voucher" className="section-title">Voucher</h3>
                            {!appliedVoucher ? (
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Ticket size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
                                        <input aria-label="Voucher code" placeholder="Voucher code" value={voucherCode}
                                            onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyVoucher(); } }}
                                            className="field pl-10 uppercase" />
                                    </div>
                                    <button type="button" onClick={handleApplyVoucher} className="btn-secondary">Apply</button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2 pr-2 pl-4">
                                    <span className="flex items-center gap-2 text-sm font-semibold text-emerald-300"><CheckCircle2 size={16} aria-hidden="true" /> {appliedVoucher.code} applied</span>
                                    <button type="button" onClick={handleRemoveVoucher} className="btn-ghost min-h-9 text-sm">Remove</button>
                                </div>
                            )}
                        </section>

                        <section aria-labelledby="ck-summary" className="rounded-xl border border-line p-4">
                            <h3 id="ck-summary" className="section-title text-base">Order summary</h3>
                            <dl className="num mt-3 space-y-2 text-sm">
                                <div className="flex justify-between"><dt className="text-ink-2">Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})</dt><dd>{peso(subtotal)}</dd></div>
                                <div className="flex justify-between"><dt className="text-ink-2">Shipping ({shippingRegion === 'MM' ? 'Metro Manila' : 'Provincial'})</dt><dd>{peso(cartPricing.shippingFee)}</dd></div>
                                {appliedVoucher && (
                                    <div className="flex justify-between text-emerald-300"><dt>Voucher ({appliedVoucher.code})</dt><dd>−{peso(discountAmount, { maximumFractionDigits: 2 })}</dd></div>
                                )}
                                {isRushOrder && (
                                    <div className="flex justify-between"><dt className="text-ink-2">Rush fee (₱100/shirt × {rushableItemsCount})</dt><dd>{peso(rushFeeAmount)}</dd></div>
                                )}
                            </dl>
                            {appliedVoucher && discountAmount > 0 && (
                                <p className="mt-3 text-sm font-semibold text-emerald-300">You're saving {peso(discountAmount)}</p>
                            )}
                        </section>
                    </form>
                </Dialog>
            )}

            {isTrackModalOpen && (
                <Dialog onClose={() => setIsTrackModalOpen(false)} title="Track your order" description="Enter the mobile number used during checkout." size="sm" closeLabel="Close tracking">
                    <form onSubmit={handleTrackOrder} className="space-y-4">
                        <Field id="track-phone" label="Mobile number" hint="This finds your most recent order.">
                            <input id="track-phone" data-autofocus type="tel" inputMode="tel" autoComplete="tel" placeholder="09123456789"
                                value={trackingContact} onChange={e => setTrackingContact(e.target.value)} className="field" />
                        </Field>
                        <button type="submit" disabled={isSearchingOrder} className="btn-primary h-12 w-full">
                            {isSearchingOrder ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Finding…</> : 'Find my order'}
                        </button>
                    </form>
                </Dialog>
            )}
        </div>
    );
}
