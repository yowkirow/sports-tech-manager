import React, { lazy, Suspense, useState } from 'react';
import useSupabaseTransactions from './hooks/useSupabaseTransactions';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Store, ShoppingBag, Package, LogOut, X, Wallet, Banknote, Menu, Globe, Ticket, Settings as SettingsIcon, Lock, ClipboardList, TrendingUp, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './components/ui/Toast';
import { supabase } from './lib/supabaseClient';
import LoadingState from './components/ui/LoadingState';
import { sendSMS } from './lib/textbee';

const DashboardStats = lazy(() => import('./components/DashboardStats'));
const TransactionList = lazy(() => import('./components/TransactionList'));
const InventoryList = lazy(() => import('./components/InventoryList'));
const AddStockForm = lazy(() => import('./components/Inventory/AddStockForm'));
const POSInterface = lazy(() => import('./components/POS/POSInterface'));
const OrderManagement = lazy(() => import('./components/Orders/OrderManagement'));
const Expenses = lazy(() => import('./components/Expenses'));
const Sales = lazy(() => import('./components/Sales'));
const DowntownDinks = lazy(() => import('./components/DowntownDinks'));
const VoucherManager = lazy(() => import('./components/Vouchers/VoucherManager'));
const SupplierManager = lazy(() => import('./components/Supplier/SupplierManager'));
const AdsReporting = lazy(() => import('./components/Reports/AdsReporting'));
const Storefront = lazy(() => import('./components/Shop/Storefront'));
const Login = lazy(() => import('./components/Auth/Login'));
const ProfileSettings = lazy(() => import('./components/Settings/ProfileSettings'));
const OrderTracking = lazy(() => import('./components/Shop/OrderTracking'));

const NavItem = ({ id, label, icon: Icon, activeTab, onNavigate }) => (
    <button
        onClick={() => onNavigate(id)}
        aria-current={activeTab === id ? 'page' : undefined}
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

function App() {
    const isAdminPath = window.location.pathname.startsWith('/admin');
    const isTrackPath = window.location.pathname.startsWith('/track');
    const [session, setSession] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const {
        transactions,
        loading,
        error,
        addTransaction: addToSupabase,
        addTransactions,
        updateTransaction: updateInSupabase,
        deleteTransaction: deleteFromSupabase,
        deleteAllTransactions,
        refetch
    } = useSupabaseTransactions({ enabled: !isTrackPath && (!isAdminPath || !!session) });

    const [activeTab, setActiveTab] = useState('pos'); // Default to POS for speed
    const [showAddStockModal, setShowAddStockModal] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [dbRole, setDbRole] = useState(null); // Role from DB

    // Lock Screen State
    const [isLocked, setIsLocked] = useState(false);

    // Reseller Logic
    // Priority: DB Role > Metadata Role > Default 'admin'
    const userRole = dbRole || session?.user?.user_metadata?.role || 'admin';
    const isReseller = userRole === 'reseller';
    const isStaff = userRole === 'staff';

    // Force staff out of the default POS tab to orders tab initially
    React.useEffect(() => {
        if (isStaff && activeTab === 'pos') {
            setActiveTab('orders');
        }
    }, [isStaff, activeTab]);

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
            if (['define_product', 'delete_product', 'define_color', 'delete_color'].includes(t.type)) return true;
            // Otherwise only show own
            return t.details?.createdBy === session?.user?.email;
        });
    }, [transactions, isReseller, session]);

    const { showToast } = useToast();

    // Auth Listener & Role Fetcher
    React.useEffect(() => {
        if (!isAdminPath) return;
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setAuthLoading(false);
        });

        return () => subscription.unsubscribe();
    }, [isAdminPath]);

    React.useEffect(() => {
        let active = true;
        setDbRole(null);
        const email = session?.user?.email;
        if (!email) return;

        const fetchRole = async () => {
            const { data, error } = await supabase
                .from('admin_directory')
                .select('role')
                .eq('email', email)
                .maybeSingle();
            if (!active) return;
            if (error) console.error('Failed to load account role:', error);
            else setDbRole(data?.role || null);
        };
        fetchRole();
        return () => { active = false; };
    }, [session?.user?.email]);

    // PWA Redirect Logic
    React.useEffect(() => {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        const isRoot = window.location.pathname === '/';

        if (isStandalone && isRoot) {
            window.location.href = '/admin';
        }
    }, []);

    const addTransaction = async (transaction) => {
        try {
            await addToSupabase(transaction);
            if (transaction.type === 'expense') {
                showToast('Inventory updated!', 'success');
            }

            // TextBee Integration
            const meta = session?.user?.user_metadata;
            if (transaction.type === 'sale' && meta?.enable_sms_notifications && meta?.textbee_api_key && meta?.textbee_device_id) {
                // Determine recipient: Use customer phone if available, else maybe skip or notify owner
                // For now, let's assume we notify the OWNER about the sale if enabled.
                // Or if transaction.details.customerPhone exists, send to them.
                const recipient = transaction.details?.customerPhone || session.user.email; // Fallback to email as string? No, needs number.

                // If we want to notify the OWNER, we need a "Notification Number" in settings.
                // For now, let's just implement the logic.
                if (recipient && recipient.startsWith('+')) {
                    try {
                        await sendSMS({
                            apiKey: meta.textbee_api_key,
                            deviceId: meta.textbee_device_id,
                            recipient: recipient,
                            message: `SportsTech: New Sale! ${transaction.description}. Amount: ₱${transaction.amount}`
                        });
                        console.log('SMS Notification sent');
                    } catch (smsErr) {
                        console.error('Failed to send SMS:', smsErr);
                    }
                }
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

    const navProps = {
        activeTab,
        onNavigate: (id) => { setActiveTab(id); setIsSidebarOpen(false); }
    };

    // Tracking Route
    if (isTrackPath) return <OrderTracking />;

    // Default to Storefront unless on /admin path
    if (!isAdminPath) {
        if (loading && transactions.length === 0) return <LoadingState label="Loading store..." />;
        if (error && transactions.length === 0) {
            return <LoadingState error={error} onRetry={refetch} />;
        }
        return (
            <Storefront
                transactions={transactions}
                onPlaceOrder={addTransactions}
            />
        );
    }

    if (authLoading) return <LoadingState label="Loading account..." />;

    if (!session) {
        return <Login />;
    }

    if (isLocked) {
        return (
            <Login
                unlockMode={true}
                user={session.user}
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
                    <button aria-label="Close navigation" onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
                    {!isStaff && <NavItem {...navProps} id="pos" label="Point of Sale" icon={Store} />}
                    <NavItem {...navProps} id="orders" label="Orders" icon={Package} />
                    {!(isReseller || isStaff) && (
                        <>
                            <NavItem {...navProps} id="sales" label="Sales" icon={Banknote} />
                            <NavItem {...navProps} id="expenses" label="Expenses" icon={Wallet} />
                            <NavItem {...navProps} id="downtown-dinks" label="Downtown Dinks" icon={Trophy} />
                            <NavItem {...navProps} id="inventory" label="Inventory" icon={ShoppingBag} />
                            <NavItem {...navProps} id="supplier" label="Supplier Order" icon={ClipboardList} />
                            <NavItem {...navProps} id="vouchers" label="Vouchers" icon={Ticket} />
                            <NavItem {...navProps} id="reports" label="Reports" icon={TrendingUp} />
                        </>
                    )}
                    {!isStaff && <NavItem {...navProps} id="dashboard" label="Dashboard" icon={LayoutDashboard} />}
                    <div className="border-t border-white/5 my-2 mx-4"></div>
                    <NavItem {...navProps} id="settings" label="Settings" icon={SettingsIcon} />
                </nav>

                <div className="p-4 border-t border-white/5 space-y-2">
                    <button
                        onClick={() => {
                            const url = window.location.origin;
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
                        <button aria-label="Open navigation" onClick={() => setIsSidebarOpen(true)} className="lg:hidden text-slate-400 hover:text-white">
                            <Menu size={24} />
                        </button>
                        <h2 className="text-lg lg:text-xl font-bold text-white truncate max-w-[200px] sm:max-w-none">
                            {activeTab === 'pos' && 'Point of Sale'}
                            {activeTab === 'orders' && 'Orders'}
                            {activeTab === 'sales' && 'Sales'}
                            {activeTab === 'expenses' && 'Expenses'}
                            {activeTab === 'downtown-dinks' && 'Downtown Dinks'}
                            {activeTab === 'dashboard' && 'Dashboard'}
                            {activeTab === 'inventory' && 'Inventory'}
                            {activeTab === 'supplier' && 'Supplier Order'}
                            {activeTab === 'vouchers' && 'Vouchers'}
                            {activeTab === 'reports' && 'Reports'}
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
                    {error && (
                        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200">
                            <span>Unable to sync data: {error}</span>
                            <button onClick={refetch} disabled={loading} className="btn-secondary">Retry</button>
                        </div>
                    )}
                    {error && transactions.length === 0 ? null : loading && transactions.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                                <p className="text-slate-400 animate-pulse">Loading System Data...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-7xl mx-auto h-full">
                            <Suspense fallback={<LoadingState label="Loading workspace..." />}>
                            {!isStaff && activeTab === 'pos' && (
                                <POSInterface
                                    transactions={transactions} // POS needs ALL transactions to calculate Inventory/Products correctly
                                    onAddTransaction={addToSupabase}
                                    onAddTransactions={addTransactions}
                                    onDeleteTransaction={deleteTransaction} // Enable hard deletes
                                    refetch={refetch}
                                    userRole={userRole} // Pass role for pricing override
                                />
                            )}

                            {activeTab === 'orders' && (
                                <OrderManagement
                                    transactions={effectiveTransactions} // Filtered for Resellers
                                    onAddTransaction={addTransaction}
                                    onDeleteTransaction={deleteFromSupabase}
                                    refetch={refetch}
                                    userRole={userRole} // Pass role for restrictions
                                />
                            )}

                            {activeTab === 'sales' && (
                                <div className="animate-fade-in">
                                    <Sales
                                        transactions={transactions}
                                        onDeleteTransaction={deleteTransaction}
                                        onUpdateTransaction={updateInSupabase}
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
                                        onAddTransaction={addToSupabase}
                                        onUpdateTransaction={updateInSupabase}
                                    />
                                </div>
                            )}

                            {activeTab === 'downtown-dinks' && (
                                <div className="animate-fade-in">
                                    <DowntownDinks
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onUpdateTransaction={updateTransaction}
                                        onDeleteTransaction={deleteTransaction}
                                    />
                                </div>
                            )}

                            {activeTab === 'inventory' && (
                                <div className="animate-fade-in">
                                    <InventoryList
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onDeleteTransaction={deleteFromSupabase}
                                        onOpenAddStock={() => setShowAddStockModal(true)}
                                    />
                                </div>
                            )}

                            {activeTab === 'vouchers' && (
                                <div className="animate-fade-in">
                                    <VoucherManager
                                        transactions={transactions}
                                        onAddTransaction={addToSupabase}
                                        onUpdateTransaction={updateInSupabase}
                                        onDeleteTransaction={deleteFromSupabase}
                                    />
                                </div>
                            )}

                            {activeTab === 'supplier' && (
                                <div className="animate-fade-in h-full">
                                    <SupplierManager
                                        transactions={effectiveTransactions}
                                    />
                                </div>
                            )}

                            {activeTab === 'reports' && (
                                <div className="animate-fade-in h-full">
                                    <AdsReporting transactions={transactions} />
                                </div>
                            )}

                            {activeTab === 'settings' && (
                                <div className="animate-fade-in">
                                    <ProfileSettings
                                        user={session?.user}
                                        onLogout={() => supabase.auth.signOut()}
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                    />
                                </div>
                            )}
                            </Suspense>
                        </div>
                    )}
                </div>
            </main>

            {/* Global Add Stock Modal */}
            {showAddStockModal && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-2xl relative">
                        <Suspense fallback={<LoadingState label="Loading stock form..." />}>
                            <AddStockForm
                                onAddTransaction={(t) => {
                                    addTransaction(t);
                                    setShowAddStockModal(false);
                                }}
                                onClose={() => setShowAddStockModal(false)}
                                transactions={transactions}
                            />
                        </Suspense>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default function AppLoader() {
    return <Suspense fallback={<LoadingState />}><App /></Suspense>;
}
