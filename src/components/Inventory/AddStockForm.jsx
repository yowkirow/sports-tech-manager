import React, { useState, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import { Upload, X, Plus, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const COLORS = ['Black', 'White', 'Navy', 'Heather Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Aqua', 'Peach'];

export default function AddStockForm({ onAddTransaction }) {
    const { showToast } = useToast();
    const fileInputRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Form State
    const [category, setCategory] = useState('blanks'); // blanks, accessories
    const [quantity, setQuantity] = useState('1');
    const [cost, setCost] = useState('');
    const [description, setDescription] = useState('');

    // Shirt Details
    const [size, setSize] = useState('M');
    const [color, setColor] = useState('Black');

    // Accessory Details
    const [subCategory, setSubCategory] = useState('');

    // Image
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast('File size too large (max 5MB)', 'error');
            return;
        }

        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
    };

    const removeImage = () => {
        setImageFile(null);
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const uploadImage = async () => {
        if (!imageFile) return null;

        try {
            setUploading(true);
            const fileExt = imageFile.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
            const filePath = `product-images/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('product-images')
                .upload(filePath, imageFile);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage
                .from('product-images')
                .getPublicUrl(filePath);

            return data.publicUrl;
        } catch (error) {
            console.error('Upload Error:', error);
            showToast('Failed to upload image', 'error');
            return null;
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const finalCost = parseFloat(cost) || 0; // Allow 0 cost

            // 1. Upload Image if exists
            let imageUrl = null;
            if (imageFile) {
                imageUrl = await uploadImage();
                if (!imageUrl && imageFile) {
                    setLoading(false);
                    return; // Stop if upload failed but file existed
                }
            }

            // 2. Construct Details
            let details = {
                quantity: parseInt(quantity),
                imageUrl
            };

            if (category === 'blanks') {
                details = { ...details, size, color };
            } else {
                details = { ...details, subCategory };
            }

            // 3. Create Transaction
            const newTransaction = {
                id: crypto.randomUUID(),
                type: 'expense',
                amount: finalCost,
                description: description || (category === 'blanks' ? `Bought ${quantity}x ${color} ${size}` : `Bought ${subCategory}`),
                category,
                date: new Date().toISOString(),
                details
            };

            await onAddTransaction(newTransaction);

            // Reset Form
            setQuantity('1');
            setCost('');
            setDescription('');
            setSubCategory('');
            removeImage();

        } catch (error) {
            console.error(error);
            showToast('Failed to add stock', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-6 rounded-2xl max-w-2xl mx-auto"
        >
            <h2 className="text-2xl font-bold mb-6 text-white">Add New Stock</h2>

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* Category Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <button
                        type="button"
                        onClick={() => setCategory('blanks')}
                        className={`p-4 rounded-xl border transition-all ${category === 'blanks'
                                ? 'bg-primary/20 border-primary text-white'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                            }`}
                    >
                        <span className="block font-semibold">Blank Shirt</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setCategory('accessories')}
                        className={`p-4 rounded-xl border transition-all ${category === 'accessories'
                                ? 'bg-primary/20 border-primary text-white'
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                            }`}
                    >
                        <span className="block font-semibold">Accessory / Other</span>
                    </button>
                </div>

                {/* Image Upload Area */}
                <div className="space-y-2">
                    <label className="text-sm text-slate-400 block">Product Image</label>

                    <div className="relative group">
                        {imagePreview ? (
                            <div className="relative h-48 w-full rounded-xl overflow-hidden border border-white/10 bg-black/20">
                                <img src={imagePreview} alt="Preview" className="w-full h-full object-contain" />
                                <button
                                    type="button"
                                    onClick={removeImage}
                                    className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-red-500/80 rounded-full text-white transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ) : (
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="h-32 w-full border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-white/5 transition-all group"
                            >
                                <Upload className="text-slate-500 group-hover:text-primary mb-2 transition-colors" size={24} />
                                <span className="text-slate-500 text-sm group-hover:text-slate-300">Click to upload image</span>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="hidden"
                        />
                    </div>
                </div>

                {/* Specific Fields */}
                <AnimatePresence mode="wait">
                    {category === 'blanks' ? (
                        <motion.div
                            key="blanks-fields"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="grid grid-cols-2 gap-4"
                        >
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Size</label>
                                <select
                                    value={size}
                                    onChange={(e) => setSize(e.target.value)}
                                    className="glass-input appearance-none"
                                >
                                    {SIZES.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Color</label>
                                <select
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="glass-input appearance-none"
                                >
                                    {COLORS.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                                </select>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="acc-fields"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                        >
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Item Name</label>
                                <input
                                    type="text"
                                    value={subCategory}
                                    onChange={(e) => setSubCategory(e.target.value)}
                                    placeholder="e.g. Stickers, Packaging"
                                    className="glass-input"
                                    required
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Common Fields */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Quantity</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            min="1"
                            className="glass-input"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Total Cost (₱)</label>
                        <input
                            type="number"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            className="glass-input"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm text-slate-400">Description / Note</label>
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional note..."
                        className="glass-input"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading || uploading}
                    className="btn-primary w-full py-4 text-lg shadow-lg shadow-indigo-500/20"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Plus size={20} />}
                    {loading ? 'Saving...' : 'Add to Inventory'}
                </button>

            </form>
        </motion.div>
    );
}
