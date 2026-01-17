import React, { useState } from 'react';
import useSupabaseTransactions from './hooks/useSupabaseTransactions';
import DashboardStats from './components/DashboardStats';
import TransactionForm from './components/TransactionForm';
import TransactionList from './components/TransactionList';
import InventoryList from './components/InventoryList';
import { LayoutDashboard, Package, PlusSquare } from 'lucide-react';

import { useToast } from './components/ui/Toast';

function App() {
    const { transactions, loading, error, addTransaction: addToSupabase, deleteTransaction: deleteFromSupabase } = useSupabaseTransactions();
    const [activeTab, setActiveTab] = useState('inventory');
    const { showToast } = useToast();

    const addTransaction = async (transaction) => {
        try {
            await addToSupabase(transaction);
            showToast('Stock added successfully!', 'success');
        } catch (err) {
            showToast('Failed to add stock', 'error');
        }
    };

    const deleteTransaction = async (id) => {
        try {
            await deleteFromSupabase(id);
        } catch (err) {
            showToast('Failed to delete transaction', 'error');
        }
    };

    const NavItem = ({ id, label, icon: Icon }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`nav-item ${activeTab === id ? 'active' : ''}`}
        >
            <Icon size={24} /> {/* Increased icon size slightly for mobile touch */}
            <span>{label}</span>
        </button>
    );

    return (
        <div className="app-container">
            {/* Sidebar / Bottom Nav */}
            <aside className="app-sidebar">
                <div className="sidebar-brand">
                    <div style={{
                        background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                        padding: '4px',
                        borderRadius: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <img src="/logo.jpg" alt="Logo" style={{ width: '36px', height: 'auto', borderRadius: '6px' }} />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.2rem', fontFamily: 'sans-serif', fontStyle: 'italic' }}>SportsTech</h1>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <NavItem id="inventory" label="Inventory" icon={Package} />
                    <NavItem id="add" label="Add" icon={PlusSquare} /> {/* Shortened label for mobile */}
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="main-content">
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                            <p>Loading your data...</p>
                        </div>
                    </div>
                ) : (
                    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                        {/* Mobile Header (Visible only on mobile could be added, but relying on content for now) */}

                        {activeTab === 'dashboard' && (
                            <div className="animate-fade-in">
                                <h1 style={{ marginBottom: '1.5rem' }}>Dashboard</h1>
                                <DashboardStats transactions={transactions} />
                                <div style={{ marginTop: '2rem' }}>
                                    <TransactionList transactions={transactions} onDelete={deleteTransaction} />
                                </div>
                            </div>
                        )}

                        {activeTab === 'inventory' && (
                            <div className="animate-fade-in">
                                <h1 style={{ marginBottom: '1.5rem' }}>Inventory</h1>
                                <InventoryList transactions={transactions} />
                            </div>
                        )}

                        {activeTab === 'add' && (
                            <div className="animate-fade-in" style={{ maxWidth: '600px', margin: '0 auto' }}>
                                <h1 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Add Product</h1>
                                <TransactionForm onAddTransaction={addTransaction} />
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
