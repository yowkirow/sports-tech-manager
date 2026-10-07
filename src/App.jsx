import React, { lazy, Suspense, useState } from 'react';
import useTransactions from './hooks/useTransactions';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Store, ShoppingBag, Package, LogOut, Lock, Wallet, Banknote, Menu, Link2, Ticket, Settings as SettingsIcon, ClipboardList, TrendingUp, Trophy, Printer, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from './components/ui/Toast';
import { api, apiRequest, PIN_REQUIRED_EVENT, PIN_UNLOCKED_EVENT } from './lib/apiClient';
import LoadingState from './components/ui/LoadingState';
import Dialog from './components/ui/Dialog';
import Logo from './components/ui/Logo';
import { ReadOnlyContext } from './components/ui/ReadOnly';

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
const PinGate = lazy(() => import('./components/Auth/PinGate'));
const ProfileSettings = lazy(() => import('./components/Settings/ProfileSettings'));
const OrderTracking = lazy(() => import('./components/Shop/OrderTracking'));
const PrintQueue = lazy(() => import('./components/Production/PrintQueue'));
const ProductionManager = lazy(() => import('./components/Production/ProductionManager'));
const printQueueEnabled = import.meta.env.VITE_PRINT_QUEUE_ENABLED === 'true';

const TAB_TITLES = {
    pos: 'Point of Sale', orders: 'Orders', sales: 'Sales', expenses: 'Expenses', 'downtown-dinks': 'Downtown Dinks',
    dashboard: 'Dashboard', inventory: 'Inventory', supplier: 'Supplier Order', vouchers: 'Vouchers', reports: 'Reports',
    production: 'Production', settings: 'Settings', 'add-stock': 'Receive Stock'
};

const navGroups = (isOwner) => [
    { label: 'Sell', items: [
        { id: 'pos', label: 'Point of Sale', icon: Store },
        { id: 'orders', label: 'Orders', icon: Package },
    ] },
    isOwner && { label: 'Money', items: [
        { id: 'sales', label: 'Sales', icon: Banknote },
        { id: 'expenses', label: 'Expenses', icon: Wallet },
        { id: 'vouchers', label: 'Vouchers', icon: Ticket },
        { id: 'reports', label: 'Reports', icon: TrendingUp },
    ] },
    isOwner && { label: 'Stock', items: [
        { id: 'inventory', label: 'Inventory', icon: ShoppingBag },
        { id: 'supplier', label: 'Supplier Order', icon: ClipboardList },
        ...(printQueueEnabled ? [{ id: 'production', label: 'Production', icon: Printer }] : []),
    ] },
    isOwner && { label: 'Club', items: [
        { id: 'downtown-dinks', label: 'Downtown Dinks', icon: Trophy },
    ] },
    { label: 'Overview', items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'settings', label: 'Settings', icon: SettingsIcon },
    ] },
].filter(Boolean);

const QUICK_TABS = [
    { id: 'pos', label: 'POS', icon: Store },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
];

const NavItem = ({ id, label, icon: Icon, activeTab, onNavigate }) => (
    <button
        type="button"
        onClick={() => onNavigate(id)}
        aria-current={activeTab === id ? 'page' : undefined}
        className={clsx(
            "group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium transition-colors duration-150 lg:min-h-10",
            activeTab === id
                ? "bg-white/[0.08] text-ink"
                : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
        )}
    >
        <Icon size={19} aria-hidden="true" className={activeTab === id ? 'text-primary' : 'text-ink-3 group-hover:text-ink-2'} />
        <span className="truncate">{label}</span>
    </button>
);

function NavGroups({ isOwner, ...navProps }) {
    return navGroups(isOwner).map(group => (
        <div key={group.label} className="mb-4 last:mb-0">
            <p className="mb-1 px-3 text-xs font-semibold text-ink-3">{group.label}</p>
            <div className="space-y-0.5">
                {group.items.map(item => <NavItem key={item.id} {...navProps} {...item} />)}
            </div>
        </div>
    ));
}

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
    // Once the workspace has opened, a later lock covers it instead of unmounting it,
    // so unsaved work survives a PIN re-entry.
    const [opened, setOpened] = useState(false);
    React.useEffect(() => {
        let active = true;
        const load = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const { member, profile = {}, mutationsEnabled, environment, pin = null } = await api.getSession();
                if (!member?.id || !member.email) throw new Error('Your account could not be verified. Sign in again.');
                if (active) {
                    setSession(current => {
                        if (current && !pin?.unlocked && current.user.id === member.id && current.user.role === member.role) {
                            return { ...current, pin };
                        }
                        return { user: { ...member, user_metadata: { ...profile, role: member.role } }, readOnly: mutationsEnabled === false, environment, pin };
                    });
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
        window.addEventListener(PIN_REQUIRED_EVENT, load);
        document.addEventListener('visibilitychange', load);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener('focus', load);
            window.removeEventListener('online', load);
            window.removeEventListener(PIN_REQUIRED_EVENT, load);
            document.removeEventListener('visibilitychange', load);
        };
    }, [attempt]);
    const role = session?.user?.role;
    const pinUnlocked = session?.pin?.unlocked === true;
    React.useEffect(() => { if (pinUnlocked) setOpened(true); }, [pinUnlocked]);
    React.useEffect(() => {
        if (role === 'print_operator' && !printPath) window.location.replace('/print');
    }, [role, printPath]);
    const reload = () => setAttempt(value => value + 1);
    const lock = async () => {
        try { await api.pin.lock(); } finally { reload(); }
    };
    if (authLoading) return <LoadingState label="Loading account..." />;
    if (!session) return <Login error={authError} onRetry={reload} />;
    if (!['owner', 'reseller', 'print_operator'].includes(role)) return <Login denied />;
    if (role === 'print_operator' && !printPath) return <LoadingState label="Opening print queue..." />;
    const pinGate = !pinUnlocked && (
        <Suspense fallback={<LoadingState label="Loading..." />}>
            <PinGate key={session.pin?.configured ? 'unlock' : 'setup'} member={session.user} pin={session.pin}
                onUnlocked={() => { window.dispatchEvent(new Event(PIN_UNLOCKED_EVENT)); reload(); }} overlay={opened} />
        </Suspense>
    );
    if (pinGate && !opened) return pinGate;
    if (printPath) {
        if (!['owner', 'print_operator'].includes(role)) return <Login denied />;
        if (!printQueueEnabled) return <LoadingState error="The print queue is not enabled yet." />;
        return (
            <div className="print-shell min-h-dvh bg-ground text-ink">
                {pinGate}
                <div inert={pinGate ? true : undefined}>
                <header className="sticky top-0 z-30 border-b border-line bg-ground">
                    <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
                        <Logo className="h-8" />
                        <div className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-sm text-ink-2">{session.user.user_metadata?.full_name || session.user.email}</span>
                            <button type="button" onClick={lock} className="icon-btn" aria-label="Lock with PIN" title="Lock with PIN"><Lock size={18} /></button>
                            <button type="button" onClick={api.logout} className="icon-btn" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
                        </div>
                    </div>
                </header>
                <main className="mx-auto max-w-3xl px-4 pt-6 pb-16">
                    {session.readOnly && <div role="status" className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                        {session.environment === 'staging'
                            ? 'Read-only staging snapshot. You can review data here; saves, checkout and SMS delivery are disabled. The live store is unchanged.'
                            : 'Maintenance: data is temporarily read-only. Saves and checkout are disabled until maintenance is complete.'}
                    </div>}
                    <ReadOnlyContext.Provider value={session.readOnly === true}><PrintQueue user={session.user} userRole={role} /></ReadOnlyContext.Provider>
                </main>
                </div>
            </div>
        );
    }
    return (
        <>
            {pinGate}
            <div inert={pinGate ? true : undefined}>
                <ManagementApp key={`${session.user.id}:${role}`} session={session} onLock={lock} onProfileChange={profile => {
                    setSession(current => ({ ...current, user: { ...current.user, user_metadata: { ...current.user.user_metadata, ...profile, role } } }));
                }} />
            </div>
        </>
    );
}

function ManagementApp({ session, onProfileChange, onLock }) {
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

    // Data requests made while the PIN was locked failed; reload once the device is unlocked.
    React.useEffect(() => {
        const reload = () => { void refetch(); };
        window.addEventListener(PIN_UNLOCKED_EVENT, reload);
        return () => window.removeEventListener(PIN_UNLOCKED_EVENT, reload);
    }, [refetch]);
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

    const navigate = (id) => { setActiveTab(id); setIsSidebarOpen(false); };
    const navProps = { activeTab, onNavigate: navigate };
    const displayName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Manager';
    const roleLabel = isOwner ? 'Owner' : userRole === 'reseller' ? 'Reseller' : userRole;
    const copyStoreLink = () => {
        navigator.clipboard.writeText(window.location.origin);
        showToast('Store link copied!', 'success');
    };
    const quickTabs = QUICK_TABS;
    const menuActive = !quickTabs.some(tab => tab.id === activeTab);

    const accountPanel = (
        <div className="border-t border-line p-3">
            <div className="flex items-center gap-2 rounded-lg py-1 pl-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-sm font-bold uppercase text-ink" aria-hidden="true">{displayName.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{displayName}</p>
                    <p className="truncate text-xs capitalize text-ink-2">{roleLabel}</p>
                </div>
                <button type="button" onClick={copyStoreLink} className="icon-btn size-10" aria-label="Copy store link" title="Copy store link">
                    <Link2 size={18} />
                </button>
                <button type="button" onClick={() => { setIsSidebarOpen(false); onLock(); }} className="icon-btn size-10" aria-label="Lock with PIN" title="Lock with PIN">
                    <Lock size={18} />
                </button>
                <button type="button" onClick={api.logout} className="icon-btn size-10" aria-label="Sign out" title="Sign out">
                    <LogOut size={18} />
                </button>
            </div>
        </div>
    );

    return (
        <ReadOnlyContext.Provider value={session.readOnly === true}>
        <div className="flex h-dvh overflow-hidden bg-ground font-sans text-ink">
            <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
                <div className="flex h-16 shrink-0 items-center px-5">
                    <Logo className="h-9" />
                </div>
                <nav aria-label="Workspace" className="flex-1 overflow-y-auto px-3 py-4">
                    <NavGroups isOwner={isOwner} {...navProps} />
                </nav>
                {accountPanel}
            </aside>

            <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 lg:h-16 lg:px-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="lg:hidden"><Logo className="h-7" /></span>
                        <h1 className="display truncate text-2xl lg:text-3xl">{TAB_TITLES[activeTab]}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {loading && (
                            <span role="status" className="flex items-center gap-2 text-sm text-ink-2">
                                <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
                                <span className="hidden sm:inline">Syncing…</span>
                                <span className="sr-only sm:hidden">Syncing</span>
                            </span>
                        )}
                        <span className="hidden text-sm text-ink-2 lg:inline">{displayName}</span>
                    </div>
                </header>

                <div className="relative flex-1 overflow-y-auto px-4 pt-5 pb-28 lg:px-8 lg:pt-8 lg:pb-10">
                    {session.readOnly && <div role="status" className="mx-auto mb-5 flex max-w-7xl items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                        <span>{session.environment === 'staging'
                            ? 'Read-only staging snapshot. You can review data here; saves, checkout and SMS delivery are disabled. The live store is unchanged.'
                            : 'Maintenance: data is temporarily read-only. Saves and checkout are disabled until maintenance is complete.'}</span>
                    </div>}
                    {legacyCache && (
                        <div role="status" className="mx-auto mb-5 flex max-w-7xl flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                            <span>Legacy data is saved in this browser. It has not been imported. Export it for owner review before making any import.</span>
                            <button className="btn-secondary" onClick={() => {
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
                        <div role="alert" className="mx-auto mb-5 flex max-w-7xl flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                            <span>Unable to sync data: {error}</span>
                            <button onClick={refetch} disabled={loading} className="btn-secondary">Retry</button>
                        </div>
                    )}
                    {error && transactions.length === 0 ? null : loading && transactions.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <LoadingState label="Loading system data…" />
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
                                    <DashboardStats transactions={effectiveTransactions} onDeleteAll={isOwner ? handleDeleteAll : undefined} readOnly={session.readOnly === true} />
                                    <TransactionList transactions={effectiveTransactions} onDelete={deleteTransaction} readOnly={session.readOnly === true} />
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

                <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
                    <div className="grid grid-cols-4">
                        {quickTabs.map(({ id, label, icon: Icon }) => (
                            <button key={id} type="button" onClick={() => navigate(id)} aria-current={activeTab === id ? 'page' : undefined}
                                className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold', activeTab === id ? 'text-ink' : 'text-ink-3')}>
                                <Icon size={22} aria-hidden="true" className={activeTab === id ? 'text-primary' : ''} />
                                {label}
                            </button>
                        ))}
                        <button type="button" onClick={() => setIsSidebarOpen(true)} aria-haspopup="dialog" aria-expanded={isSidebarOpen}
                            className={clsx('flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold', menuActive ? 'text-ink' : 'text-ink-3')}>
                            <Menu size={22} aria-hidden="true" className={menuActive ? 'text-primary' : ''} />
                            Menu
                        </button>
                    </div>
                </nav>
            </main>

            {isSidebarOpen && (
                <Dialog variant="drawer" onClose={() => setIsSidebarOpen(false)} title="Menu" closeLabel="Close menu" bodyClassName="p-0">
                    <div className="flex h-full flex-col">
                        <nav aria-label="Main" className="flex-1 px-3 py-4">
                            <NavGroups isOwner={isOwner} {...navProps} />
                        </nav>
                        {accountPanel}
                    </div>
                </Dialog>
            )}

            {showAddStockModal && createPortal(
                <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 sm:items-center sm:p-6">
                    <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl">
                        <Suspense fallback={<LoadingState label="Loading stock form…" />}>
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
        </ReadOnlyContext.Provider>
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
