import { useId, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, Loader2, Plus, X } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { Swatch } from './BlankBoard';
import {
    BLANK_COLOR_MAX, BLANK_NOTE_MAX, BLANK_SIZES, MAX_BLANK_COLORS, MAX_BLANKS_PER_SIZE, blankHex, countedWhen, readBlankCount, whoCounted
} from '../../lib/blankCounts';

const WHOLE = /^\d+$/;
// Phones: the color and its remove button, then the six sizes in one row under them. Wider screens: one row.
const ROW = 'grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_repeat(6,3.5rem)_2.75rem]';
// Print staff get 48px controls (the print floor's minimum), so the remove column widens to match.
const STAFF_ROW = 'grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_repeat(6,3.5rem)_3rem]';
const editable = rows => rows.map(row => ({
    key: crypto.randomUUID(), color: row.color, hex: row.hex ?? null,
    values: Object.fromEntries(BLANK_SIZES.map(size => [size, row.sizes ? String(row.sizes[size]) : '']))
}));
const typed = value => value.trim();
const badValue = value => typed(value) !== '' && (!WHOLE.test(typed(value)) || Number(typed(value)) > MAX_BLANKS_PER_SIZE);

/** The first thing to fix in the board as typed, or ''. Empty boxes count as none. */
function problemWith(rows) {
    if (!rows.length) return 'Add at least one color.';
    for (const row of rows) {
        const size = BLANK_SIZES.find(entry => badValue(row.values[entry]));
        if (size) return `Enter ${row.color} ${size} as a whole number from 0 to 100,000.`;
    }
    return '';
}

// Each open dialog saves under one request ID, so a retry after a lost response replays the first save.
const unconfirmed = failure => !failure?.status || failure.code === 'invalid_response'
    || (failure.status >= 500 && failure.code !== 'maintenance_read_only');
function saveError(failure) {
    if (failure?.code === 'production_receipt_conflict') return 'Your earlier save went through. Close this to see it, then update the count again if anything changed.';
    if (unconfirmed(failure)) return 'The save wasn’t confirmed. Check your connection and save again; it won’t be saved twice.';
    return failure.message || 'The count couldn’t be saved. Try again.';
}

/**
 * What changed under the open dialog, if anything. `shown` is the board in force (as of pressing Save while
 * saving), `started` the one the dialog opened on, `refusedFrom` the board a refused save started from.
 */
function changeNotice(shown, started, refusedFrom) {
    const id = shown?.id ?? null;
    // Still showing the board a save was refused from: the reload didn't bring the newer count in.
    if (refusedFrom !== undefined && refusedFrom === id) {
        return { text: 'A newer count was saved while you had this open, so yours wasn’t saved, and it couldn’t be loaded here. Check your connection, then save again.' };
    }
    if (id === (started?.id ?? null)) return null;
    // Every save is stamped after the count it replaces, so an earlier board means the newer one was deleted.
    if (shown && (!started || Date.parse(shown.countedAt) >= Date.parse(started.countedAt))) {
        const who = whoCounted(shown);
        return { replace: true, text: `${who.charAt(0).toUpperCase()}${who.slice(1)} saved a count ${countedWhen(shown.countedAt)} while you had this open. Your numbers are still here: replace it with yours, or cancel to keep it.` };
    }
    return { text: 'The count you started from was deleted while you had this open. Your numbers are still here: save them, or cancel.' };
}

/**
 * Enter what's on the shelf. Starts from the board in force, or from the shop's shirt colors for a first count.
 * The owner and the print staff both use it (`forStaff` on /print: 48px controls, and says the owner sees it).
 * `onSave(board, basedOn)` sends the count this dialog shows as current; when someone saved a newer one
 * meanwhile, the server refuses it, the parent reloads, and the dialog says who saved it and when.
 */
export default function BlankCountDialog({ count, suggested, colors, onClose, onSave, forStaff = false }) {
    const formId = useId();
    const [rows, setRows] = useState(() => editable(count?.rows ?? suggested));
    const [started] = useState(() => (count ? { id: count.id, countedAt: count.countedAt } : null));
    const [note, setNote] = useState('');
    const [adding, setAdding] = useState('');
    const [addProblem, setAddProblem] = useState('');
    const [checked, setChecked] = useState(false);
    // While a save is in flight the dialog stays on the board it saved from: the parent reloads the board
    // before closing it, and the count just saved mustn't read as someone else's.
    const [saving, setSaving] = useState(null);
    const [error, setError] = useState('');
    const [refusedFrom, setRefusedFrom] = useState(undefined);
    const busy = saving !== null;
    const notice = changeNotice(busy ? saving.count : count, started, refusedFrom);
    const onBoard = new Set(rows.map(row => row.color.toLowerCase()));
    const suggestions = colors.map(color => color.name.trim()).filter(name => name && !onBoard.has(name.toLowerCase()));
    const problem = problemWith(rows);
    const total = rows.reduce((sum, row) => sum + BLANK_SIZES.reduce((rowSum, size) => (
        rowSum + (badValue(row.values[size]) ? 0 : Number(typed(row.values[size]) || 0))), 0), 0);
    const tall = forStaff && 'min-h-12';
    const grid = forStaff ? STAFF_ROW : ROW;

    const edit = (key, size, value) => setRows(current => current.map(row => (
        row.key === key ? { ...row, values: { ...row.values, [size]: value } } : row)));
    const add = () => {
        const color = adding.replace(/\s+/g, ' ').trim();
        if (!color) { setAddProblem('Type or choose the color to add.'); return; }
        if (color.length > BLANK_COLOR_MAX) { setAddProblem(`Keep the color name to ${BLANK_COLOR_MAX} characters.`); return; }
        if (onBoard.has(color.toLowerCase())) { setAddProblem(`${color} is already on the board.`); return; }
        const known = colors.find(entry => entry.name.trim().toLowerCase() === color.toLowerCase());
        setRows(current => [...current, ...editable([{ color: known?.name.trim() ?? color, hex: blankHex(known?.hex) }])]);
        setAdding('');
        setAddProblem('');
    };
    const submit = async event => {
        event.preventDefault();
        setChecked(true);
        if (problem || busy) return;
        const board = readBlankCount({
            rows: rows.map(row => ({ color: row.color, hex: row.hex,
                sizes: Object.fromEntries(BLANK_SIZES.map(size => [size, Number(typed(row.values[size]) || 0)])) })),
            note: note.trim()
        });
        if (!board) { setError('Check the colors and numbers, then save again.'); return; }
        setSaving({ count });
        setError('');
        try { await onSave({ rows: board.rows, ...(board.note ? { note: board.note } : {}) }, count?.id ?? null); }
        catch (failure) {
            // A newer count exists: the parent has reloaded the board by now.
            if (failure?.code === 'production_conflict') setRefusedFrom(count?.id ?? null);
            else setError(saveError(failure));
            setSaving(null);
        }
    };
    const shown = (checked && problem) || error;
    const sharedWith = forStaff ? 'The owner sees' : 'The print staff see';

    return (
        <Dialog
            onClose={() => { if (!busy) onClose(); }}
            title={count ? 'Update blank shirt count' : 'Enter blank shirt count'}
            description={`Type what’s on the shelf by color and size. Empty boxes count as none. ${sharedWith} this board.`}
            size="lg"
            footer={(
                <div className="space-y-3">
                    {notice && (
                        <p role="status" className="flex gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-100">
                            <AlertCircle size={18} className="mt-px shrink-0 text-amber-300" aria-hidden="true" />
                            <span>{notice.text}</span>
                        </p>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-ink-2">
                            <span className="num font-semibold text-ink">{total.toLocaleString('en-PH')}</span>
                            {` ${total === 1 ? 'shirt' : 'shirts'} · ${rows.length} ${rows.length === 1 ? 'color' : 'colors'}`}
                        </p>
                        <div className="flex flex-col-reverse gap-3 sm:flex-row">
                            <button type="button" onClick={onClose} disabled={busy} className={clsx('btn-secondary', tall)}>Cancel</button>
                            <button type="submit" form={formId} disabled={busy} className={clsx('btn-primary', tall)}>
                                {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
                                {busy ? 'Saving…' : notice?.replace ? 'Replace with my count' : 'Save count'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        >
            <form id={formId} onSubmit={submit} noValidate>
                <fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0">
                    <div>
                        <div aria-hidden="true" className={clsx(grid, 'hidden pb-2 text-xs font-medium text-ink-2 sm:grid')}>
                            <span>Color</span>
                            {BLANK_SIZES.map(size => <span key={size} className="text-center">{size}</span>)}
                            <span />
                        </div>
                        {rows.length ? (
                            <ul className="divide-y divide-line border-y border-line">
                                {rows.map(row => (
                                    <li key={row.key} className={clsx(grid, 'py-3')}>
                                        <p className="col-start-1 row-start-1 flex min-w-0 items-start gap-2 font-medium text-ink">
                                            <Swatch hex={row.hex} /><span className="min-w-0">{row.color}</span>
                                        </p>
                                        <button type="button" onClick={() => setRows(current => current.filter(entry => entry.key !== row.key))}
                                            className={clsx('icon-btn col-start-2 row-start-1 hover:text-red-300 sm:col-start-8', forStaff && 'size-12')}
                                            aria-label={`Remove ${row.color}`}>
                                            <X size={18} aria-hidden="true" />
                                        </button>
                                        <div className="col-span-2 grid grid-cols-6 gap-2 sm:contents">
                                            {BLANK_SIZES.map(size => (
                                                <label key={size} className="flex min-w-0 flex-col items-center gap-1 text-xs font-medium text-ink-2">
                                                    <span className="sm:sr-only">{size}</span>
                                                    <input value={row.values[size]} onChange={event => edit(row.key, size, event.target.value)}
                                                        inputMode="numeric" autoComplete="off" placeholder="0" aria-label={`${row.color} ${size}`}
                                                        aria-invalid={badValue(row.values[size]) || undefined}
                                                        className={clsx('field num px-1 text-center', tall, badValue(row.values[size]) && 'border-red-400/70')} />
                                                </label>
                                            ))}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-2">No colors on the board. Add the colors you stock.</p>}
                    </div>

                    {rows.length < MAX_BLANK_COLORS && (
                        <div>
                            <label htmlFor={`${formId}-add`} className="field-label">Add a color</label>
                            <div className="flex gap-2">
                                <input id={`${formId}-add`} value={adding} list={`${formId}-colors`} maxLength={BLANK_COLOR_MAX} autoComplete="off"
                                    onChange={event => { setAdding(event.target.value); setAddProblem(''); }}
                                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
                                    placeholder="Choose or type a color" className={clsx('field', tall)} aria-describedby={addProblem ? `${formId}-add-problem` : undefined} />
                                <datalist id={`${formId}-colors`}>{suggestions.map(name => <option key={name} value={name} />)}</datalist>
                                <button type="button" onClick={add} className={clsx('btn-secondary shrink-0', tall)}>
                                    <Plus size={16} aria-hidden="true" /> Add
                                </button>
                            </div>
                            {addProblem && <p id={`${formId}-add-problem`} role="alert" className="mt-1.5 text-sm text-red-300">{addProblem}</p>}
                        </div>
                    )}

                    <div>
                        <label htmlFor={`${formId}-note`} className="field-label">Note (optional)</label>
                        <input id={`${formId}-note`} value={note} maxLength={BLANK_NOTE_MAX} autoComplete="off" onChange={event => setNote(event.target.value)}
                            placeholder={forStaff ? 'e.g. After today’s print run' : 'e.g. After the Nov 10 restock'} className={clsx('field', tall)}
                            aria-describedby={`${formId}-note-help`} />
                        <p id={`${formId}-note-help`} className="mt-1.5 text-xs text-ink-2">{sharedWith} it with the count.</p>
                    </div>
                </fieldset>
                {shown && <p role="alert" className="mt-4 text-sm text-red-300">{shown}</p>}
            </form>
        </Dialog>
    );
}
