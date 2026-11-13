import { useMemo, useState } from 'react';
import { ClipboardPenLine } from 'lucide-react';
import BlankBoard from './BlankBoard';
import BlankCountDialog from './BlankCountDialog';
import { useColors, useProducts } from '../../hooks/useInventory';
import { useActivityLog } from '../../hooks/useActivityLog';
import { apiRequest } from '../../lib/apiClient';
import { useToast } from '../ui/Toast';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';
import { blankTotals, currentBlankCount, suggestedBlankColors } from '../../lib/blankCounts';

/** Owner: the blank shirts on the shelf, entered by hand (src/lib/blankCounts.js). Print staff see and update the same board. */
export default function BlankShirts({ transactions, onChanged, userEmail }) {
    const readOnly = useReadOnly();
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const colors = useColors(transactions);
    const products = useProducts(transactions);
    const count = useMemo(() => currentBlankCount(transactions, userEmail), [transactions, userEmail]);
    const suggested = useMemo(() => suggestedBlankColors(products, colors), [products, colors]);
    // One request ID per open dialog, so a retry after a lost response replays that save instead of adding it twice.
    const [editing, setEditing] = useState(null);

    // The feed refresh joins a poll already in flight, which may have read before this save; the second read comes after it.
    const refresh = async () => { await onChanged?.(); await onChanged?.(); };
    const save = async (board, basedOn) => {
        let saved;
        try {
            saved = await apiRequest('/api/production/blanks', { method: 'POST', body: { ...board, basedOn, requestId: editing.requestId } });
        } catch (failure) {
            if (failure?.code === 'production_conflict') await refresh();
            throw failure;
        }
        await refresh();
        void logActivity('Count Blank Shirts', { colors: board.rows.length, shirts: blankTotals(board.rows).total }, saved?.id ?? null);
        setEditing(null);
        showToast('Blank shirt count saved. The print staff see it now.', 'success');
    };
    const start = (
        <button type="button" onClick={() => setEditing({ requestId: crypto.randomUUID() })} disabled={readOnly}
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
                        Count the blank shirts on the shelf and enter them by color and size. The print staff see the same board on their phones and can update it too.
                    </p>
                    <div className="mt-5">{start}</div>
                </section>
            )}
            <p className="max-w-prose text-sm text-ink-2">
                Print staff see and update this board under Blanks in their print queue. Inventory still works blank shirts out from what you bought and sold.
            </p>
            {editing && <BlankCountDialog count={count} suggested={suggested} colors={colors} onClose={() => setEditing(null)} onSave={save} />}
        </div>
    );
}
