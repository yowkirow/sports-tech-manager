import React from 'react';

const Input = ({ label, id, ...props }) => {
    return (
        <div style={{ marginBottom: '1rem' }}>
            {label && (
                <label
                    htmlFor={id}
                    style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}
                >
                    {label}
                </label>
            )}
            <input
                id={id}
                className="glass-input"
                {...props}
            />
        </div>
    );
};

export default Input;
