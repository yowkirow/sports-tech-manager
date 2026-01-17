import * as XLSX from 'xlsx';
import { Package, Download } from 'lucide-react';
import Card from './ui/Card';

const InventoryList = ({ transactions }) => {
    // Calculate inventory
    const inventory = {};

    transactions.forEach(t => {
        if (!t.details || !t.details.size || !t.details.color) return;

        const key = `${t.details.size}-${t.details.color}`;

        if (!inventory[key]) {
            inventory[key] = {
                size: t.details.size,
                color: t.details.color,
                count: 0
            };
        }

        const quantity = t.details.quantity || 1; // Backwards compatibility for old records

        if (t.category === 'blanks' && t.type === 'expense') {
            inventory[key].count += quantity;
        } else if (t.type === 'sale') {
            inventory[key].count -= quantity;
        }
    });

    // Convert to array and sort
    const inventoryList = Object.values(inventory).sort((a, b) => {
        if (a.color !== b.color) return a.color.localeCompare(b.color);
        // Simple size sort logic (can be improved)
        const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
        return sizes.indexOf(a.size) - sizes.indexOf(b.size);
    });

    const exportToExcel = () => {
        const data = inventoryList.map(item => ({
            Color: item.color,
            Size: item.size,
            Quantity: item.count
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Inventory");
        XLSX.writeFile(wb, "inventory_status.xlsx");
    };

    return (
        <Card>
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Package className="text-muted" />
                    <h2 style={{ margin: 0 }}>Inventory Status</h2>
                </div>
                <button
                    onClick={exportToExcel}
                    className="btn btn-secondary"
                    style={{
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.9rem'
                    }}
                >
                    <Download size={16} /> Export
                </button>
            </div>

            {inventoryList.length === 0 ? (
                <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>No inventory data available.</p>
            ) : (
                <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                    {inventoryList.map((item) => (
                        <div
                            key={`${item.size}-${item.color}`}
                            style={{
                                background: 'rgba(255,255,255,0.03)',
                                padding: '1rem',
                                borderRadius: '12px',
                                border: '1px solid rgba(255,255,255,0.05)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>{item.color}</div>
                                <div className="text-muted" style={{ fontSize: '0.9rem' }}>Size: {item.size}</div>
                            </div>
                            <div style={{
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                color: item.count > 0 ? 'var(--text-main)' : 'var(--danger)'
                            }}>
                                {item.count}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
};

export default InventoryList;
