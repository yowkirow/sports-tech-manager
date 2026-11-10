import { ChevronDown, RotateCcw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { SHEET_DEFAULTS } from '../../lib/dtfLayout.js';
import { NumberField, QuantityStepper, SizeFields, inches, printSize } from './fields';

// The layout follows the panel's own width (@xl is a container query: the panel at least 36rem wide, as on a
// large computer screen or a tablet). There, each pick is one row under a shared header; in a narrower panel its
// fields stack under its name. The header and the rows are separate grids, so every track but the name's is
// fixed (8.75rem holds the copies stepper) and the headings stay over their fields.
const COLUMNS = '@xl:grid @xl:grid-cols-[3rem_minmax(0,1fr)_5rem_5rem_8.75rem_2.75rem] @xl:items-center @xl:gap-x-3';
const unit = value => `${inches(value)}\u00a0in`;

function PickRow({ pick, file, problem, settings, onChange, onRemove }) {
    const usableWidth = settings.widthIn - 2 * settings.marginIn;
    const usableLength = settings.lengthIn - 2 * settings.marginIn;
    const problemId = `dtf-pick-problem-${pick.key}`;
    const remove = (
        <button type="button" onClick={() => onRemove(pick.key)} aria-label={`Take ${pick.name} off the sheet`} className="icon-btn hover:text-red-300">
            <Trash2 size={18} aria-hidden="true" />
        </button>
    );
    return (
        <li className="p-4 sm:px-5 @xl:px-5 @xl:py-2.5">
            <div className={clsx('flex gap-3 sm:gap-4', COLUMNS)}>
                <div className="dtf-film relative size-16 shrink-0 overflow-hidden rounded-lg @xl:size-12">
                    {file?.status === 'ready' && <img src={file.url} alt="" draggable={false} className="absolute inset-0 size-full object-contain p-1.5" />}
                </div>
                <div className="min-w-0 flex-1 @xl:contents">
                    <div className="flex items-start justify-between gap-2 @xl:block @xl:min-w-0">
                        <div className="min-w-0">
                            <p className="truncate font-semibold text-ink @xl:line-clamp-2 @xl:whitespace-normal @xl:break-words" title={pick.name}>{pick.name}</p>
                            <p className="num mt-0.5 text-sm text-ink-2 @xl:hidden">
                                {printSize(pick.widthIn, pick.heightIn)} · {pick.quantity} {pick.quantity === 1 ? 'copy' : 'copies'}
                            </p>
                        </div>
                        <div className="-mr-2 -mt-2 @xl:hidden">{remove}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-3 sm:gap-x-4 @xl:contents">
                        <SizeFields widthIn={pick.widthIn} ratio={pick.ratio} onChange={widthIn => onChange(pick.key, { widthIn })}
                            fieldClassName="w-24 @xl:w-full" labelClassName="@xl:sr-only" inputClassName="@xl:pr-3.5" unitClassName="@xl:hidden"
                            describedBy={problem ? problemId : undefined} />
                        <QuantityStepper label="Copies" value={pick.quantity} labelClassName="@xl:sr-only" onChange={quantity => onChange(pick.key, { quantity })} />
                    </div>
                    <div className="hidden @xl:block">{remove}</div>
                </div>
            </div>
            {problem && (
                <p id={problemId} role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 @xl:ml-15">
                    {problem.reason === 'width'
                        ? <>Too wide for the sheet. The most that fits across is <span className="num">{unit(usableWidth)}</span>.</>
                        : <>Too tall for the sheet. The most that fits is <span className="num">{unit(usableLength)}</span>.</>}
                </p>
            )}
        </li>
    );
}

function SheetSettings({ settings, onChange }) {
    const isDefault = Object.entries(SHEET_DEFAULTS).every(([key, value]) => settings[key] === value);
    const set = key => value => onChange({ ...settings, [key]: value });
    return (
        <details className="group border-t border-line">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                    <span className="font-semibold text-ink">Sheet settings</span>
                    <span className="num ml-2 text-ink-2">
                        {inches(settings.widthIn)}&nbsp;×&nbsp;{unit(settings.lengthIn)} · {unit(settings.marginIn)}&nbsp;margin · {unit(settings.gapIn)}&nbsp;gap
                    </span>
                </span>
                <ChevronDown size={18} className="shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 px-4 pb-5 sm:px-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 @xl:grid-cols-4">
                    <NumberField label="Sheet width" value={settings.widthIn} min={2} max={120} step={0.5} onChange={set('widthIn')} />
                    <NumberField label="Sheet length" value={settings.lengthIn} min={2} max={400} step={0.5} onChange={set('lengthIn')} />
                    <NumberField label="Edge margin" value={settings.marginIn} min={0} max={Math.min(settings.widthIn, settings.lengthIn) / 4} step={0.05} onChange={set('marginIn')} />
                    <NumberField label="Smallest gap" value={settings.gapIn} min={0} max={6} step={0.05} onChange={set('gapIn')} />
                </div>
                <p className="text-sm text-ink-2">
                    The supplier&apos;s 1-meter sheet is 22&nbsp;×&nbsp;39&nbsp;in. Designs never come closer to each other than the smallest gap; any film to spare is shared out evenly.
                </p>
                {!isDefault && (
                    <button type="button" onClick={() => onChange({ ...SHEET_DEFAULTS })} className="btn-ghost -ml-3">
                        <RotateCcw size={16} aria-hidden="true" /> <span>Back to 22&nbsp;×&nbsp;39&nbsp;in</span>
                    </button>
                )}
            </div>
        </details>
    );
}

/** What goes on the sheet: each picked design with its print size and copies, plus the sheet's settings. */
export default function SheetPicks({ className, picks, files, layout, settings, onSettings, onChange, onRemove, onClear, onFindDesigns }) {
    const problems = new Map(layout.tooBig.map(item => [item.key, item]));
    const copies = picks.reduce((sum, pick) => sum + pick.quantity, 0);
    const sheets = layout.sheets.length;
    return (
        <section className={clsx('surface @container', className)} aria-labelledby="dtf-sheet-title">
            <div className="flex items-start justify-between gap-3 p-4 sm:px-5">
                <div className="min-w-0">
                    <h2 id="dtf-sheet-title" className="section-title">On the sheet</h2>
                    <p className="mt-1 text-sm text-ink-2" aria-live="polite">
                        {picks.length
                            ? <><span className="num">{copies}</span> {copies === 1 ? 'print' : 'prints'} of <span className="num">{picks.length}</span> {picks.length === 1 ? 'design' : 'designs'}
                                {sheets > 0 && <>, on <span className="num">{sheets}</span> {sheets === 1 ? 'sheet' : 'sheets'}</>}.</>
                            : <>Nothing yet.{' '}
                                <button type="button" onClick={onFindDesigns} className="-my-3 inline-flex min-h-11 items-center font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
                                    Add designs from your gallery
                                </button></>}
                    </p>
                </div>
                {picks.length > 0 && (
                    <button type="button" onClick={onClear} className="btn-ghost -mr-2 shrink-0">Clear</button>
                )}
            </div>
            {picks.length > 0 && (
                <>
                    <div aria-hidden="true" className={clsx('hidden border-t border-line px-5 py-2 text-xs font-medium text-ink-2', COLUMNS)}>
                        <span className="col-span-2">Design</span>
                        <span>Width (in)</span>
                        <span>Height (in)</span>
                        <span>Copies</span>
                        <span />
                    </div>
                    <ul className="divide-y divide-line border-t border-line">
                        {picks.map(pick => (
                            <PickRow key={pick.key} pick={pick} file={files.get(pick.designId)} problem={problems.get(pick.key)}
                                settings={layout.settings} onChange={onChange} onRemove={onRemove} />
                        ))}
                    </ul>
                </>
            )}
            <SheetSettings settings={settings} onChange={onSettings} />
        </section>
    );
}
