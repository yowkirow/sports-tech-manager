import { useState } from 'react';
import { ClipboardPenLine, RefreshCw } from 'lucide-react';
import BlankBoard from '../Blanks/BlankBoard.jsx';
import BlankCountDialog from '../Blanks/BlankCountDialog.jsx';
import { ProductionNotice } from './ProductionParts.jsx';
import { apiRequest } from '../../lib/apiClient.js';
import { useToast } from '../ui/Toast.jsx';
import { useReadOnly, READ_ONLY_HINT } from '../ui/ReadOnly';

/**
 * Print staff: the blank shirts on the shelf as last counted, which they update too (owner request,
 * November 13, 2026; src/lib/blankCounts.js). The owner sees every count on the same board.
 */
export function PrintBlanks({ blanks, online = true }) {
    const readOnly = useReadOnly();
    const { showToast } = useToast();
    // One request ID per open dialog, so a retry after a lost response replays that save instead of adding it twice.
    const [editing, setEditing] = useState(null);
    const save = async (board, basedOn) => {
        try {
            await apiRequest('/api/production/blanks', { method: 'POST', body: { ...board, basedOn, requestId: editing.requestId } });
        } catch (failure) {
            if (failure?.code === 'production_conflict') await blanks.load();
            throw failure;
        }
        await blanks.load();
        setEditing(null);
        showToast('Blank shirt count saved. The owner sees it now.', 'success');
    };
    const start = <button type="button" className="production-button production-primary w-full sm:w-auto" disabled={readOnly || !online}
        title={readOnly ? READ_ONLY_HINT : !online ? 'Reconnect to update the count.' : undefined}
        onClick={() => setEditing({ requestId: crypto.randomUUID() })}>
        <ClipboardPenLine size={18} aria-hidden="true" />{blanks.blanks ? 'Update count' : 'Enter the count'}
    </button>;

    let content;
    if (blanks.error && !blanks.blanks) {
        content = <ProductionNotice error>
            <p>The blank shirt count could not be loaded. {blanks.error.message}</p>
            <button type="button" className="production-button" disabled={blanks.loading} onClick={blanks.load}>
                <RefreshCw size={18} aria-hidden="true" />Try again
            </button>
        </ProductionNotice>;
    } else if (!blanks.loaded) {
        content = <p className="production-help" role="status">Loading the blank shirt count…</p>;
    } else if (!blanks.blanks) {
        content = <div className="production-empty">
            <h3>No count yet</h3>
            <p>Count the blank shirts on the shelf and enter them by color and size. The owner sees the same board.</p>
            <div className="mt-4">{start}</div>
        </div>;
    } else {
        content = <>
            {blanks.error && <ProductionNotice error>The count could not be refreshed. {blanks.error.message} This is the last count loaded.</ProductionNotice>}
            <BlankBoard count={blanks.blanks} title="Blank shirts" headingLevel={3} action={start} />
            <p className="production-help">Update the count when you take blanks for printing or count the shelf. The owner sees each update.</p>
        </>;
    }
    return <>
        {content}
        {editing && <BlankCountDialog count={blanks.blanks} suggested={blanks.suggested} colors={blanks.colors} forStaff
            onClose={() => setEditing(null)} onSave={save} />}
    </>;
}
