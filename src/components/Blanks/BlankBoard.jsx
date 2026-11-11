import { useId } from 'react';
import clsx from 'clsx';
import { BLANK_SIZES, blankTotals, countedWhen, rowTotal } from '../../lib/blankCounts';

/** The color's catalog swatch; a dashed ring when the catalog has none. */
export function Swatch({ hex }) {
    return (
        <span aria-hidden="true" style={hex ? { backgroundColor: hex } : undefined}
            className={clsx('mt-[3px] size-3 shrink-0 rounded-full border', hex ? 'border-white/30' : 'border-dashed border-ink-3')} />
    );
}

/**
 * Blank shirts by color and size, as the owner last counted them (src/lib/blankCounts.js). The owner and
 * the print staff see the same board; only the owner's has an action.
 */
export default function BlankBoard({ count, title, headingLevel = 2, action = null }) {
    const titleId = useId();
    const Heading = `h${headingLevel}`;
    const totals = blankTotals(count.rows);
    // Column widths follow the board's own width (a container query): the print queue's column is narrower
    // than the owner's screen at the same window size.
    const cell = 'num px-1 text-right @lg:px-3';
    const colorCell = 'pl-3 pr-1 text-left @lg:px-5';
    const totalCell = 'num pl-1 pr-3 text-right @lg:pr-5';
    return (
        <section className="surface @container overflow-hidden" aria-labelledby={titleId}>
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                    <Heading id={titleId} className="section-title">{title}</Heading>
                    <p className="mt-1 text-sm text-ink-2">
                        <span className="num font-semibold text-ink">{totals.total.toLocaleString('en-PH')}</span>
                        {` ${totals.total === 1 ? 'shirt' : 'shirts'} · updated ${countedWhen(count.countedAt)}`}
                    </p>
                </div>
                {action}
            </div>
            {count.note && (
                // A div, not a p: the print queue's stylesheet caps paragraphs at 72ch, which would cut this rule short.
                <div className="border-b border-line px-4 py-3 text-sm text-ink-2 sm:px-5">
                    <span className="font-semibold text-ink">Note:</span> {count.note}
                </div>
            )}
            <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">Blank shirts by color and size</caption>
                <colgroup>
                    <col />
                    {BLANK_SIZES.map(size => <col key={size} className="w-8 @lg:w-16" />)}
                    <col className="w-12 @lg:w-20" />
                </colgroup>
                <thead>
                    <tr className="border-b border-line text-xs text-ink-2">
                        <th scope="col" className={clsx(colorCell, 'py-2.5 font-medium')}>Color</th>
                        {BLANK_SIZES.map(size => <th key={size} scope="col" className="px-1 py-2.5 text-right font-medium @lg:px-3">{size}</th>)}
                        <th scope="col" className="py-2.5 pl-1 pr-3 text-right font-medium @lg:pr-5">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {count.rows.map(row => (
                        <tr key={row.color} className="border-b border-line">
                            <th scope="row" className={clsx(colorCell, 'py-2.5 font-medium text-ink')}>
                                <span className="flex items-start gap-2"><Swatch hex={row.hex} /><span className="min-w-0">{row.color}</span></span>
                            </th>
                            {BLANK_SIZES.map(size => (
                                <td key={size} className={clsx(cell, 'py-2.5', row.sizes[size] ? 'text-ink' : 'text-ink-3')}>{row.sizes[size]}</td>
                            ))}
                            <td className={clsx(totalCell, 'py-2.5 font-semibold text-ink')}>{rowTotal(row)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="bg-raised font-semibold text-ink">
                        <th scope="row" className={clsx(colorCell, 'py-3')}>All colors</th>
                        {BLANK_SIZES.map(size => <td key={size} className={clsx(cell, 'py-3')}>{totals.sizes[size]}</td>)}
                        <td className={clsx(totalCell, 'py-3')}>{totals.total}</td>
                    </tr>
                </tfoot>
            </table>
        </section>
    );
}
