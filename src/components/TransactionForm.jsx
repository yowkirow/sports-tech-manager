import React, { useState, useEffect } from 'react';
import { PlusCircle, MinusCircle, Calculator } from 'lucide-react';
import { useColors } from '../hooks/useInventory';
import { useReadOnly, READ_ONLY_HINT } from './ui/ReadOnly';

const TransactionForm = ({ onAddTransaction, transactions = [] }) => {
    const [type, setType] = useState('expense'); // 'expense' or 'sale'
    const [category, setCategory] = useState('blanks'); // blanks, dtf, accessories

    // Fields
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [customerName, setCustomerName] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('White');
    const [subCategory, setSubCategory] = useState('');
    const readOnly = useReadOnly();

    const colors = useColors(transactions);

    // Get unique customer names from previous sales for autocomplete
    const getCustomerSuggestions = () => {
        if (!transactions || !Array.isArray(transactions)) return [];

        const salesWithCustomers = transactions.filter(t =>
            t.type === 'sale' && t.details?.customerName
        );

        const uniqueNames = [...new Set(salesWithCustomers.map(t => t.details.customerName))];

        // Filter based on current input
        if (customerName.trim()) {
            return uniqueNames.filter(name =>
                name.toLowerCase().includes(customerName.toLowerCase())
            );
        }

        return uniqueNames;
    };

    const customerSuggestions = getCustomerSuggestions();

    // Fixed Pricing Logic
    const FIXED_SHIRT_PRICE = 70;
    const isFixedPrice = type === 'expense' && category === 'blanks';

    useEffect(() => {
        if (isFixedPrice) {
            const calculatedInitial = (parseInt(quantity) || 0) * FIXED_SHIRT_PRICE;
            setAmount(calculatedInitial.toString());
            setDescription(`${quantity}x Blank Shirts (${color}, ${size})`); // Auto-gen description
        } else {
            if (!amount && type === 'sale') setDescription('');
        }
    }, [quantity, category, type, isFixedPrice, size, color]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const finalAmount = isFixedPrice ? (parseInt(quantity) * FIXED_SHIRT_PRICE) : parseFloat(amount);

        if (!finalAmount && finalAmount !== 0) return;
        if (!description && !isFixedPrice) return;
        if (type === 'sale' && !customerName.trim()) {
            alert('Please enter customer name for sales');
            return;
        }

        let details = { quantity: parseInt(quantity) };

        if (type === 'sale' || category === 'blanks') {
            details = { ...details, size, linkedColor: color };
        } else if (category === 'accessories') {
            details = { ...details, subCategory };
        }

        if (type === 'sale' && customerName.trim()) {
            details = { ...details, customerName: customerName.trim() };
        }

        const newTransaction = {
            id: crypto.randomUUID(),
            type,
            amount: finalAmount,
            description: isFixedPrice ? `Bought ${quantity}x ${color} ${size} Blanks` :
                (type === 'sale' ? `Sold ${quantity}x ${color} ${size} to ${customerName}` : description),
            category: type === 'sale' ? 'sale' : category,
            date: new Date().toISOString(),
            details
        };

        onAddTransaction(newTransaction);
        if (!isFixedPrice) setAmount('');
        setDescription('');
        setQuantity('1');
        setSubCategory('');
        setCustomerName('');
        setShowSuggestions(false);
    };

    const showShirtDetails = type === 'sale' || category === 'blanks';

    return (
        <section className="surface overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <h2 className="section-title">{type === 'sale' ? 'Record Sale' : 'Add Item'}</h2>
                <div className="flex gap-2" aria-label="Transaction type">
                    <button
                        type="button"
                        aria-pressed={type === 'sale'}
                        onClick={() => setType('sale')}
                        disabled={readOnly}
                        title={readOnly ? READ_ONLY_HINT : undefined}
                        className="chip"
                    >
                        Sale
                    </button>
                    <button
                        type="button"
                        aria-pressed={type === 'expense'}
                        onClick={() => setType('expense')}
                        disabled={readOnly}
                        title={readOnly ? READ_ONLY_HINT : undefined}
                        className="chip"
                    >
                        Expense
                    </button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-4 sm:p-5">
                <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0 space-y-5">
                    {type === 'expense' && (
                    <div>
                        <label htmlFor="transaction-item-type" className="field-label">Item Type</label>
                        <select
                            id="transaction-item-type"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="field"
                        >
                            <option value="blanks">Blank Shirts (₱70/ea)</option>
                            <option value="dtf">DTF Prints</option>
                            <option value="accessories">Accessories</option>
                        </select>
                    </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="transaction-quantity" className="field-label">Quantity</label>
                        <input
                            id="transaction-quantity"
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            required
                            min="1"
                            step="1"
                            className="field num"
                        />
                    </div>

                    {isFixedPrice ? (
                        <div>
                            <p className="field-label">Total (₱70 x {quantity})</p>
                            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-raised px-3.5 py-2.5 font-semibold text-emerald-300 num">
                                <Calculator size={16} aria-hidden="true" />
                                ₱ {(parseInt(quantity) || 0) * FIXED_SHIRT_PRICE}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <label htmlFor="transaction-amount" className="field-label">{type === 'sale' ? "Sale Price" : "Cost (₱)"}</label>
                            <input
                                id="transaction-amount"
                                type="number"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                                min="0"
                                step="0.01"
                                className="field num"
                            />
                        </div>
                    )}
                    </div>

                    {showShirtDetails && (
                    <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-raised p-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="transaction-size" className="field-label">Size</label>
                            <select
                                id="transaction-size"
                                value={size}
                                onChange={(e) => setSize(e.target.value)}
                                className="field"
                            >
                                {['XS', 'S', 'M', 'L', 'XL', '2XL'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="transaction-color" className="field-label">Color</label>
                            <select
                                id="transaction-color"
                                value={color}
                                onChange={(e) => setColor(e.target.value)}
                                className="field"
                            >
                                {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                    </div>
                    )}

                    {type === 'sale' && (
                    <div className="relative rounded-xl border border-line bg-raised p-4">
                        <label htmlFor="transaction-customer-name" className="field-label">Customer Name *</label>
                        <input
                            id="transaction-customer-name"
                            type="text"
                            className="field"
                            placeholder="Enter customer name"
                            value={customerName}
                            onChange={(e) => {
                                setCustomerName(e.target.value);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                            required
                        />

                        {showSuggestions && customerSuggestions.length > 0 && (
                            <div className="absolute left-4 right-4 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-raised shadow-lift">
                                {customerSuggestions.map((name, index) => (
                                    <div
                                        key={index}
                                        onClick={() => {
                                            setCustomerName(name);
                                            setShowSuggestions(false);
                                        }}
                                        className="cursor-pointer border-b border-line px-3 py-2.5 text-sm text-ink last:border-0 hover:bg-white/[0.04]"
                                    >
                                        {name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    )}

                    {category === 'accessories' && type === 'expense' && (
                    <div className="rounded-xl border border-line bg-raised p-4">
                        <label htmlFor="transaction-item-name" className="field-label">Item Name</label>
                        <input
                            id="transaction-item-name"
                            placeholder="e.g. Stickers"
                            value={subCategory}
                            onChange={(e) => setSubCategory(e.target.value)}
                            required
                            className="field"
                        />
                    </div>
                    )}

                    {!isFixedPrice && (
                    <div>
                        <label htmlFor="transaction-description" className="field-label">Description / Note</label>
                        <input
                            id="transaction-description"
                            type="text"
                            placeholder={type === 'sale' ? "e.g. Sold to Customer A" : "e.g. Supplier XYZ"}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            required
                            className="field"
                        />
                    </div>
                    )}
                </fieldset>

                <div className="border-t border-line pt-4">
                    <button type="submit" disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} className="btn-primary w-full">
                        {type === 'sale' ? <PlusCircle size={18} aria-hidden="true" /> : <MinusCircle size={18} aria-hidden="true" />}
                        {type === 'sale' ? 'Add Sale Record' : (category === 'blanks' ? 'Add to Inventory' : 'Record Expense')}
                    </button>
                </div>
            </form>
        </section>
    );
};

export default TransactionForm;
