import React, { createContext, useContext, useState, useEffect } from 'react';
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

    const showToast = (message, type = 'success', duration = 3000) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);

        if (duration) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div style={{
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
            }}>
                {toasts.map(toast => (
                    <div
                        key={toast.id}
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
                            minWidth: '300px',
                            color: '#fff',
                        }}
                    >
                        {toast.type === 'success' && <CheckCircle size={20} color="var(--success)" />}
                        {toast.type === 'error' && <AlertCircle size={20} color="var(--danger)" />}
                        {toast.type === 'info' && <Info size={20} color="var(--primary)" />}
                        
                        <span style={{ flex: 1, fontSize: '0.9rem' }}>{toast.message}</span>
                        
                        <button 
                            onClick={() => removeToast(toast.id)}
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
