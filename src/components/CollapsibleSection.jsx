import React, { useState } from 'react';

export default function CollapsibleSection({ title, icon, count, defaultOpen = false, color = '#ffd700', children, badge }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      backgroundColor: '#2a2a4e',
      border: `1px solid ${color}44`,
      borderRadius: '8px',
      marginBottom: '6px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 14px',
          backgroundColor: open ? '#2a2a5e' : '#2a2a4e',
          border: 'none',
          borderBottom: open ? `1px solid ${color}33` : 'none',
          color,
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 'bold',
          textAlign: 'left',
          transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {count != null && (
          <span style={{
            fontSize: '11px',
            backgroundColor: `${color}22`,
            color,
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 'normal',
          }}>
            {count}
          </span>
        )}
        {badge && (
          <span style={{
            fontSize: '10px',
            backgroundColor: '#ff6b6b33',
            color: '#ff6b6b',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 'bold',
          }}>
            {badge}
          </span>
        )}
        <span style={{
          fontSize: '12px',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          opacity: 0.6,
        }}>
          ▼
        </span>
      </button>
      {open && (
        <div style={{ padding: '10px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
