'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { format, subMonths } from 'date-fns';

export function getDefaultDashboardMonth(): string {
  return format(subMonths(new Date(), 1), 'yyyy-MM');
}

export function getDefaultCurrentMonth(): string {
  return format(new Date(), 'yyyy-MM');
}

// In-memory storage for the active month across all pages:
// Dashboard, Energy Meters, Gas Meters, Hour Meters, Consumption.
// This persists in JavaScript memory across Next.js client-side navigations,
// but resets completely when the app/page is refreshed or reopened.
let inMemoryMonth: string = getDefaultCurrentMonth();
let inMemoryHasFilter: boolean = false;

// If a browser page reload (F5 / Refresh) occurred, reset all in-memory filter state
// and clean ?month= from the URL so it re-opens in the default state.
if (typeof window !== 'undefined') {
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const isReload = navEntries.length > 0 ? navEntries[0].type === 'reload' : false;
    if (isReload) {
      inMemoryMonth = getDefaultCurrentMonth();
      inMemoryHasFilter = false;
      const url = new URL(window.location.href);
      if (url.searchParams.has('month')) {
        url.searchParams.delete('month');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      }
    }
  } catch {
    // ignore
  }
}

interface MonthContextType {
  selectedMonth: string; // format 'yyyy-MM'
  setSelectedMonth: (month: string) => void;
  year: number;
  month: number; // 1-12
  setYearAndMonth: (year: number, month: number) => void;
  hasAppliedFilter: boolean;
  clearFilter: () => void;
}

const MonthContext = createContext<MonthContextType | null>(null);

export function MonthProvider({ children }: { children: React.ReactNode }) {
  const [selectedMonth, setSelectedMonthState] = useState<string>(() => inMemoryMonth);
  const [hasAppliedFilter, setHasAppliedFilter] = useState<boolean>(() => inMemoryHasFilter);

  const setSelectedMonth = useCallback((monthStr: string) => {
    if (!monthStr || !monthStr.includes('-')) return;
    inMemoryMonth = monthStr;
    inMemoryHasFilter = true;
    setSelectedMonthState(monthStr);
    setHasAppliedFilter(true);
  }, []);

  const [yStr, mStr] = selectedMonth.split('-');
  const year = parseInt(yStr, 10) || new Date().getFullYear();
  const month = parseInt(mStr, 10) || 1;

  const setYearAndMonth = useCallback(
    (newYear: number, newMonth: number) => {
      const formatted = `${newYear}-${String(newMonth).padStart(2, '0')}`;
      setSelectedMonth(formatted);
    },
    [setSelectedMonth]
  );

  const clearFilter = useCallback(() => {
    inMemoryMonth = getDefaultCurrentMonth();
    inMemoryHasFilter = false;
    setSelectedMonthState(inMemoryMonth);
    setHasAppliedFilter(false);
  }, []);

  return (
    <MonthContext.Provider
      value={{
        selectedMonth,
        setSelectedMonth,
        year,
        month,
        setYearAndMonth,
        hasAppliedFilter,
        clearFilter,
      }}
    >
      {children}
    </MonthContext.Provider>
  );
}

export function useSyncedMonth() {
  const context = useContext(MonthContext);
  if (!context) {
    const [yStr, mStr] = inMemoryMonth.split('-');
    return {
      selectedMonth: inMemoryMonth,
      setSelectedMonth: (m: string) => {
        inMemoryMonth = m;
        inMemoryHasFilter = true;
      },
      year: parseInt(yStr, 10) || new Date().getFullYear(),
      month: parseInt(mStr, 10) || 1,
      setYearAndMonth: (y: number, m: number) => {
        inMemoryMonth = `${y}-${String(m).padStart(2, '0')}`;
        inMemoryHasFilter = true;
      },
      hasAppliedFilter: inMemoryHasFilter,
      clearFilter: () => {
        inMemoryMonth = getDefaultCurrentMonth();
        inMemoryHasFilter = false;
      },
    };
  }
  return context;
}
