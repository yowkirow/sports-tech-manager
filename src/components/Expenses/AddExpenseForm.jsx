import { useActivityLog } from '../../hooks/useActivityLog';

export default function AddExpenseForm({ onAddTransaction, onClose }) {
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const [loading, setLoading] = useState(false);

    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState('Rent');
    const [customCategory, setCustomCategory] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const finalCategory = category === 'Other' ? customCategory : category;

            // Combine selected date with current time
            const now = new Date();
            const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS
            const dateTimeString = `${date}T${timeString}`;

            const newTransaction = {
                id: crypto.randomUUID(),
                type: 'expense',
                amount: parseFloat(amount),
                description: description || `Expense: ${finalCategory}`,
                category: 'general',
                date: new Date(dateTimeString).toISOString(),
                details: {
                    subCategory: finalCategory,
                    isGeneral: true
                }
            };

            await onAddTransaction(newTransaction);

            // Log Activity
            await logActivity('Add Expense', {
                amount: newTransaction.amount,
                category: finalCategory,
                description: newTransaction.description
            }, newTransaction.id);

            showToast('Expense recorded', 'success');
            onClose();

        } catch (error) {
            console.error(error);
            showToast('Failed to add expense', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full mx-auto shadow-2xl relative flex flex-col">
            <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
                <h2 className="text-xl font-bold text-white">Record Expense</h2>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-white transition-colors bg-white/5 p-2 rounded-lg hover:bg-white/10"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Category</label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="glass-input appearance-none"
                        >
                            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="bg-slate-900">{c}</option>)}
                        </select>
                    </div>

                    {category === 'Other' && (
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Specify Category</label>
                            <input
                                type="text"
                                value={customCategory}
                                onChange={(e) => setCustomCategory(e.target.value)}
                                className="glass-input"
                                placeholder="e.g. Office Supplies"
                                required
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Amount (₱)</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="glass-input"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Description (Optional)</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="glass-input"
                            placeholder="Details..."
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="glass-input appearance-none"
                            required
                        />
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full py-3 shadow-lg shadow-indigo-500/20"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <Plus size={18} />}
                            {loading ? 'Saving...' : 'Record Expense'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
