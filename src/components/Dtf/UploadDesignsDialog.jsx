import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { api } from '../../lib/apiClient';
import { MAX_SVG_BYTES, designNameFromFile, heightFor, prepareSvgDesign, svgUrl } from '../../lib/svgDesign.js';
import { NumberField, inches } from './fields';
import { leftOutMessage } from './DesignGallery';

const DEFAULT_WIDTH = 4;

/** The print width to start from: the file's own size when it gives one in real units, else a guess to check. */
function startingWidth(prepared) {
    const suggested = prepared.suggestedWidthIn;
    if (suggested && prepared.suggestionFromUnits && suggested >= 0.25 && suggested <= 60) {
        return { widthIn: Math.round(suggested * 100) / 100, note: 'From the size saved in the file.' };
    }
    if (suggested && suggested >= 0.5 && suggested <= 22) {
        return { widthIn: Math.round(suggested * 100) / 100, note: 'Guessed from the file\'s pixel size. Check it.' };
    }
    return { widthIn: DEFAULT_WIDTH, note: 'The file doesn\'t say how big to print it. Set the width.' };
}

function problemWith(item) {
    if (item.status !== 'ready' && item.status !== 'failed') return null;
    if (!item.name.trim()) return 'Give the design a name.';
    const height = heightFor(item.widthIn, item.prepared.viewBox);
    if (height < 0.1) return 'At this width the design is too thin to print. Make it wider.';
    if (height > 120) return 'At this width the design is too tall. Make it narrower.';
    return null;
}

/** Checks, names and sizes each chosen SVG, then adds them to the gallery. */
export default function UploadDesignsDialog({ files, leftOut = [], usableWidthIn, onClose, onSaved }) {
    const [items, setItems] = useState(() => files.map(file => ({
        key: crypto.randomUUID(), id: crypto.randomUUID(), file, status: 'preparing', name: designNameFromFile(file.name)
    })));
    const [saving, setSaving] = useState(false);
    const urls = useRef([]);
    const update = (key, changes) => setItems(current => current.map(item => (item.key === key ? { ...item, ...changes } : item)));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const item of items) {
                try {
                    if (item.file.size > MAX_SVG_BYTES) throw new Error('This SVG is larger than 5 MB. Simplify it or export it again.');
                    const prepared = await prepareSvgDesign(await item.file.text(), { id: item.id });
                    if (cancelled) return;
                    const url = svgUrl(prepared.svg);
                    urls.current.push(url);
                    update(item.key, { status: 'ready', prepared, url, ...startingWidth(prepared) });
                } catch (error) {
                    if (!cancelled) update(item.key, { status: 'error', error: error.message || 'This file couldn\'t be read.' });
                }
            }
        })();
        const created = urls.current;
        return () => {
            cancelled = true;
            created.forEach(url => URL.revokeObjectURL(url));
        };
        // Files are prepared once, when the dialog opens.
    }, []);

    const saveable = items.filter(item => (item.status === 'ready' || item.status === 'failed') && !problemWith(item));
    const preparing = items.some(item => item.status === 'preparing');
    const blocked = items.some(item => (item.status === 'ready' || item.status === 'failed') && problemWith(item));

    const save = async () => {
        setSaving(true);
        let failed = 0;
        for (const item of saveable) {
            update(item.key, { status: 'saving' });
            try {
                const { design } = await api.dtf.create({
                    id: item.id, name: item.name.trim().replace(/\s+/g, ' '), widthIn: item.widthIn,
                    heightIn: heightFor(item.widthIn, item.prepared.viewBox), svg: item.prepared.svg
                });
                onSaved(design, item.prepared.svg);
                update(item.key, { status: 'saved' });
            } catch (error) {
                failed += 1;
                update(item.key, { status: 'failed', error: error.message || 'This design couldn\'t be saved.' });
            }
        }
        setSaving(false);
        if (!failed) onClose(saveable.length);
    };

    const count = saveable.length;
    return (
        <Dialog
            onClose={() => { if (!saving) onClose(0); }}
            title="Add designs"
            description="Check each design's name and print width. Its height follows its shape."
            size="lg"
            bodyClassName="px-5"
            footer={(
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => onClose(0)} disabled={saving} className="btn-secondary">Cancel</button>
                    <button type="button" onClick={save} disabled={saving || preparing || blocked || !count} className="btn-primary">
                        {saving ? 'Saving…' : preparing ? 'Checking files…' : <span>Add <span className="num">{count}</span> {count === 1 ? 'design' : 'designs'}</span>}
                    </button>
                </div>
            )}
        >
            {leftOut.length > 0 && (
                <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> <span className="min-w-0 break-words">{leftOutMessage(leftOut)}</span>
                </p>
            )}
            <ul className="divide-y divide-line">
                {items.map(item => {
                    const problem = problemWith(item);
                    const height = item.prepared ? heightFor(item.widthIn, item.prepared.viewBox) : null;
                    const editable = (item.status === 'ready' || item.status === 'failed') && !saving;
                    return (
                        <li key={item.key} className="flex gap-4 py-4">
                            <div className="dtf-film relative size-20 shrink-0 overflow-hidden rounded-lg sm:size-24">
                                {item.url && <img src={item.url} alt="" draggable={false} className="absolute inset-0 size-full object-contain p-2" />}
                                {item.status === 'preparing' && (
                                    <span className="absolute inset-0 flex items-center justify-center">
                                        <span className="size-6 animate-spin rounded-full border-2 border-ground/30 border-t-ground" aria-hidden="true" />
                                    </span>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="truncate pt-0.5 text-xs text-ink-3" title={item.file.name}>{item.file.name}</p>
                                    {item.status !== 'saved' && !saving && (
                                        <button type="button" onClick={() => setItems(current => current.filter(entry => entry.key !== item.key))}
                                            aria-label={`Leave out ${item.file.name}`} className="icon-btn -mr-2 -mt-2">
                                            <X size={18} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                                {item.status === 'preparing' && <p role="status" className="mt-1 text-sm text-ink-2">Checking the file…</p>}
                                {item.status === 'error' && <p role="alert" className="mt-1 text-sm text-red-300">{item.error}</p>}
                                {item.status === 'saved' && <p role="status" className="mt-1 text-sm text-emerald-300">Added to your designs.</p>}
                                {item.prepared && item.status !== 'saved' && (
                                    <div className="mt-2 space-y-3">
                                        <div>
                                            <label htmlFor={`dtf-name-${item.key}`} className="field-label">Name</label>
                                            <input id={`dtf-name-${item.key}`} value={item.name} maxLength={120} disabled={!editable}
                                                onChange={event => update(item.key, { name: event.target.value })} className="field" autoComplete="off" />
                                        </div>
                                        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                                            <NumberField label="Print width" value={item.widthIn} min={0.1} max={60} className="w-32" disabled={!editable}
                                                onChange={widthIn => update(item.key, { widthIn, note: null })} />
                                            <p className="num pb-3 text-sm text-ink-2">× {inches(height)} in tall</p>
                                        </div>
                                        {item.note && <p className="text-sm text-ink-2">{item.note}</p>}
                                        {item.widthIn > usableWidthIn && (
                                            <p className="text-sm text-amber-200">Wider than the sheet&apos;s <span className="num">{inches(usableWidthIn)}&nbsp;in</span>; it won&apos;t fit until you make it smaller.</p>
                                        )}
                                        {problem && <p role="alert" className="text-sm text-red-300">{problem}</p>}
                                        {item.status === 'failed' && <p role="alert" className="text-sm text-red-300">{item.error}</p>}
                                        {item.status === 'saving' && <p role="status" className="text-sm text-ink-2">Saving…</p>}
                                        {item.prepared.warnings.length > 0 && (
                                            <ul className="space-y-1.5">
                                                {item.prepared.warnings.map(warning => (
                                                    <li key={warning} className="flex items-start gap-2 text-sm text-amber-200">
                                                        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {warning}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {!items.length && <p className="py-6 text-sm text-ink-2">No files left to add.</p>}
        </Dialog>
    );
}
