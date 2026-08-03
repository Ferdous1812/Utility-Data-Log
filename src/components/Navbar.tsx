'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Profile } from '@/lib/types';

interface NavbarProps {
  profile: Profile;
  sidebarCollapsed: boolean;
  onMenuClick?: () => void;
}

export function Navbar({ profile, sidebarCollapsed, onMenuClick }: NavbarProps) {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <header
      className={`
        fixed top-0 right-0 left-0 h-16 bg-bg-surface/80 backdrop-blur-md border-b border-border z-30
        flex items-center justify-between px-3 sm:px-4 md:px-6
        transition-all duration-300
        ${sidebarCollapsed ? 'md:left-[68px]' : 'md:left-[240px]'}
      `}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={onMenuClick}
          title="Open menu"
          aria-label="Open menu"
          className="flex md:hidden items-center justify-center w-9 h-9 -ml-1 rounded-[var(--radius-md)] text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors cursor-pointer flex-shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="text-sm sm:text-base md:text-lg font-semibold text-text-primary truncate">
          Digital Meter Logbook
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* User / Admin Icon Avatar */}
          <div
            title={profile.role === 'admin' ? 'Admin' : 'Operator'}
            className={`flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 ${
              profile.role === 'admin'
                ? 'bg-accent/15 text-accent'
                : 'bg-border/60 text-text-secondary'
            }`}
          >
            {profile.role === 'admin' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </div>
          <span className="hidden sm:inline text-sm font-semibold text-text-primary truncate max-w-[140px]">
            {profile.full_name || 'User'}
          </span>
        </div>

        <ThemeToggle />

        <button
          onClick={handleLogout}
          title="Logout"
          aria-label="Logout"
          className="flex items-center justify-center p-2 rounded-[var(--radius-md)] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
