import React, { createContext, useCallback, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext();

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const timers = useRef(new Map());

    const showToast = useCallback((message, type = 'success', duration = 3000) => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, message, type }]);

        if (duration) {
            const timer = setTimeout(() => {
                timers.current.delete(id);
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
            timers.current.set(id, timer);
        }
    }, []);

    const removeToast = (id) => {
        clearTimeout(timers.current.get(id));
        timers.current.delete(id);
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    useEffect(() => {
        const activeTimers = timers.current;
        return () => {
            activeTimers.forEach(clearTimeout);
            activeTimers.clear();
        };
    }, []);

    const contextValue = useMemo(() => ({ showToast }), [showToast]);

    return (
        <ToastContext.Provider value={contextValue}>
            {children}
            <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[9999] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[min(380px,calc(100vw-48px))] sm:items-stretch lg:bottom-6">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        role={toast.type === 'error' ? 'alert' : 'status'}
                        className="pointer-events-auto flex w-full max-w-[420px] animate-slide-up items-start gap-3 rounded-xl border border-line bg-raised py-3 pr-2 pl-4 text-[15px] text-ink shadow-lift"
                        style={{ overflowWrap: 'anywhere' }}
                    >
                        <span className="mt-0.5 shrink-0">
                            {toast.type === 'success' && <CheckCircle size={20} className="text-emerald-400" aria-hidden="true" />}
                            {toast.type === 'error' && <AlertCircle size={20} className="text-red-400" aria-hidden="true" />}
                            {toast.type === 'info' && <Info size={20} className="text-ink-2" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 pt-0.5 leading-snug">{toast.message}</span>
                        <button
                            type="button"
                            onClick={() => removeToast(toast.id)}
                            aria-label="Dismiss notification"
                            className="-my-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-white/8 hover:text-ink"
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};
