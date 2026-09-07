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
            <div style={{
                position: 'fixed',
                bottom: '20px',
                right: '16px',
                width: 'min(360px, calc(100vw - 32px))',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            }}>
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        role={toast.type === 'error' ? 'alert' : 'status'}
                        className="animate-slide-up"
                        style={{
                            background: 'rgba(23, 23, 23, 0.95)',
                            backdropFilter: 'blur(10px)',
                            border: `1px solid ${
                                toast.type === 'success' ? 'var(--success)' : 
                                toast.type === 'error' ? 'var(--danger)' : 
                                'var(--primary)'
                            }`,
                            padding: '12px 16px',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            overflowWrap: 'anywhere',
                            color: '#fff',
                        }}
                    >
                        {toast.type === 'success' && <CheckCircle size={20} color="var(--success)" />}
                        {toast.type === 'error' && <AlertCircle size={20} color="var(--danger)" />}
                        {toast.type === 'info' && <Info size={20} color="var(--primary)" />}
                        
                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.9rem' }}>{toast.message}</span>
                        
                        <button 
                            onClick={() => removeToast(toast.id)}
                            aria-label="Dismiss notification"
                            style={{ 
                                background: 'transparent', 
                                border: 'none', 
                                color: '#aaa', 
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};
