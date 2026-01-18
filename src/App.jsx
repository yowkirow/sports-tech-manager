import React, { useState } from 'react';
import useSupabaseTransactions from './hooks/useSupabaseTransactions';
import DashboardStats from './components/DashboardStats';
import TransactionList from './components/TransactionList';
import InventoryList from './components/InventoryList';
import POSInterface from './components/POS/POSInterface';
import OrderManagement from './components/Orders/OrderManagement';
import { LayoutDashboard, Store, ShoppingBag, Receipt, Package, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from './components/ui/Toast';

function App() {
    const {
        transactions,
        loading,
        addTransaction: addToSupabase,
        deleteTransaction: deleteFromSupabase,
        deleteAllTransactions
    } = useSupabaseTransactions();

    const [activeTab, setActiveTab] = useState('pos'); // Default to POS for speed
    const { showToast } = useToast();

    const addTransaction = async (transaction) => {
        try {
            await addToSupabase(transaction);
            if (transaction.type === 'expense') {
                showToast('Inventory updated!', 'success');
            }
        } catch (err) {
            showToast('Failed to save transaction', 'error');
        }
    };

    const deleteTransaction = async (id) => {
        if (!window.confirm('Delete this record? Inventory counts will be affected.')) return;
        try {
            await deleteFromSupabase(id);
            showToast('Record deleted', 'info');
        } catch (err) {
            showToast('Failed to delete', 'error');
        }
    };

    const handleDeleteAll = async () => {
        if (!window.confirm('WARNING: This will wipe ALL data. Are you sure?')) return;
        try {
            await deleteAllTransactions();
            showToast('System reset complete', 'success');
        } catch (err) {
            showToast('Reset failed', 'error');
        }
    };

    const NavItem = ({ id, label, icon: Icon }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={clsx(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                activeTab === id
                    ? "bg-primary text-white shadow-lg shadow-primary/25"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            )}
        >
            <Icon size={20} />
            <span className="font-medium">{label}</span>
        </button>
    );

    return (
        <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden font-sans selection:bg-primary/30">
            {/* Sidebar */}
            <aside className="w-64 bg-slate-900/50 backdrop-blur-xl border-r border-white/5 flex flex-col shrink-0">
                <div className="p-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                            <span className="font-bold text-xl italic">S</span>
                        </div>
                        <div>
                            <h1 className="font-bold text-lg leading-tight">SportsTech</h1>
                            <p className="text-xs text-slate-500">Manager Pro</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 px-4 space-y-2 mt-4">
                    <NavItem id="pos" label="Point of Sale" icon={Store} />
                    <NavItem id="orders" label="Orders" icon={Package} />
                    <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <NavItem id="inventory" label="Inventory List" icon={ShoppingBag} />
                </nav>

                <div className="p-4 border-t border-white/5">
                    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                        <p className="text-xs text-slate-500 mb-1">System Status</p>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span className="text-sm text-emerald-400 font-medium">Online</span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative flex flex-col">
                <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-sm shrink-0">
                    <h2 className="text-xl font-bold text-white">
                        {activeTab === 'pos' && 'Point of Sale'}
                        {activeTab === 'orders' && 'Order Management'}
                        {activeTab === 'dashboard' && 'Analytics Dashboard'}
                        {activeTab === 'inventory' && 'Inventory Management'}
                        {activeTab === 'add-stock' && 'Receive Stock'}
                    </h2>
                    <div className="flex items-center gap-4">
                        {loading && (
                            <span className="text-sm text-slate-400 flex items-center gap-2">
                                <span className="w-4 h-4 border-2 border-slate-600 border-t-primary rounded-full animate-spin"></span>
                                Syncing...
                            </span>
                        )}
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10"></div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 relative">
                    {loading && transactions.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                <p className="text-slate-400 animate-pulse">Loading System Data...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-7xl mx-auto h-full">
                            {activeTab === 'pos' && (
                                <POSInterface
                                    transactions={transactions}
                                    onAddTransaction={addTransaction}
                                />
                            )}

                            {activeTab === 'orders' && (
                                <OrderManagement
                                    transactions={transactions}
                                    onAddTransaction={addTransaction}
                                />
                            )}

                            {activeTab === 'dashboard' && (
                                <div className="space-y-8 animate-fade-in">
                                    <DashboardStats transactions={transactions} onDeleteAll={handleDeleteAll} />
                                    <TransactionList transactions={transactions} onDelete={deleteTransaction} />
                                </div>
                            )}

                            {activeTab === 'inventory' && (
                                <div className="animate-fade-in">
                                    <InventoryList transactions={transactions} onAddTransaction={addTransaction} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;
