import React, { lazy, Suspense, useState } from 'react';
import useTransactions from './hooks/useTransactions';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Store, ShoppingBag, Package, LogOut, X, Wallet, Banknote, Menu, Globe, Ticket, Settings as SettingsIcon, Lock, ClipboardList, TrendingUp, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './components/ui/Toast';
import { api, apiRequest } from './lib/apiClient';
import LoadingState from './components/ui/LoadingState';

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
const PrintQueue = lazy(() => import('./components/Production/PrintQueue'));
const ProductionManager = lazy(() => import('./components/Production/ProductionManager'));
const printQueueEnabled = import.meta.env.VITE_PRINT_QUEUE_ENABLED === 'true';

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

function PublicStore() {
    const [catalog, setCatalog] = useState(null);
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    React.useEffect(() => {
        const controller = new AbortController();
        setError(null);
        apiRequest('/api/public/catalog', { signal: controller.signal }).then(data => {
            if (!controller.signal.aborted) setCatalog(data);
        }).catch(err => {
            if (!controller.signal.aborted) setError(err.message);
        });
        return () => controller.abort();
    }, [attempt]);
    if (error) return <LoadingState error={error} onRetry={() => setAttempt(value => value + 1)} />;
    if (!catalog) return <LoadingState label="Loading store..." />;
    return <Storefront catalog={catalog} />;
}

function ProtectedWorkspace({ printPath }) {
    const [session, setSession] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    React.useEffect(() => {
        let active = true;
        const load = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const { member, profile = {}, mutationsEnabled, environment } = await api.getSession();
                if (!member?.id || !member.email) throw new Error('Your account could not be verified. Sign in again.');
                if (active) {
                    setSession({ user: { ...member, user_metadata: { ...profile, role: member.role } }, readOnly: mutationsEnabled === false, environment });
                    setAuthError(null);
                }
            } catch (err) {
                if (active) {
                    setSession(null);
                    setAuthError(err.message);
                }
            } finally {
                if (active) setAuthLoading(false);
            }
        };
        void load();
        const timer = window.setInterval(load, 30_000);
        window.addEventListener('focus', load);
        window.addEventListener('online', load);
        document.addEventListener('visibilitychange', load);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener('focus', load);
            window.removeEventListener('online', load);
            document.removeEventListener('visibilitychange', load);
        };
    }, [attempt]);
    const role = session?.user?.role;
    React.useEffect(() => {
        if (role === 'print_operator' && !printPath) window.location.replace('/print');
    }, [role, printPath]);
    if (authLoading) return <LoadingState label="Loading account..." />;
    if (!session) return <Login error={authError} onRetry={() => setAttempt(value => value + 1)} />;
    if (!['owner', 'reseller', 'print_operator'].includes(role)) return <Login denied />;
    if (role === 'print_operator' && !printPath) return <LoadingState label="Opening print queue..." />;
    if (printPath) {
        if (!['owner', 'print_operator'].includes(role)) return <Login denied />;
        if (!printQueueEnabled) return <LoadingState error="The print queue is not enabled yet." />;
        return <PrintQueue user={session.user} userRole={role} />;
    }
    return <ManagementApp key={`${session.user.id}:${role}`} session={session} onProfileChange={profile => {
        setSession(current => ({ ...current, user: { ...current.user, user_metadata: { ...current.user.user_metadata, ...profile, role } } }));
    }} />;
}

function ManagementApp({ session, onProfileChange }) {
    const {
        transactions,
        loading,
        error,
        legacyCache,
        addTransaction: addToServer,
        addTransactions,
        updateTransaction: updateOnServer,
        deleteTransaction: deleteFromServer,
        deleteAllTransactions,
        applyOrderSave,
        refetch
    } = useTransactions({ enabled: true, accountId: session.user.id });

    const [activeTab, setActiveTab] = useState('pos');
    const [showAddStockModal, setShowAddStockModal] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const userRole = session.user.role;
    const isOwner = userRole === 'owner';
    const effectiveTransactions = transactions;

    const { showToast } = useToast();

    const addTransaction = async (transaction) => {
        try {
            const saved = await addToServer(transaction);
            if (transaction.type === 'expense') {
                showToast('Inventory updated!', 'success');
            }

            return saved;
        } catch (err) {
            console.error(err);
            showToast(`Failed to save: ${err.message}`, 'error');
            throw err;
        }
    };

    const updateTransaction = async (id, updates) => {
        try {
            const saved = await updateOnServer(id, updates);
            showToast('Record updated!', 'success');
            return saved;
        } catch (err) {
            console.error(err);
            showToast(`Failed to update: ${err.message}`, 'error');
            throw err;
        }
    };

    const deleteTransaction = async (id, skipConfirm = false) => {
        if (!skipConfirm && !window.confirm('Delete this record? Inventory counts will be affected.')) return false;
        try {
            await deleteFromServer(id);
            if (!skipConfirm) showToast('Record deleted', 'info');
            return true;
        } catch (err) {
            showToast('Failed to delete', 'error');
            throw err;
        }
    };

    const handleDeleteAll = async () => {
        if (!isOwner) return;
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
                    <NavItem {...navProps} id="pos" label="Point of Sale" icon={Store} />
                    <NavItem {...navProps} id="orders" label="Orders" icon={Package} />
                    {isOwner && (
                        <>
                            <NavItem {...navProps} id="sales" label="Sales" icon={Banknote} />
                            <NavItem {...navProps} id="expenses" label="Expenses" icon={Wallet} />
                            <NavItem {...navProps} id="downtown-dinks" label="Downtown Dinks" icon={Trophy} />
                            <NavItem {...navProps} id="inventory" label="Inventory" icon={ShoppingBag} />
                            <NavItem {...navProps} id="supplier" label="Supplier Order" icon={ClipboardList} />
                            <NavItem {...navProps} id="vouchers" label="Vouchers" icon={Ticket} />
                            <NavItem {...navProps} id="reports" label="Reports" icon={TrendingUp} />
                            {printQueueEnabled && <NavItem {...navProps} id="production" label="Production" icon={ClipboardList} />}
                        </>
                    )}
                    <NavItem {...navProps} id="dashboard" label="Dashboard" icon={LayoutDashboard} />
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
                        <button onClick={api.logout} className="text-slate-500 hover:text-white p-1" title="Lock and sign out">
                            <Lock size={16} />
                        </button>
                        <button onClick={api.logout} className="text-slate-500 hover:text-red-400 p-1" title="Sign Out">
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
                            {activeTab === 'production' && 'Production'}
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
                    {session.readOnly && <div role="status" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                        {session.environment === 'staging'
                            ? 'Read-only staging snapshot. You can review data here; saves, checkout and SMS delivery are disabled. The live store is unchanged.'
                            : 'Maintenance: data is temporarily read-only. Saves and checkout are disabled until maintenance is complete.'}
                    </div>}
                    {legacyCache && (
                        <div role="status" className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-200">
                            Legacy data is saved in this browser. It has not been imported. Export it for owner review before making any import.
                            <button className="btn-secondary ml-3" onClick={() => {
                                const content = window.localStorage.getItem('sports-tech-transactions');
                                if (!content) return;
                                const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = 'legacy-transactions-for-review.json';
                                link.click();
                                URL.revokeObjectURL(url);
                            }}>Export legacy data</button>
                        </div>
                    )}
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
                            {activeTab === 'pos' && (
                                <POSInterface
                                    transactions={transactions}
                                    onAddTransaction={addToServer}
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
                                    onDeleteTransaction={deleteFromServer}
                                    onOrderSaved={applyOrderSave}
                                    refetch={refetch}
                                    userRole={userRole} // Pass role for restrictions
                                />
                            )}

                            {isOwner && activeTab === 'sales' && (
                                <div className="animate-fade-in">
                                    <Sales
                                        transactions={transactions}
                                        onDeleteTransaction={deleteTransaction}
                                        onUpdateTransaction={updateOnServer}
                                    />
                                </div>
                            )}

                            {activeTab === 'dashboard' && (
                                <div className="space-y-8 animate-fade-in">
                                    <DashboardStats transactions={effectiveTransactions} onDeleteAll={isOwner ? handleDeleteAll : undefined} />
                                    <TransactionList transactions={effectiveTransactions} onDelete={deleteTransaction} />
                                </div>
                            )}

                            {isOwner && activeTab === 'expenses' && (
                                <div className="animate-fade-in">
                                    <Expenses
                                        transactions={transactions}
                                        onDeleteTransaction={deleteTransaction}
                                        onAddTransaction={addToServer}
                                        onUpdateTransaction={updateOnServer}
                                    />
                                </div>
                            )}

                            {isOwner && activeTab === 'downtown-dinks' && (
                                <div className="animate-fade-in">
                                    <DowntownDinks
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onUpdateTransaction={updateTransaction}
                                        onDeleteTransaction={deleteTransaction}
                                    />
                                </div>
                            )}

                            {isOwner && activeTab === 'inventory' && (
                                <div className="animate-fade-in">
                                    <InventoryList
                                        transactions={transactions}
                                        onAddTransaction={addTransaction}
                                        onDeleteTransaction={deleteFromServer}
                                        onOpenAddStock={() => setShowAddStockModal(true)}
                                    />
                                </div>
                            )}

                            {isOwner && activeTab === 'vouchers' && (
                                <div className="animate-fade-in">
                                    <VoucherManager
                                        transactions={transactions}
                                        onAddTransaction={addToServer}
                                        onUpdateTransaction={updateOnServer}
                                        onDeleteTransaction={deleteFromServer}
                                    />
                                </div>
                            )}

                            {isOwner && activeTab === 'supplier' && (
                                <div className="animate-fade-in h-full">
                                    <SupplierManager
                                        transactions={effectiveTransactions}
                                    />
                                </div>
                            )}

                            {isOwner && activeTab === 'reports' && (
                                <div className="animate-fade-in h-full">
                                    <AdsReporting transactions={transactions} />
                                </div>
                            )}

                            {isOwner && printQueueEnabled && activeTab === 'production' && (
                                <ProductionManager user={session.user} transactions={transactions} refetch={refetch} />
                            )}
                            {activeTab === 'settings' && (
                                <div className="animate-fade-in">
                                    <ProfileSettings
                                        user={session?.user}
                                        onLogout={api.logout}
                                        onProfileChange={onProfileChange}
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
                                onAddTransaction={async (t) => {
                                    await addTransaction(t);
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
    const path = window.location.pathname;
    const isAdminPath = /^\/admin(?:\/|$)/.test(path);
    const isPrintPath = /^\/print(?:\/|$)/.test(path);
    const isTrackPath = /^\/track(?:\/|$)/.test(path);
    React.useEffect(() => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        if (standalone && path === '/') window.location.replace('/admin');
    }, [path]);
    return <Suspense fallback={<LoadingState />}>
        {isTrackPath ? <OrderTracking /> : isAdminPath || isPrintPath ? <ProtectedWorkspace printPath={isPrintPath} /> : <PublicStore />}
    </Suspense>;
}
