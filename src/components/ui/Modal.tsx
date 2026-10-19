'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  compact?: boolean;
}

export function Modal({ open, onClose, title, children, maxWidth = '480px', compact = false }: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, handleEscape]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        className={`relative bg-bg-surface border border-border shadow-2xl animate-fade-in w-full my-auto overflow-hidden ${
          compact ? 'rounded-[var(--radius-lg)]' : 'rounded-[var(--radius-xl)]'
        }`}
        style={{ maxWidth }}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between border-b border-border ${
            compact ? 'px-4 py-2.5 sm:px-5 sm:py-3' : 'px-5 py-3.5'
          }`}
        >
          <h2 className={`font-semibold text-text-primary ${compact ? 'text-sm sm:text-base' : 'text-base sm:text-lg'}`}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className={`flex items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:text-text-primary hover:bg-bg-surface-hover transition-colors cursor-pointer ${
              compact ? 'w-6 h-6' : 'w-7 h-7'
            }`}
          >
            <svg
              width={compact ? 14 : 16}
              height={compact ? 14 : 16}
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4.5 4.5L13.5 13.5M4.5 13.5L13.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div
          className={`overflow-y-auto ${
            compact ? 'px-4 py-3 sm:px-5 sm:py-3.5 max-h-[82vh]' : 'px-5 py-4 max-h-[78vh]'
          }`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

