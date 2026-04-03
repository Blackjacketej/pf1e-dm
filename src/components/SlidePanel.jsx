import React, { useEffect, useState } from 'react';

/**
 * SlidePanel — slides in from the right side of the screen.
 * Used for Combat, Shop, Dice Roller, and Map overlays.
 *
 * Props:
 *  - isOpen: boolean — whether the panel is visible
 *  - onClose: () => void — callback to close the panel
 *  - title: string — panel header text
 *  - width: string — CSS width (default '60%')
 *  - children: ReactNode — panel content
 */
export default function SlidePanel({ isOpen, onClose, title, width = '60%', children }) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      // Trigger animation on next frame
      requestAnimationFrame(() => setAnimating(true));
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: animating ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
          transition: 'background-color 0.3s ease',
          zIndex: 1000,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        backgroundColor: '#1a1a2e',
        borderLeft: '2px solid #ffd700',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
        transform: animating ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #2d1b00, #4a2800)',
          borderBottom: '1px solid #8b6914',
          flexShrink: 0,
        }}>
          <span style={{ color: '#ffd700', fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #8b6914',
              color: '#ffd700',
              cursor: 'pointer',
              fontSize: 20,
              borderRadius: 4,
              padding: '6px 14px',
              lineHeight: 1,
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </>
  );
}
