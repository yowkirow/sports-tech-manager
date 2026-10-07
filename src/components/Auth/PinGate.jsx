import React from 'react';
import { Delete, LogOut } from 'lucide-react';
import { api } from '../../lib/apiClient';
import Logo from '../ui/Logo';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function lockText(lockedUntil) {
    const time = new Date(lockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `Too many incorrect PINs. Try again after ${time}.`;
}

function PinPad({ value, onChange, onSubmit, disabled, label, submitLabel }) {
    const inputRef = React.useRef(null);
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    React.useEffect(() => { if (!coarse) inputRef.current?.focus(); }, [coarse, label]);
    const press = digit => { if (!disabled && value.length < 6) onChange(value + digit); };
    return (
        <form onSubmit={event => { event.preventDefault(); if (value.length >= 4) onSubmit(); }} className="mt-8">
            <label htmlFor="pin-input" className="field-label">{label}</label>
            <input
                id="pin-input" ref={inputRef} type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*"
                maxLength={6} value={value} disabled={disabled}
                onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="field h-14 text-center text-2xl tracking-[0.6em]"
            />
            <div className="mt-5 grid grid-cols-3 gap-2" aria-hidden="true">
                {KEYS.map(key => (
                    <button key={key} type="button" tabIndex={-1} disabled={disabled} onClick={() => press(key)}
                        className="h-14 rounded-xl border border-line bg-surface text-xl font-semibold text-ink transition-colors hover:bg-raised active:bg-raised disabled:opacity-40">
                        {key}
                    </button>
                ))}
                <span />
                <button type="button" tabIndex={-1} disabled={disabled} onClick={() => press('0')}
                    className="h-14 rounded-xl border border-line bg-surface text-xl font-semibold text-ink transition-colors hover:bg-raised active:bg-raised disabled:opacity-40">
                    0
                </button>
                <button type="button" tabIndex={-1} disabled={disabled || !value} onClick={() => onChange(value.slice(0, -1))}
                    className="grid h-14 place-items-center rounded-xl text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
                    <Delete size={22} />
                </button>
            </div>
            <button type="submit" disabled={disabled || value.length < 4} className="btn-primary mt-5 h-12 w-full text-base">
                {submitLabel}
            </button>
        </form>
    );
}

/**
 * Daily PIN on top of the monthly emailed-code sign-in. The server enforces it:
 * private data stays unavailable until this device holds a current PIN unlock.
 */
export default function PinGate({ member, pin, onUnlocked, overlay = false }) {
    const configured = pin?.configured === true;
    const [mode, setMode] = React.useState(configured ? 'unlock' : 'setup');
    const [first, setFirst] = React.useState('');
    const [value, setValue] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState(null);
    const [lockedUntil, setLockedUntil] = React.useState(pin?.lockedUntil || null);
    const creating = mode === 'setup' || mode === 'reset';

    React.useEffect(() => {
        if (!lockedUntil) return undefined;
        const wait = Date.parse(lockedUntil) - Date.now();
        if (wait <= 0) { setLockedUntil(null); return undefined; }
        const timer = window.setTimeout(() => { setLockedUntil(null); setMessage(null); }, wait + 500);
        return () => window.clearTimeout(timer);
    }, [lockedUntil]);

    const restart = nextMode => { setMode(nextMode); setFirst(''); setValue(''); setMessage(null); };

    const submit = async () => {
        if (creating && !first) { setFirst(value); setValue(''); setMessage(null); return; }
        if (creating && value !== first) { setFirst(''); setValue(''); setMessage('Those PINs did not match. Start again.'); return; }
        setBusy(true);
        setMessage(null);
        try {
            if (mode === 'setup') await api.pin.setup(value);
            else if (mode === 'reset') await api.pin.reset(value);
            else await api.pin.unlock(value);
            onUnlocked();
        } catch (error) {
            setValue('');
            if (creating) setFirst('');
            const details = error.details || {};
            if (error.code === 'pin_locked' && details.lockedUntil) { setLockedUntil(details.lockedUntil); setMessage(lockText(details.lockedUntil)); }
            else if (error.code === 'pin_incorrect') {
                setMessage(details.remaining > 0
                    ? `That PIN is incorrect. ${details.remaining} ${details.remaining === 1 ? 'try' : 'tries'} left before a 15-minute lock.`
                    : 'That PIN is incorrect.');
            } else setMessage(error.message);
        } finally {
            setBusy(false);
        }
    };

    const heading = mode === 'unlock' ? 'Enter your PIN' : mode === 'reset' ? 'Set a new PIN' : 'Create your PIN';
    const intro = mode === 'unlock'
        ? 'This device is already signed in with your emailed code. Enter your PIN to open SportsTech.'
        : mode === 'reset'
            ? 'You just signed in with an emailed code, so you can replace your PIN.'
            : 'Choose a 4–6 digit PIN. You will use it to open SportsTech on this and your other devices.';
    const label = creating ? (first ? 'Enter the same PIN again' : 'New PIN (4–6 digits)') : 'PIN';

    return (
        <div className={overlay ? 'fixed inset-0 z-[100] overflow-y-auto bg-ground/95 backdrop-blur-sm' : 'min-h-dvh bg-ground'}
            role={overlay ? 'dialog' : undefined} aria-modal={overlay ? 'true' : undefined} aria-labelledby="pin-heading">
            <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center p-6 text-ink">
                <Logo className="h-10" />
                <h1 id="pin-heading" className="display mt-8 text-4xl">{heading}</h1>
                <p className="mt-3 text-ink-2">{intro}</p>
                {member?.email && <p className="mt-1 truncate text-sm text-ink-3">{member.email}</p>}
                {(message || lockedUntil) && (
                    <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
                        {lockedUntil ? lockText(lockedUntil) : message}
                    </p>
                )}
                <PinPad value={value} onChange={setValue} onSubmit={submit} disabled={busy || Boolean(lockedUntil)}
                    label={label} submitLabel={busy ? 'Checking…' : creating ? (first ? 'Save PIN' : 'Continue') : 'Unlock'} />
                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                    {mode === 'unlock' && (
                        <button type="button" className="btn-ghost -ml-3 text-sm" onClick={() => restart('forgot')}>Forgot PIN?</button>
                    )}
                    {mode === 'reset' && (
                        <button type="button" className="btn-ghost -ml-3 text-sm" onClick={() => restart('unlock')}>Back to PIN</button>
                    )}
                    <button type="button" onClick={api.logout} className="btn-ghost ml-auto text-sm">
                        <LogOut size={16} aria-hidden="true" /> Sign out
                    </button>
                </div>
            </main>
            {mode === 'forgot' && (
                <div className="fixed inset-0 z-[110] grid place-items-center bg-ground/90 p-6" role="dialog" aria-modal="true" aria-labelledby="forgot-heading">
                    <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
                        <h2 id="forgot-heading" className="display text-3xl">Forgot your PIN?</h2>
                        {pin?.resetAvailable ? (
                            <>
                                <p className="mt-3 text-ink-2">You signed in with an emailed code just now, so you can set a new PIN.</p>
                                <button type="button" className="btn-primary mt-6 h-12 w-full" onClick={() => restart('reset')}>Set a new PIN</button>
                            </>
                        ) : (
                            <>
                                <p className="mt-3 text-ink-2">
                                    Sign out, then sign in again with the code we email you. Within 10 minutes of signing in, choose
                                    <span className="font-semibold text-ink"> Forgot PIN? </span> again to set a new one.
                                </p>
                                <button type="button" className="btn-primary mt-6 h-12 w-full" onClick={api.logout}>Sign out and get a code</button>
                            </>
                        )}
                        <button type="button" className="btn-secondary mt-3 h-12 w-full" onClick={() => restart('unlock')}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}
