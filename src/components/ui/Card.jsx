import React from 'react';

const Card = ({ children, className = '' }) => {
  return (
    <div className={`glass-panel p-6 ${className}`} style={{ padding: '1.5rem' }}>
      {children}
    </div>
  );
};

export default Card;
