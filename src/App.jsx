import React, { useState } from 'react';
import useSupabaseTransactions from './hooks/useSupabaseTransactions';
import { createPortal } from 'react-dom';
import DashboardStats from './components/DashboardStats';
import TransactionList from './components/TransactionList';
import InventoryList from './components/InventoryList';
import AddStockForm from './components/Inventory/AddStockForm';
import POSInterface from './components/POS/POSInterface';
import OrderManagement from './components/Orders/OrderManagement';
import Expenses from './components/Expenses';
import Sales from './components/Sales';
import VoucherManager from './components/Vouchers/VoucherManager';
import { LayoutDashboard, Store, ShoppingBag, Receipt, Package, LogOut, X, Wallet, Banknote, Menu, Globe, Link, Ticket, Settings as SettingsIcon, Lock } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './components/ui/Toast';
import Storefront from './components/Shop/Storefront';
import Login from './components/Auth/Login';
import { supabase } from './lib/supabaseClient';
import ProfileSettings from './components/Settings/ProfileSettings';


function App() {
    const {
        transactions,
        loading,
        addTransaction: addToSupabase,
        updateTransaction: updateInSupabase,
        deleteTransaction: deleteFromSupabase,
        deleteAllTransactions,
        refetch
    } = useSupabaseTransactions();

    const [activeTab, setActiveTab] = useState('pos'); // Default to POS for speed
    const [showAddStockModal, setShowAddStockModal] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [session, setSession] = useState(null);
    const [user, setUser] = useState(null);
    const [dbRole, setDbRole] = useState(null); // Role from DB

    // Lock Screen State
    const [isLocked, setIsLocked] = useState(false);

    // Reseller Logic
    // Priority: DB Role > Metadata Role > Default 'admin'
    const userRole = dbRole || session?.user?.user_metadata?.role || 'admin';
    const isReseller = userRole === 'reseller';

    // Transactions Filtering (Security: Client Side)
    // If reseller, only show transactions created by them (or no filter if they view global products?)
    // Actually, products are global (system category), sales are personal.
    // So we need to be careful.
    // Products (define_product, delete_product) should be visible to ALL (global catalog).
    // Sales/Orders/Expenses should be filtered.

    // BUT useSupabaseTransactions returns raw stream.
    // For specific views, we should pass filtered lists or let the view filter.
    // Easiest is to pass `transactions` as-is but filtered where strictly necessary?
    // No, users requested "Their Orders", so OrderManagement must be filtered.
    // "Their very own dashboard" -> DashboardStats filtered.
    // POS -> Needs ALL products (to sell them) but creates OWN sales.

    // Computed Filtered Transactions (For Dashboard, Orders, Sales, Expenses)
    // Products (type 'define_product') remain visible.
    const effectiveTransactions = React.useMemo(() => {
        if (!isReseller) return transactions;
        return transactions.filter(t => {
            // Always show products/system events
            if (t.type === 'define_product' || t.type === 'delete_product') return true;
            // Otherwise only show own
            return t.details?.createdBy === session?.user?.email;
        });
    }, [transactions, isReseller, session]);

    const { showToast } = useToast();

    // Auth Listener & Role Fetcher
    React.useEffect(() => {
        const fetchRole = async (email) => {
            if (!email) return;
            const { data } = await supabase
                .from('admin_directory')
                .select('role')
                .eq('email', email)
                .single();
            if (data?.role) setDbRole(data.role);
        };

        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session?.user?.email) fetchRole(session.user.email);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session?.user?.email) fetchRole(session.user.email);
            else setDbRole(null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const addTransaction = async (transaction) => {
        try {
            await addToSupabase(transaction);
            if (transaction.type === 'expense') {
                showToast('Inventory updated!', 'success');
            }
        } catch (err) {
            console.error(err);
            showToast(`Failed to save: ${err.message}`, 'error');
        }
    };

    const updateTransaction = async (id, updates) => {
        try {
            await updateInSupabase(id, updates);
            showToast('Record updated!', 'success');
        } catch (err) {
            console.error(err);
            showToast(`Failed to update: ${err.message}`, 'error');
        }
    };

    const deleteTransaction = async (id, skipConfirm = false) => {
        if (!skipConfirm && !window.confirm('Delete this record? Inventory counts will be affected.')) return;
        try {
            await deleteFromSupabase(id);
            if (!skipConfirm) showToast('Record deleted', 'info');
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
            onClick={() => { setActiveTab(id); setIsSidebarOpen(false); }}
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

    // Check for Storefront Mode
    const isStoreMode = new URLSearchParams(window.location.search).get('mode') === 'store';

    if (isStoreMode) {
        return (
            <Storefront
                transactions={transactions}
                onPlaceOrder={addTransaction}
            />
        );
    }

    if (!session) {
        return <Login />;
    }

    if (isLocked) {
        return (
            <Login
                unlockMode={true}
                user={user}
                onUnlock={() => setIsLocked(false)}
                onLogout={() => {
                    setIsLocked(false);
                    supabase.auth.signOut();
                }}
            />
        );
    }


    return (
        <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden font-sans selection:bg-primary/30 relative">
            {/* Mobile Overlay */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsSidebarOpen(false)}
                        className="fixed inset-0 bg-black/80 z-40 lg:hidden backdrop-blur-sm"
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={clsx(
                "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-900/95 lg:bg-slate-900/50 backdrop-blur-xl border-r border-white/5 flex flex-col shrink-0 transition-transform duration-300 ease-in-out lg:translate-x-0",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="p-6 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <img src="/logo.png" alt="SportsTech" className="h-16 w-auto object-contain" />
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
                    <NavItem id="pos" label="Point of Sale" icon={Store} />
                    <NavItem id="orders" label="Orders" icon={Package} />
                    {!isReseller && (
                        <>
                            <NavItem id="sales" label="Sales" icon={Banknote} />
                            <NavItem id="expenses" label="Expenses" icon={Wallet} />
                            <NavItem id="inventory" label="Inventory" icon={ShoppingBag} />
                            <NavItem id="vouchers" label="Vouchers" icon={Ticket} />
                        </>
                    )}
                    <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <div className="border-t border-white/5 my-2 mx-4"></div>
                    {!isReseller && <NavItem id="settings" label="Settings" icon={SettingsIcon} />}
                </nav>

                <div className="p-4 border-t border-white/5 space-y-2">
                    <button
                        onClick={() => {
                            const url = window.location.origin + '?mode=store';
                            navigator.clipboard.writeText(url);
                            showToast('Store link copied!', 'success');
                        }}
                        className="w-full px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 flex items-center gap-3 transition-colors"
                    >
                        <Globe size={18} />
                        <span className="font-medium text-sm">Copy Store Link</span>
                    </button>
                    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between group">
                        <div>
                            <h1 className="font-bold text-lg leading-tight">SportsTech</h1>
                            <p className="text-xs text-slate-500 truncate max-w-[150px]">
                                {session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Manager'}
                            </p>
                        </div>
                        <button onClick={() => setIsLocked(true)} className="text-slate-500 hover:text-white p-1" title="Lock Screen">
                            <Lock size={16} />
                        </button>
                        <button onClick={() => supabase.auth.signOut()} className="text-slate-500 hover:text-red-400 p-1" title="Sign Out">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative flex flex-col">
                <header className="h-16 border-b border-white/5 flex items-center justify-between px-4 lg:px-8 bg-slate-900/50 backdrop-blur-sm shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-400 hover:text-white">
                            <Menu size={24} />
                        </button>
                        <h2 className="text-lg lg:text-xl font-bold text-white truncate max-w-[200px] sm:max-w-none">
                            {activeTab === 'pos' && 'Point of Sale'}
                            {activeTab === 'orders' && 'Orders'}
                            {activeTab === 'sales' && 'Sales'}
                            {activeTab === 'expenses' && 'Expenses'}
                            {activeTab === 'dashboard' && 'Dashboard'}
                            {activeTab === 'inventory' && 'Inventory'}
                            {activeTab === 'vouchers' && 'Vouchers'}
                            {activeTab === 'settings' && 'Settings'}
                            {activeTab === 'add-stock' && 'Receive Stock'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-4">
                        {loading && (
                            <span className="text-sm text-slate-400 flex items-center gap-2">
                                <span className="w-4 h-4 border-2 border-slate-600 border-t-primary rounded-full animate-spin"></span>
                                <span className="hidden sm:inline">Syncing...</span>
                            </span>
                        )}
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 border border-white/10"></div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 lg:p-8 relative">
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
                                    transactions={transactions} // POS needs ALL transactions to calculate Inventory/Products correctly
                                    onAddTransaction={addTransaction}
                                    onDeleteTransaction={deleteTransaction} // Enable hard deletes
                                    refetch={refetch}
                                    userRole={userRole} // Pass role for pricing override
                                />
                            )}

                            {activeTab === 'orders' && (
                                <OrderManagement
                                    transactions={effectiveTransactions} // Filtered for Resellers
                                    onAddTransaction={addTransaction}
                                    onDeleteTransaction={deleteTransaction}
                                    refetch={refetch}
                                    userRole={userRole} // Pass role for restrictions
                                />
                            )}

                            {activeTab === 'sales' && (
                                <div className="animate-fade-in">
                                    <Sales
                                        transactions={transactions}
                                        onDeleteTransaction={deleteTransaction}
                                        onUpdateTransaction={updateTransaction}
                                    />
                                </div>
                            )}

                            {activeTab === 'dashboard' && (
                                <div className="space-y-8 animate-fade-in">
                                    <DashboardStats transactions={effectiveTransactions} onDeleteAll={handleDeleteAll} />
                                    <TransactionList transactions={effectiveTransactions} onDelete={deleteTransaction} />
                                </div>
                            )}

                            {activeTab === 'expenses' && (
                                <div className="animate-fade-in">
                                    <Expenses
                                        transactions={transactions}
                                        onDeleteTransaction={deleteTransaction}
                                        onAddTransaction={addTransaction}
                                        onUpdateTransaction={updateTransaction}
                                    />
                                </div>
                            )}

                            {activeTab === 'inventory' && (
                                <div className="animate-fade-in">
                                    <InventoryList
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onDeleteTransaction={deleteTransaction}
                                        onOpenAddStock={() => setShowAddStockModal(true)}
                                    />
                                </div>
                            )}

                            {activeTab === 'vouchers' && (
                                <div className="animate-fade-in">
                                    <VoucherManager
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onDeleteTransaction={deleteTransaction}
                                    />
                                </div>
                            )}

                            {activeTab === 'settings' && (
                                <div className="animate-fade-in">
                                    <ProfileSettings
                                        user={session?.user}
                                        onLogout={() => supabase.auth.signOut()}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {/* Global Add Stock Modal */}
            {showAddStockModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-2xl relative">
                        <AddStockForm
                            onAddTransaction={(t) => {
                                addTransaction(t);
                                setShowAddStockModal(false);
                            }}
                            onClose={() => setShowAddStockModal(false)}
                        />
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default App;
