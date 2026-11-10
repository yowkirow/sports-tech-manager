import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import clsx from 'clsx';

/** 3.5 → "3.5", 2.125 → "2.13", 10 → "10". */
export const inches = value => String(Math.round(value * 100) / 100);
export const printSize = (widthIn, heightIn) => `${inches(widthIn)} × ${inches(heightIn)}\u00a0in`;
/** Print height for a width, following the design's shape (its saved width and height). */
export const heightOf = (widthIn, design) => Math.round(((widthIn * design.heightIn) / design.widthIn) * 1000) / 1000;

const parse = text => {
    const value = Number(String(text).trim().replace(',', '.'));
    return String(text).trim() === '' ? NaN : value;
};

/**
 * A number typed in inches (or any unit). Every valid value is used as it is typed; a half-typed one
 * ("3.") waits, and leaving the field puts back the last valid value.
 */
export function NumberField({ label, value, onChange, min, max, step = 0.1, unit = 'in', integer = false, className, labelClassName, inputClassName, disabled, describedBy }) {
    const id = useId();
    const [text, setText] = useState(String(value));
    useEffect(() => {
        setText(current => (parse(current) === value ? current : String(value)));
    }, [value]);
    const valid = number => Number.isFinite(number) && number >= min && number <= max && (!integer || Number.isInteger(number));
    return (
        <div className={className}>
            <label htmlFor={id} className={clsx('field-label', labelClassName)}>{label}</label>
            <div className="relative">
                <input
                    id={id}
                    type="text"
                    inputMode={integer ? 'numeric' : 'decimal'}
                    autoComplete="off"
                    value={text}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    aria-invalid={!valid(parse(text)) || undefined}
                    onChange={event => {
                        setText(event.target.value);
                        const number = parse(event.target.value);
                        if (valid(number)) onChange(number);
                    }}
                    onBlur={() => { if (!valid(parse(text))) setText(String(value)); }}
                    onKeyDown={event => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                        event.preventDefault();
                        const next = Math.round(((parse(text) || value) + (event.key === 'ArrowUp' ? step : -step)) * 1000) / 1000;
                        const clamped = Math.min(max, Math.max(min, next));
                        setText(String(clamped));
                        onChange(clamped);
                    }}
                    className={clsx('field num aria-invalid:border-red-500/60', unit && 'pr-10', inputClassName)}
                />
                {unit && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">{unit}</span>}
            </div>
        </div>
    );
}

/** − count + with 44px targets, for copies of a design. */
export function QuantityStepper({ label, value, onChange, max = 999, disabled, className, labelClassName }) {
    const id = useId();
    const [text, setText] = useState(String(value));
    useEffect(() => { setText(String(value)); }, [value]);
    const set = next => onChange(Math.min(max, Math.max(1, next)));
    return (
        <div className={className}>
            <label htmlFor={id} className={clsx('field-label', labelClassName)}>{label}</label>
            <div className="flex w-fit items-center rounded-full border border-line bg-field">
                <button type="button" className="icon-btn" onClick={() => set(value - 1)} disabled={disabled || value <= 1} aria-label="One fewer">
                    <Minus size={18} aria-hidden="true" />
                </button>
                <input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={text}
                    disabled={disabled}
                    onChange={event => {
                        setText(event.target.value);
                        const number = Number(event.target.value);
                        if (Number.isInteger(number) && number >= 1 && number <= max) onChange(number);
                    }}
                    onBlur={() => setText(String(value))}
                    className="num h-11 w-12 bg-transparent text-center text-base font-semibold text-ink outline-none"
                />
                <button type="button" className="icon-btn" onClick={() => set(value + 1)} disabled={disabled || value >= max} aria-label="One more">
                    <Plus size={18} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
