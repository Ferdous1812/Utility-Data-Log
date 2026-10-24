'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { format, subMonths } from 'date-fns';

export function getDefaultDashboardMonth(): string {
  return format(subMonths(new Date(), 1), 'yyyy-MM');
}

// In-memory storage for the active month across the 4 synchronized pages:
// Dashboard, Energy Meters, Gas Meters, Hour Meters.
// This persists in JavaScript memory across Next.js client-side navigations,
// but resets to the default month when the app/page is refreshed or reopened.
let inMemoryMonth: string = getDefaultDashboardMonth();
let isInitialized = false;

if (typeof window !== 'undefined' && !isInitialized) {
  isInitialized = true;
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const isReload = navEntries.length > 0 ? navEntries[0].type === 'reload' : false;
    if (isReload) {
      inMemoryMonth = getDefaultDashboardMonth();
      const url = new URL(window.location.href);
      if (url.searchParams.has('month')) {
        url.searchParams.delete('month');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
        window.location.replace(url.pathname + (url.search || ''));
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
}

const MonthContext = createContext<MonthContextType | null>(null);

export function MonthProvider({ children }: { children: React.ReactNode }) {
  const [selectedMonth, setSelectedMonthState] = useState<string>(() => inMemoryMonth);

  const setSelectedMonth = useCallback((monthStr: string) => {
    if (!monthStr || !monthStr.includes('-')) return;
    inMemoryMonth = monthStr;
    setSelectedMonthState(monthStr);
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

  return (
    <MonthContext.Provider
      value={{
        selectedMonth,
        setSelectedMonth,
        year,
        month,
        setYearAndMonth,
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
      },
      year: parseInt(yStr, 10) || new Date().getFullYear(),
      month: parseInt(mStr, 10) || 1,
      setYearAndMonth: (y: number, m: number) => {
        inMemoryMonth = `${y}-${String(m).padStart(2, '0')}`;
      },
    };
  }
  return context;
}
