import React from 'react';

const Select = ({ label, id, options, ...props }) => {
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
            <select
                id={id}
                className="glass-input"
                style={{ appearance: 'none', cursor: 'pointer' }}
                {...props}
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value} style={{ color: 'black' }}>
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default Select;
