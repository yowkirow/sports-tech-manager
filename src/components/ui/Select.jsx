import React from 'react';

const Select = ({ label, id, options, ...props }) => (
    <div className="mb-4">
        {label && <label htmlFor={id} className="field-label">{label}</label>}
        <select id={id} className="field" {...props}>
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
    </div>
);

export default Select;
