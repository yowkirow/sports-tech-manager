import { useMemo, useState } from 'react';
import { ClipboardPenLine } from 'lucide-react';
import BlankBoard from './BlankBoard';
import BlankCountDialog from './BlankCountDialog';
import { useColors, useProducts } from '../../hooks/useInventory';
import { useActivityLog } from '../../hooks/useActivityLog';
import { useToast } from '../ui/Toast';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import { BLANK_COUNT, blankTotals, currentBlankCount, suggestedBlankColors } from '../../lib/blankCounts';

/** Owner: the blank shirts on the shelf, entered by hand (src/lib/blankCounts.js). Print staff see the same board. */
export default function BlankShirts({ transactions, onAddTransaction }) {
    const readOnly = useReadOnly();
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const colors = useColors(transactions);
    const products = useProducts(transactions);
    const count = useMemo(() => currentBlankCount(transactions), [transactions]);
    const suggested = useMemo(() => suggestedBlankColors(products, colors), [products, colors]);
    // One record ID per open dialog, and one date from its first save, so a retry after a lost response
    // replays that save instead of adding the count twice.
    const [editing, setEditing] = useState(null);

    const save = async details => {
        const identity = { id: editing.id, date: editing.date ?? new Date().toISOString() };
        if (!editing.date) setEditing(identity);
        await onAddTransaction({ ...identity, type: BLANK_COUNT, category: 'stock', amount: 0, description: 'Blank shirt count', details });
        void logActivity('Count Blank Shirts', { colors: details.rows.length, shirts: blankTotals(details.rows).total }, identity.id);
        setEditing(null);
        showToast('Blank shirt count saved. The print staff see it now.', 'success');
    };
    const start = (
        <button type="button" onClick={() => setEditing({ id: crypto.randomUUID(), date: null })} disabled={readOnly}
            title={readOnly ? READ_ONLY_HINT : undefined} className="btn-primary w-full whitespace-nowrap sm:w-auto">
            <ClipboardPenLine size={18} aria-hidden="true" /> {count ? 'Update count' : 'Enter the count'}
        </button>
    );

    return (
        <div className="max-w-4xl space-y-4">
            {count ? <BlankBoard count={count} title="On the shelf" action={start} /> : (
                <section className="surface p-5 sm:p-8" aria-labelledby="blank-shirts-empty">
                    <h2 id="blank-shirts-empty" className="section-title">No count yet</h2>
                    <p className="mt-2 max-w-prose text-sm text-ink-2">
                        Count the blank shirts on the shelf and enter them by color and size. The print staff see the same board on their phones.
                    </p>
                    <div className="mt-5">{start}</div>
                </section>
            )}
            <p className="max-w-prose text-sm text-ink-2">
                Print staff see this board under Blanks in their print queue. Inventory still works blank shirts out from what you bought and sold.
            </p>
            {editing && <BlankCountDialog count={count} suggested={suggested} colors={colors} onClose={() => setEditing(null)} onSave={save} />}
        </div>
    );
}
