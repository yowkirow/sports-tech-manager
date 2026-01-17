import React from 'react';

const Button = ({ children, variant = 'primary', onClick, type = 'button', className = '', ...props }) => {
    return (
        <button
            type={type}
            className={`glass-btn ${variant === 'secondary' ? 'secondary' : ''} ${className}`}
            onClick={onClick}
            {...props}
        >
            {children}
        </button>
    );
};

export default Button;
