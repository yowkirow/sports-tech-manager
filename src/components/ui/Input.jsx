import React from 'react';

const Input = ({ label, id, ...props }) => (
    <div className="mb-4">
        {label && <label htmlFor={id} className="field-label">{label}</label>}
        <input id={id} className="field" {...props} />
    </div>
);

export default Input;
