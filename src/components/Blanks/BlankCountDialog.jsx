import { useId, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Plus, X } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { Swatch } from './BlankBoard';
import {
    BLANK_COLOR_MAX, BLANK_NOTE_MAX, BLANK_SIZES, MAX_BLANK_COLORS, MAX_BLANKS_PER_SIZE, blankHex, readBlankCount
} from '../../lib/blankCounts';

const WHOLE = /^\d+$/;
// Phones: the color and its remove button, then the six sizes in one row under them. Wider screens: one row.
const ROW = 'grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_repeat(6,3.5rem)_2.75rem]';
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

/** The owner enters what's on the shelf. Starts from the board in force, or from the shop's shirt colors for a first count. */
export default function BlankCountDialog({ count, suggested, colors, onClose, onSave }) {
    const formId = useId();
    const [rows, setRows] = useState(() => editable(count?.rows ?? suggested));
    const [note, setNote] = useState('');
    const [adding, setAdding] = useState('');
    const [addProblem, setAddProblem] = useState('');
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const onBoard = new Set(rows.map(row => row.color.toLowerCase()));
    const suggestions = colors.map(color => color.name.trim()).filter(name => name && !onBoard.has(name.toLowerCase()));
    const problem = problemWith(rows);
    const total = rows.reduce((sum, row) => sum + BLANK_SIZES.reduce((rowSum, size) => (
        rowSum + (badValue(row.values[size]) ? 0 : Number(typed(row.values[size]) || 0))), 0), 0);

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
        setBusy(true);
        setError('');
        try { await onSave({ rows: board.rows, ...(board.note ? { note: board.note } : {}) }); }
        catch (failure) {
            setError(failure?.message || 'The count couldn’t be saved. Try again.');
            setBusy(false);
        }
    };
    const shown = (checked && problem) || error;

    return (
        <Dialog
            onClose={() => { if (!busy) onClose(); }}
            title={count ? 'Update blank shirt count' : 'Enter blank shirt count'}
            description="Type what’s on the shelf by color and size. Empty boxes count as none. The print staff see this board."
            size="lg"
            footer={(
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-ink-2">
                        <span className="num font-semibold text-ink">{total.toLocaleString('en-PH')}</span>
                        {` ${total === 1 ? 'shirt' : 'shirts'} · ${rows.length} ${rows.length === 1 ? 'color' : 'colors'}`}
                    </p>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
                        <button type="submit" form={formId} disabled={busy} className="btn-primary">
                            {busy && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
                            {busy ? 'Saving…' : 'Save count'}
                        </button>
                    </div>
                </div>
            )}
        >
            <form id={formId} onSubmit={submit} noValidate>
                <fieldset disabled={busy} className="m-0 min-w-0 space-y-5 border-0 p-0">
                    <div>
                        <div aria-hidden="true" className={clsx(ROW, 'hidden pb-2 text-xs font-medium text-ink-2 sm:grid')}>
                            <span>Color</span>
                            {BLANK_SIZES.map(size => <span key={size} className="text-center">{size}</span>)}
                            <span />
                        </div>
                        {rows.length ? (
                            <ul className="divide-y divide-line border-y border-line">
                                {rows.map(row => (
                                    <li key={row.key} className={clsx(ROW, 'py-3')}>
                                        <p className="col-start-1 row-start-1 flex min-w-0 items-start gap-2 font-medium text-ink">
                                            <Swatch hex={row.hex} /><span className="min-w-0">{row.color}</span>
                                        </p>
                                        <button type="button" onClick={() => setRows(current => current.filter(entry => entry.key !== row.key))}
                                            className="icon-btn col-start-2 row-start-1 hover:text-red-300 sm:col-start-8" aria-label={`Remove ${row.color}`}>
                                            <X size={18} aria-hidden="true" />
                                        </button>
                                        <div className="col-span-2 grid grid-cols-6 gap-2 sm:contents">
                                            {BLANK_SIZES.map(size => (
                                                <label key={size} className="flex min-w-0 flex-col items-center gap-1 text-xs font-medium text-ink-2">
                                                    <span className="sm:sr-only">{size}</span>
                                                    <input value={row.values[size]} onChange={event => edit(row.key, size, event.target.value)}
                                                        inputMode="numeric" autoComplete="off" placeholder="0" aria-label={`${row.color} ${size}`}
                                                        aria-invalid={badValue(row.values[size]) || undefined}
                                                        className={clsx('field num px-1 text-center', badValue(row.values[size]) && 'border-red-400/70')} />
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
                                    placeholder="Choose or type a color" className="field" aria-describedby={addProblem ? `${formId}-add-problem` : undefined} />
                                <datalist id={`${formId}-colors`}>{suggestions.map(name => <option key={name} value={name} />)}</datalist>
                                <button type="button" onClick={add} className="btn-secondary shrink-0">
                                    <Plus size={16} aria-hidden="true" /> Add
                                </button>
                            </div>
                            {addProblem && <p id={`${formId}-add-problem`} role="alert" className="mt-1.5 text-sm text-red-300">{addProblem}</p>}
                        </div>
                    )}

                    <div>
                        <label htmlFor={`${formId}-note`} className="field-label">Note (optional)</label>
                        <input id={`${formId}-note`} value={note} maxLength={BLANK_NOTE_MAX} autoComplete="off" onChange={event => setNote(event.target.value)}
                            placeholder="e.g. After the Nov 10 restock" className="field" aria-describedby={`${formId}-note-help`} />
                        <p id={`${formId}-note-help`} className="mt-1.5 text-xs text-ink-2">The print staff see it with the count.</p>
                    </div>
                </fieldset>
                {shown && <p role="alert" className="mt-4 text-sm text-red-300">{shown}</p>}
            </form>
        </Dialog>
    );
}
