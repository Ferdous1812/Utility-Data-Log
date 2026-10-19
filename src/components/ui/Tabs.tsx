'use client';

import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className = '' }: TabsProps) {
  return (
    <div className={`flex border-b border-border overflow-x-auto scrollbar-none gap-1 sm:gap-2 ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`py-2.5 px-4 font-semibold text-sm transition-all border-b-2 -mb-px whitespace-nowrap flex items-center gap-2 cursor-pointer ${
              isActive
                ? 'border-accent text-accent font-bold bg-accent/5 rounded-t-[var(--radius-md)]'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-light'
            }`}
          >
            {tab.icon && <span className="text-base">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && (
              <span
                className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-semibold tabular-nums ${
                  isActive
                    ? 'bg-accent/20 text-accent'
                    : 'bg-bg-elevated text-text-muted border border-border'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
