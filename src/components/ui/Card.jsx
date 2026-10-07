import React from 'react';

const Card = ({ children, className = '' }) => (
    <div className={`surface p-6 ${className}`}>
        {children}
    </div>
);

export default Card;
