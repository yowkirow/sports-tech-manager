import { RefreshCw } from 'lucide-react';
import BlankBoard from '../Blanks/BlankBoard.jsx';
import { ProductionNotice } from './ProductionParts.jsx';

/** Print staff: the blank shirts on the shelf as the owner last counted them, read only (src/lib/blankCounts.js). */
export function PrintBlanks({ blanks }) {
    if (blanks.error && !blanks.blanks) {
        return <ProductionNotice error>
            <p>The blank shirt count could not be loaded. {blanks.error.message}</p>
            <button type="button" className="production-button" disabled={blanks.loading} onClick={blanks.load}>
                <RefreshCw size={18} aria-hidden="true" />Try again
            </button>
        </ProductionNotice>;
    }
    if (!blanks.loaded) return <p className="production-help" role="status">Loading the blank shirt count…</p>;
    if (!blanks.blanks) {
        return <div className="production-empty">
            <h3>No count yet</h3>
            <p>The owner hasn’t entered the blank shirt count yet.</p>
        </div>;
    }
    return <>
        {blanks.error && <ProductionNotice error>The count could not be refreshed. {blanks.error.message} This is the last count loaded.</ProductionNotice>}
        <BlankBoard count={blanks.blanks} title="Blank shirts" headingLevel={3} />
        <p className="production-help">The owner updates this count. If the shelf doesn’t match, tell the owner.</p>
    </>;
}
