import React, { useState, useEffect } from 'react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import { PlusCircle, MinusCircle, Calculator } from 'lucide-react';

const TransactionForm = ({ onAddTransaction }) => {
    const [type, setType] = useState('expense'); // 'expense' or 'sale'
    const [category, setCategory] = useState('blanks'); // blanks, dtf, accessories

    // Fields
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('1');

    // Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('Black');
    const [subCategory, setSubCategory] = useState('');

    // Fixed Pricing Logic
    const FIXED_SHIRT_PRICE = 70;
    const isFixedPrice = type === 'expense' && category === 'blanks';

    useEffect(() => {
        if (isFixedPrice) {
            const calculatedInitial = (parseInt(quantity) || 0) * FIXED_SHIRT_PRICE;
            setAmount(calculatedInitial.toString());
            setDescription(`${quantity}x Blank Shirts (${color}, ${size})`); // Auto-gen description
        } else {
            // Clear if switching away? Maybe keep for user convenience
            if (!amount && type === 'sale') setDescription('');
        }
    }, [quantity, category, type, isFixedPrice, size, color]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const finalAmount = isFixedPrice ? (parseInt(quantity) * FIXED_SHIRT_PRICE) : parseFloat(amount);

        if (!finalAmount && finalAmount !== 0) return;
        if (!description && !isFixedPrice) return; // Description optional for fixed price since auto-generated

        let details = { quantity: parseInt(quantity) };

        if (type === 'sale' || category === 'blanks') {
            details = { ...details, size, color };
        } else if (category === 'accessories') {
            details = { ...details, subCategory };
        }

        const newTransaction = {
            id: crypto.randomUUID(),
            type,
            amount: finalAmount,
            description: isFixedPrice ? `Bought ${quantity}x ${color} ${size} Blanks` : description,
            category: type === 'sale' ? 'sale' : category,
            date: new Date().toISOString(),
            details
        };

        onAddTransaction(newTransaction);
        if (!isFixedPrice) setAmount('');
        setDescription('');
        setQuantity('1');
        setSubCategory('');
    };

    const showShirtDetails = type === 'sale' || category === 'blanks';

    return (
        <Card>
            <div className="form-header">
                <h2 style={{ margin: 0 }}>{type === 'sale' ? 'Record Sale' : 'Add Item'}</h2>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem', borderRadius: '8px' }}>
                    <Button
                        variant={type === 'sale' ? 'primary' : 'secondary'}
                        onClick={() => setType('sale')}
                        style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                    >
                        Sale
                    </Button>
                    <Button
                        variant={type === 'expense' ? 'primary' : 'secondary'}
                        onClick={() => setType('expense')}
                        style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', background: type === 'expense' ? 'var(--danger)' : '' }}
                    >
                        Expense
                    </Button>
                </div>
            </div>

            <form onSubmit={handleSubmit}>

                {/* Category Selection (Only for Expense) */}
                {type === 'expense' && (
                    <Select
                        label="Item Type"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        options={[
                            { value: 'blanks', label: 'Blank Shirts (₱70/ea)' },
                            { value: 'dtf', label: 'DTF Prints' },
                            { value: 'accessories', label: 'Accessories' }
                        ]}
                    />
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <Input
                        label="Quantity"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        required
                        min="1"
                        step="1"
                    />

                    {/* Amount Field - Read Only if Fixed Price */}
                    {isFixedPrice ? (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Total (₱70 x {quantity})
                            </label>
                            <div style={{
                                padding: '0.75rem 1rem',
                                background: 'rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                color: 'var(--success)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <Calculator size={16} />
                                ₱ {(parseInt(quantity) || 0) * FIXED_SHIRT_PRICE}
                            </div>
                        </div>
                    ) : (
                        <Input
                            label={type === 'sale' ? "Sale Price" : "Cost (₱)"}
                            type="number"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                            min="0"
                            step="0.01"
                        />
                    )}
                </div>

                {/* Dynamic Details Section for Shirts */}
                {showShirtDetails && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                        <Select
                            label="Size"
                            value={size}
                            onChange={(e) => setSize(e.target.value)}
                            options={['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].map(s => ({ value: s, label: s }))}
                        />

                        <Select
                            label="Color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                            options={['Black', 'White', 'Navy', 'Heather Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Aqua', 'Peach'].map(c => ({ value: c, label: c }))}
                        />
                    </div>
                )}

                {/* Dynamic Details Section for Accessories */}
                {category === 'accessories' && type === 'expense' && (
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                        <Input
                            label="Item Name"
                            placeholder="e.g. Stickers"
                            value={subCategory}
                            onChange={(e) => setSubCategory(e.target.value)}
                            required
                        />
                    </div>
                )}

                {/* Description (Hidden if Fixed Price - Auto Generated) */}
                {!isFixedPrice && (
                    <Input
                        label="Description / Note"
                        type="text"
                        placeholder={type === 'sale' ? "e.g. Sold to Customer A" : "e.g. Supplier XYZ"}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required
                    />
                )}

                <Button type="submit" style={{ width: '100%', marginTop: '0.5rem', background: type === 'expense' ? 'var(--danger)' : 'var(--success)' }}>
                    {type === 'sale' ? <PlusCircle size={18} /> : <MinusCircle size={18} />}
                    {type === 'sale' ? 'Add Sale Record' : (category === 'blanks' ? 'Add to Inventory' : 'Record Expense')}
                </Button>
            </form>
        </Card>
    );
};

export default TransactionForm;
