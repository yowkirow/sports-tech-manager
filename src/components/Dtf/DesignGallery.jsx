import { useRef, useState } from 'react';
import { Pencil, Plus, Search, Upload } from 'lucide-react';
import clsx from 'clsx';
import { READ_ONLY_HINT } from '../ui/ReadOnly';
import { useToast } from '../ui/Toast';
import { printSize } from './fields';

const isSvg = file => /\.svgz?$/i.test(file.name) || file.type === 'image/svg+xml';

/** "notes.txt isn't an SVG…" for the files an upload left out. */
export function leftOutMessage(names) {
    if (!names.length) return '';
    if (names.length === 1) return `${names[0]} isn't an SVG, so it was left out. Save it as SVG and upload again.`;
    return `${names.length} files aren't SVGs, so they were left out: ${names.join(', ')}. Save them as SVG and upload again.`;
}

// The checkerboard well is the tile; name, size and actions sit on the panel below it, never in a second card.
function DesignTile({ design, file, count, onAdd, onEdit, onRetry, readOnly }) {
    return (
        <li className="flex min-w-0 flex-col">
            <div className="dtf-film relative aspect-square overflow-hidden rounded-xl">
                {file?.status === 'ready' && <img src={file.url} alt="" draggable={false} className="absolute inset-0 size-full object-contain p-3" />}
                {(!file || file.status === 'loading') && (
                    <span role="status" className="absolute inset-0 flex items-center justify-center">
                        <span className="size-6 animate-spin rounded-full border-2 border-ground/30 border-t-ground" aria-hidden="true" />
                        <span className="sr-only">Loading {design.name}</span>
                    </span>
                )}
                {file?.status === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/90 p-3 text-center">
                        <p className="text-xs text-ink-2">Couldn&apos;t load this file.</p>
                        <button type="button" className="btn-secondary min-h-11 px-4 text-sm" onClick={() => onRetry(design)}>Try again</button>
                    </div>
                )}
                {count > 0 && (
                    <span key={count} className="badge num absolute left-2 top-2 animate-bump border-transparent bg-ground text-ink">×{count} on the sheet</span>
                )}
            </div>
            <div className="flex flex-1 flex-col gap-3 pt-3">
                <div className="min-w-0">
                    <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-ink">{design.name}</p>
                    <p className="num mt-1 text-xs text-ink-2">{printSize(design.widthIn, design.heightIn)}</p>
                </div>
                <div className="mt-auto flex items-center gap-1">
                    <button type="button" onClick={() => onAdd(design)} aria-label={`Add ${design.name} to the sheet`} className="btn-light flex-1 px-3">
                        <Plus size={17} aria-hidden="true" /> Add
                    </button>
                    <button type="button" onClick={() => onEdit(design)} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}
                        aria-label={`Edit ${design.name}`} className="icon-btn -mr-2">
                        <Pencil size={17} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </li>
    );
}

/** The owner's saved designs: upload once, then add them to sheets. */
export default function DesignGallery({ className, designs, files, counts, onAdd, onEdit, onUpload, onRetry, readOnly }) {
    const { showToast } = useToast();
    const [query, setQuery] = useState('');
    const [dragging, setDragging] = useState(false);
    const picker = useRef(null);
    const wanted = query.trim().toLowerCase();
    const shown = wanted ? designs.filter(design => design.name.toLowerCase().includes(wanted)) : designs;

    // Files that aren't SVGs are named in the upload dialog, or in a toast when nothing is left to add.
    const take = list => {
        const svgs = list.filter(isSvg);
        const leftOut = list.filter(file => !isSvg(file)).map(file => file.name);
        if (svgs.length) onUpload(svgs, leftOut);
        else if (leftOut.length) showToast(leftOutMessage(leftOut), 'error', 6000);
    };

    return (
        <section
            className={clsx('surface p-4 sm:p-5', dragging && 'border-ink', className)}
            aria-labelledby="dtf-designs-title"
            onDragOver={event => { if (readOnly || ![...event.dataTransfer.types].includes('Files')) return; event.preventDefault(); setDragging(true); }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
            onDrop={event => {
                if (readOnly) return;
                event.preventDefault();
                setDragging(false);
                take([...event.dataTransfer.files]);
            }}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="dtf-designs-title" tabIndex={-1} className="section-title scroll-mt-4 outline-none">Designs</h2>
                    <p className="mt-1 text-sm text-ink-2">
                        {designs.length
                            ? <><span className="num">{designs.length}</span> saved. Add them to the sheet, as many times as you need.</>
                            : 'Upload your SVG designs once, then pick them for each sheet.'}
                    </p>
                </div>
                {designs.length > 0 && (
                    <button type="button" onClick={() => picker.current?.click()} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined}
                        className="btn-secondary w-full sm:w-auto">
                        <Upload size={18} aria-hidden="true" /> Upload SVGs
                    </button>
                )}
                <input ref={picker} type="file" accept=".svg,image/svg+xml" multiple hidden
                    onChange={event => { const list = [...event.target.files]; event.target.value = ''; take(list); }} />
            </div>

            {designs.length > 6 && (
                <div className="relative mt-4">
                    <label htmlFor="dtf-design-search" className="sr-only">Find a design</label>
                    <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
                    <input id="dtf-design-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
                        placeholder="Find a design" autoComplete="off" className="field pl-11" />
                </div>
            )}

            {designs.length === 0 ? (
                <div className={clsx('mt-4 flex flex-col items-center gap-4 rounded-xl border border-dashed px-5 py-10 text-center',
                    dragging ? 'border-ink bg-white/5' : 'border-slate-600')}>
                    <Upload size={28} className="text-ink-3" aria-hidden="true" />
                    <div className="max-w-sm">
                        <p className="font-semibold text-ink">No designs yet</p>
                        <p className="mt-1 text-sm text-ink-2">
                            Drop SVG files here or choose them. Convert text to outlines first, so it prints in the right font.
                        </p>
                    </div>
                    <button type="button" onClick={() => picker.current?.click()} disabled={readOnly} title={readOnly ? READ_ONLY_HINT : undefined} className="btn-primary">
                        <Upload size={18} aria-hidden="true" /> Upload SVGs
                    </button>
                </div>
            ) : shown.length === 0 ? (
                <p className="mt-4 text-sm text-ink-2">No design is named like &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {shown.map(design => (
                        <DesignTile key={design.id} design={design} file={files.get(design.id)} count={counts.get(design.id) || 0}
                            onAdd={onAdd} onEdit={onEdit} onRetry={onRetry} readOnly={readOnly} />
                    ))}
                </ul>
            )}
        </section>
    );
}
