import React from 'react';

const VARIANTS = { primary: 'btn-primary', secondary: 'btn-secondary', light: 'btn-light', ghost: 'btn-ghost', danger: 'btn-danger' };

const Button = ({ children, variant = 'primary', onClick, type = 'button', className = '', ...props }) => (
    <button type={type} className={`${VARIANTS[variant] || VARIANTS.primary} ${className}`} onClick={onClick} {...props}>
        {children}
    </button>
);

export default Button;
