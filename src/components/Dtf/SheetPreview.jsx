import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ChevronLeft, ChevronRight, Square, SquareCheck } from 'lucide-react';
import clsx from 'clsx';
import { INCHES_PER_METER } from '../../lib/dtfLayout.js';
import { PRINT_DPI } from '../../lib/dtfExport.js';
import { inches, printSize } from './fields';

const RULER = 28;
const ZOOMS = [{ value: 1, label: 'Fit' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }];
const LABEL_SPACING = 30;

function useWide() {
    const query = '(min-width: 1024px)';
    const [wide, setWide] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const list = window.matchMedia(query);
        const update = () => setWide(list.matches);
        list.addEventListener('change', update);
        return () => list.removeEventListener('change', update);
    }, []);
    return wide;
}

function useSize(ref) {
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return size;
}

/** Inch marks along one side: a tick every inch (and half inch when there's room), a number every few. */
function Ruler({ length, scale, vertical }) {
    const every = [1, 2, 5, 10].find(step => step * scale >= LABEL_SPACING) ?? 10;
    const halves = scale >= 16;
    const marks = [];
    for (let at = 0; at <= length + 1e-9; at += halves ? 0.5 : 1) {
        const whole = Math.abs(at - Math.round(at)) < 1e-9;
        const position = Math.round(at * scale) + 0.5;
        const size = !whole ? 5 : Math.round(at) % every === 0 ? 12 : 8;
        marks.push(vertical
            ? <line key={at} x1={RULER - size} x2={RULER} y1={position} y2={position} />
            : <line key={at} y1={RULER - size} y2={RULER} x1={position} x2={position} />);
        // The corner says "in" and stands for zero on the side ruler.
        if (whole && Math.round(at) % every === 0 && at < length - 0.5 && (!vertical || at > 0)) {
            marks.push(vertical
                ? <text key={`n${at}`} x={RULER - 14} y={position + 4} textAnchor="end">{Math.round(at)}</text>
                : <text key={`n${at}`} x={position + 3} y={13}>{Math.round(at)}</text>);
        }
    }
    const extent = Math.ceil(length * scale) + 1;
    return (
        <svg width={vertical ? RULER : extent} height={vertical ? extent : RULER} aria-hidden="true"
            className="block fill-ink-2 stroke-ink-3 text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {marks}
        </svg>
    );
}

/**
 * The sheet as it will print, to scale, with inch rulers and cut guides, and the download. Cut guides and
 * rulers stay on screen; the PNG holds only the designs.
 */
export default function SheetPreview({ className, layout, files, designsById, exporting, onExport, onCancelExport }) {
    const [chosen, setChosen] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [showCuts, setShowCuts] = useState(true);
    const [selected, setSelected] = useState(null);
    const frame = useRef(null);
    const room = useSize(frame);
    const wide = useWide();

    const { sheets, settings } = layout;
    const index = Math.min(chosen, Math.max(0, sheets.length - 1));
    const sheet = sheets[index] ?? null;
    useEffect(() => { setSelected(null); }, [index, layout]);

    // On a computer the sheet fills the space the panel leaves it; on a phone it takes the column's width.
    const fit = Math.max(4, Math.min((room.width - RULER - 2) / settings.widthIn,
        wide ? (room.height - RULER - 2) / settings.lengthIn : Infinity));
    const scale = room.width ? fit * zoom : 0;
    const width = settings.widthIn * scale;
    const height = settings.lengthIn * scale;

    const ready = sheet ? sheet.placements.every(item => files.get(item.designId)?.status === 'ready') : false;
    const meters = Math.round(layout.meters * 100) / 100;
    const pixels = `${Math.round(settings.widthIn * PRINT_DPI)} × ${Math.round(settings.lengthIn * PRINT_DPI)} px`;
    const picked = selected !== null ? sheet?.placements[selected] : null;
    const pickedName = picked ? designsById.get(picked.designId)?.name : '';
    const label = useMemo(() => {
        if (!sheet) return `Empty sheet, ${inches(settings.widthIn)} by ${inches(settings.lengthIn)} inches`;
        return `Sheet ${index + 1} of ${sheets.length}, ${inches(settings.widthIn)} by ${inches(settings.lengthIn)} inches, ${sheet.placements.length} prints in ${sheet.rows.length} rows`;
    }, [sheet, index, sheets.length, settings]);

    return (
        <section className={clsx('surface p-4 sm:p-5 lg:flex lg:h-[calc(100dvh-4rem-env(safe-area-inset-top)-3rem)] lg:flex-col', className)}
            aria-labelledby="dtf-preview-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="dtf-preview-title" className="section-title">Preview</h2>
                    {sheets.length ? (
                        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2" aria-live="polite">
                            <span className="num font-display text-3xl font-extrabold leading-none text-ink">{meters}&nbsp;m</span>
                            <span className="text-sm text-ink-2">of film · <span className="num">{sheets.length}</span> {sheets.length === 1 ? 'sheet' : 'sheets'}</span>
                        </p>
                    ) : (
                        <p className="mt-1 text-sm text-ink-2" aria-live="polite">Nothing on the sheet yet.</p>
                    )}
                </div>
                {sheet && (
                    sheets.length > 1 ? (
                        <button type="button" disabled={!ready || Boolean(exporting)} onClick={() => onExport(sheets.map((_, position) => position))} className="btn-primary">
                            <Download size={18} aria-hidden="true" />
                            <span>Download all <span className="num">{sheets.length}</span> sheets</span>
                        </button>
                    ) : (
                        <button type="button" disabled={!ready || Boolean(exporting)} onClick={() => onExport([index])} className="btn-primary">
                            <Download size={18} aria-hidden="true" />
                            <span>Download PNG</span>
                        </button>
                    )
                )}
            </div>

            {exporting && (
                <div className="mt-4 rounded-lg border border-line bg-raised p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink">Making sheet <span className="num">{exporting.index + 1}</span>{exporting.count > 1 && <> (<span className="num">{exporting.position + 1}</span> of <span className="num">{exporting.count}</span>)</>}…</span>
                        <span className="num text-ink-2">{Math.round(exporting.progress * 100)}%</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <div role="progressbar" aria-label="Making the print file" aria-valuemin={0} aria-valuemax={100}
                            aria-valuenow={Math.round(exporting.progress * 100)} className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
                            <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${exporting.progress * 100}%` }} />
                        </div>
                        <button type="button" onClick={onCancelExport} className="btn-secondary min-h-11 px-4">Stop</button>
                    </div>
                </div>
            )}

            {sheets.length > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div role="group" aria-label="Sheets" className="flex items-center">
                        <button type="button" onClick={() => setChosen(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous sheet" className="icon-btn">
                            <ChevronLeft size={20} aria-hidden="true" />
                        </button>
                        <p className="num min-w-28 text-center text-sm font-semibold text-ink" aria-live="polite">Sheet {index + 1} of {sheets.length}</p>
                        <button type="button" onClick={() => setChosen(Math.min(sheets.length - 1, index + 1))} disabled={index === sheets.length - 1}
                            aria-label="Next sheet" className="icon-btn">
                            <ChevronRight size={20} aria-hidden="true" />
                        </button>
                    </div>
                    <button type="button" disabled={!ready || Boolean(exporting)} onClick={() => onExport([index])} className="btn-secondary">
                        <span>Download sheet <span className="num">{index + 1}</span></span>
                    </button>
                </div>
            )}

            {(sheet || wide) && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div role="group" aria-label="Zoom" className="flex gap-1.5">
                        {ZOOMS.map(option => (
                            <button key={option.value} type="button" className="chip h-11 px-3.5" aria-pressed={zoom === option.value}
                                onClick={() => setZoom(option.value)}>{option.label}</button>
                        ))}
                    </div>
                    {sheet && (
                        <button type="button" onClick={() => setShowCuts(value => !value)} aria-pressed={showCuts} className="btn-ghost -mr-3 px-3">
                            {showCuts ? <SquareCheck size={18} aria-hidden="true" /> : <Square size={18} aria-hidden="true" />}
                            <span>Cut guides</span>
                        </button>
                    )}
                </div>
            )}

            <div ref={frame} className="mt-3 lg:min-h-0 lg:flex-1">
                {!sheet && !wide ? (
                    // A phone keeps the empty sheet short, so the gallery below is a short scroll away.
                    <div className="dtf-film flex h-32 items-center justify-center rounded-lg px-4">
                        <p className="rounded-full bg-raised px-4 py-2 text-center text-sm font-semibold text-ink">Designs you add show here, to scale.</p>
                    </div>
                ) : scale > 0 && (
                    <div className="mx-auto w-fit max-w-full overflow-auto rounded-lg border border-line bg-raised"
                        style={{ maxHeight: wide ? room.height : zoom > 1 ? '70dvh' : undefined }}>
                        <div className="grid" style={{ gridTemplateColumns: `${RULER}px ${width}px`, gridTemplateRows: `${RULER}px ${height}px` }}>
                            <div className="sticky left-0 top-0 z-20 flex items-center justify-center bg-raised text-xs text-ink-3" aria-hidden="true">in</div>
                            <div className="sticky top-0 z-10 bg-raised"><Ruler length={settings.widthIn} scale={scale} /></div>
                            <div className="sticky left-0 z-10 bg-raised"><Ruler length={settings.lengthIn} scale={scale} vertical /></div>
                            <div role="group" aria-label={label} className="dtf-film relative overflow-hidden">
                                {sheet?.placements.map((item, position) => {
                                    const name = designsById.get(item.designId)?.name ?? 'Design';
                                    const file = files.get(item.designId);
                                    return (
                                        <button
                                            key={`${item.key}-${item.copy}`}
                                            type="button"
                                            onClick={() => setSelected(position)}
                                            title={`${name} · ${printSize(item.widthIn, item.heightIn)}`}
                                            aria-label={`${name}, ${inches(item.widthIn)} by ${inches(item.heightIn)} inches`}
                                            className={clsx('absolute block', selected === position && 'outline-2 outline-offset-1 outline-ground')}
                                            style={{ left: item.x * scale, top: item.y * scale, width: item.widthIn * scale, height: item.heightIn * scale }}
                                        >
                                            {file?.status === 'ready'
                                                ? <img src={file.url} alt="" draggable={false} className="pointer-events-none size-full object-contain" />
                                                : <span className="block size-full animate-pulse rounded-sm bg-ground/25" />}
                                        </button>
                                    );
                                })}
                                {sheet && showCuts && (
                                    <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden="true">
                                        {sheet.cuts.map((cut, position) => (
                                            <line key={position} x1={cut.x1 * scale} y1={cut.y1 * scale} x2={cut.x2 * scale} y2={cut.y2 * scale}
                                                stroke="var(--color-ground)" strokeOpacity="0.8" strokeWidth="1" strokeDasharray="6 4" />
                                        ))}
                                    </svg>
                                )}
                                {!sheet && (
                                    <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center">
                                        <span className="inline-block rounded-full bg-raised px-4 py-2 text-sm font-semibold text-ink">Designs you add show here, to scale.</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-3 space-y-1 text-sm">
                <p className="min-h-5 text-ink-2" aria-live="polite">
                    {picked
                        ? <><span className="font-semibold text-ink">{pickedName}</span> <span className="num">· {printSize(picked.widthIn, picked.heightIn)} · {inches(picked.x)}&nbsp;in from the left, {inches(picked.y)}&nbsp;in from the top</span></>
                        : sheet ? 'Select a print to check its size and place.' : null}
                </p>
                {sheet && (
                    <p className="num text-ink-2">
                        <span className="text-ink">{sheet.placements.length}</span> {sheet.placements.length === 1 ? 'print' : 'prints'}
                        {' · '}smallest gap <span className="text-ink">{sheet.smallestGapIn === null ? 'none' : `${inches(sheet.smallestGapIn)}\u00a0in`}</span>
                        {' · '}<span className="text-ink">{Math.max(1, Math.round(sheet.usedPercent))}%</span> of the film printed
                    </p>
                )}
                <p className="text-xs text-ink-3">
                    {sheet && !ready ? 'Loading the designs on this sheet… ' : ''}
                    PNG at {PRINT_DPI} DPI, clear background, <span className="num">{inches(settings.widthIn)} × {inches(settings.lengthIn)} in ({pixels})</span>, one file per sheet. Cut guides aren&apos;t printed.
                    {settings.lengthIn !== INCHES_PER_METER && <> Each sheet is <span className="num">{inches(settings.lengthIn / INCHES_PER_METER)}</span> m.</>}
                </p>
            </div>
        </section>
    );
}
