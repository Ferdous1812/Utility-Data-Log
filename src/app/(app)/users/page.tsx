'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { updateUserRole } from '@/lib/actions';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RoleBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { format } from 'date-fns';
import type { Profile } from '@/lib/types';

export default function UsersPage() {
  const supabase = createClient();
  const { addToast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id || null);

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('role')
      .order('full_name');

    setProfiles((data || []) as Profile[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const handleRoleToggle = async (profile: Profile) => {
    const newRole = profile.role === 'admin' ? 'operator' : 'admin';
    const action = newRole === 'admin' ? 'promote to Admin' : 'demote to Operator';

    const confirmed = window.confirm(
      `Are you sure you want to ${action} "${profile.full_name}"?`
    );
    if (!confirmed) return;

    setUpdatingId(profile.id);
    const result = await updateUserRole(profile.id, newRole);

    if (result.success) {
      addToast('success', result.message);
      fetchProfiles();
    } else {
      addToast('error', result.message);
    }

    setUpdatingId(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">User Management</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage user accounts and roles
        </p>
      </div>

      {/* Users Table */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <p className="text-sm">No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-bg-elevated">
                <tr className="bg-bg-elevated border-b border-border">
                  <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">User</th>
                  <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Role</th>
                  <th className="px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Joined</th>
                  <th className="px-3 py-2.5 text-right font-bold text-[11px] uppercase tracking-wider text-text-secondary border-b-2 border-border">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile, idx) => {
                  const isCurrentUser = profile.id === currentUserId;

                  return (
                    <tr
                      key={profile.id}
                      className={`border-b border-border transition-colors hover:bg-bg-surface-hover ${
                        idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent/15 text-accent text-sm font-bold flex-shrink-0">
                            {profile.full_name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <span className="font-medium text-text-primary block leading-tight">
                              {profile.full_name || 'Unnamed'}
                            </span>
                            {isCurrentUser && (
                              <span className="text-[10px] text-accent uppercase tracking-wider">You</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={profile.role} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {format(new Date(profile.created_at), 'dd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!isCurrentUser && (
                          <Button
                            variant={profile.role === 'operator' ? 'primary' : 'outline'}
                            size="sm"
                            loading={updatingId === profile.id}
                            onClick={() => handleRoleToggle(profile)}
                          >
                            {profile.role === 'operator' ? 'Promote to Admin' : 'Demote to Operator'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Info */}
      <div className="bg-accent/5 border border-accent/20 rounded-[var(--radius-md)] px-4 py-3">
        <p className="text-xs text-accent">
          ℹ New users automatically receive the <strong>Operator</strong> role. You cannot demote yourself or the last remaining admin.
        </p>
      </div>
    </div>
  );
}
