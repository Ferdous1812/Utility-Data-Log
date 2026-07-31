import React from 'react';
import { getDashboardStats, getChartData, getMonthlyUsageByMeter } from '@/lib/queries';
import { StatCard, Card } from '@/components/ui/Card';
import { DashboardChart } from '@/components/DashboardChart';
import { Badge } from '@/components/ui/Badge';
import { format, startOfMonth } from 'date-fns';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  const [stats, chartData, monthlyUsage, { data: units }, { data: allocations }] = await Promise.all([
    getDashboardStats(),
    getChartData(),
    getMonthlyUsageByMeter(),
    supabase.from('units').select('*').order('sort_order', { ascending: true }),
    supabase.from('unit_allocations').select('*'),
  ]);

  const activeUnits = units || [];
  const activeAllocations = allocations || [];

  const now = new Date();
  const currentMonthStr = format(startOfMonth(now), 'yyyy-MM-dd');

  const currentMonthUsage = monthlyUsage.filter(
    (m) => format(new Date(m.month), 'yyyy-MM-dd') === currentMonthStr
  );

  // Group meters into 3 tiers
  const incomingMeters = currentMonthUsage.filter(
    (m) => m.meter_type === 'incoming' || m.meter_type === 'main'
  );
  const outgoingMainMeters = currentMonthUsage.filter(
    (m) => m.meter_type === 'outgoing_main' || m.meter_type === 'outgoing'
  );
  const outgoingSubMeters = currentMonthUsage.filter(
    (m) => m.meter_type === 'outgoing_sub' || m.meter_type === 'submeter'
  );

  const totalIncoming = incomingMeters.reduce((sum, r) => sum + Number(r.total_usage), 0);
  const totalOutgoingMain = outgoingMainMeters.reduce((sum, r) => sum + Number(r.total_usage), 0);
  const totalOutgoingSub = outgoingSubMeters.reduce((sum, r) => sum + Number(r.total_usage), 0);

  const difference = totalIncoming - (totalOutgoingMain + totalOutgoingSub);

  // Calculate consumption per Major Unit
  const unitConsumptionMap = new Map<string, number>();
  activeUnits.forEach((u) => unitConsumptionMap.set(u.id, 0));

  activeAllocations.forEach((alloc) => {
    const meterUsage = currentMonthUsage.find((m) => m.meter_id === alloc.meter_id);
    if (meterUsage) {
      const rawUsage = Number(meterUsage.total_usage) || 0;
      const mf = Number(meterUsage.meter_multiplication_factor) || 1;
      const actualConsumption = rawUsage * mf;
      const allocatedConsumption = actualConsumption * (Number(alloc.percentage) / 100);

      const currentSum = unitConsumptionMap.get(alloc.unit_id) || 0;
      unitConsumptionMap.set(alloc.unit_id, currentSum + allocatedConsumption);
    }
  });

  const unitBreakdown = activeUnits
    .map((u) => {
      const consumption = unitConsumptionMap.get(u.id) || 0;
      const percentOfTotal = totalIncoming > 0 ? (consumption / totalIncoming) * 100 : 0;
      
      // Get list of allocated meters for details
      const uAllocations = activeAllocations.filter((a) => a.unit_id === u.id);
      const allocatedMeterNames = uAllocations
        .map((a) => {
          const match = currentMonthUsage.find((m) => m.meter_id === a.meter_id);
          return match ? `${match.meter_name} (${a.percentage}%)` : '';
        })
        .filter(Boolean)
        .join(', ');

      return {
        id: u.id,
        name: u.name,
        consumption,
        percentOfTotal,
        allocatedMeterNames,
      };
    });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">
          Factory energy consumption overview — {format(now, 'MMMM yyyy')}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          label="Total Incoming Power"
          value={`${totalIncoming.toLocaleString()} kWh`}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          }
          trend={
            stats.totalUsageLastMonth > 0
              ? { value: stats.percentChange, label: 'vs last month' }
              : undefined
          }
          accentColor="var(--color-warning)"
        />

        <StatCard
          label="Outgoing Power (Main)"
          value={`${totalOutgoingMain.toLocaleString()} kWh`}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
          accentColor="var(--color-accent)"
        />

        <StatCard
          label="Outgoing Power (Sub)"
          value={`${totalOutgoingSub.toLocaleString()} kWh`}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          }
          accentColor="var(--color-success)"
        />

        <StatCard
          label="Distribution Loss / Variance"
          value={`${difference > 0 ? '+' : ''}${difference.toLocaleString()} kWh`}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          accentColor={difference >= 0 ? 'var(--color-accent)' : 'var(--color-danger)'}
        />
      </div>

      {/* Bar Chart */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Usage Comparison</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Current month vs. previous month (kWh per meter)
            </p>
          </div>
        </div>
        <DashboardChart data={chartData} />
      </Card>

      {/* Major Unit Breakdown Card */}
      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Consumption by Major Unit</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Breakdown of allocated energy consumption for {format(now, 'MMMM yyyy')}
          </p>
        </div>

        {activeUnits.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <p className="text-sm">No Major Units configured.</p>
            <p className="text-xs mt-1">Configure units and allocations in Settings.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center py-2">
            {/* Breakdown List */}
            <div className="space-y-4">
              {unitBreakdown.map((item) => (
                <div key={item.id} className="flex justify-between items-start border-b border-border/40 pb-3 last:border-0 last:pb-0">
                  <div>
                    <h3 className="font-semibold text-text-primary text-sm">{item.name}</h3>
                    {item.allocatedMeterNames ? (
                      <p className="text-[11px] text-text-muted mt-0.5 truncate max-w-xs sm:max-w-md">
                        {item.allocatedMeterNames}
                      </p>
                    ) : (
                      <p className="text-[11px] text-danger/80 italic mt-0.5">No meters allocated</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-accent text-sm tabular-nums">
                      {item.consumption.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh
                    </span>
                    <span className="text-[11px] text-text-secondary block font-medium">
                      {item.percentOfTotal.toFixed(1)}% of Incoming
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Visual Progress Bar Chart */}
            <div className="space-y-5 bg-bg-primary/30 p-5 rounded-[var(--radius-lg)] border border-border/50">
              <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Relative Share
              </h4>
              {unitBreakdown.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-text-primary">{item.name}</span>
                    <span className="text-accent">{item.percentOfTotal.toFixed(1)}%</span>
                  </div>
                  <div className="h-2.5 w-full bg-bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 3-Tier Grouped Monthly Aggregation Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Monthly Consumption by Category — {format(now, 'MMMM yyyy')}
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Grouped by Incoming Feeders, Outgoing Main Panels, and Outgoing Submeters
            </p>
          </div>
        </div>

        {currentMonthUsage.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            <p className="text-sm">No usage data for this month yet.</p>
            <p className="text-xs mt-1">Start logging readings to populate this table.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-elevated border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">Meter Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-text-secondary">Location</th>
                  <th className="px-4 py-3 text-right font-semibold text-text-secondary">Total kWh</th>
                  <th className="px-4 py-3 text-right font-semibold text-text-secondary">Readings</th>
                </tr>
              </thead>
              <tbody>
                {/* ── 1. INCOMING METERS ── */}
                <tr className="bg-warning/10 border-y border-warning/20">
                  <td colSpan={5} className="px-4 py-2.5 font-bold text-warning text-xs uppercase tracking-wider">
                    ⚡ Incoming Meters (Main Substation Feeders)
                  </td>
                </tr>
                {incomingMeters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-text-muted text-xs italic">
                      No incoming meter readings logged this month.
                    </td>
                  </tr>
                ) : (
                  incomingMeters.map((row, idx) => (
                    <tr
                      key={row.meter_id}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-text-primary">{row.meter_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="warning">⚡ Incoming</Badge>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{row.meter_location}</td>
                      <td className="px-4 py-3 text-right font-bold text-warning">
                        {Number(row.total_usage).toLocaleString()} kWh
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{row.reading_count}</td>
                    </tr>
                  ))
                )}
                {incomingMeters.length > 0 && (
                  <tr className="bg-bg-elevated/70 font-semibold border-b border-border">
                    <td colSpan={3} className="px-4 py-2 text-warning text-xs">
                      Subtotal Incoming
                    </td>
                    <td className="px-4 py-2 text-right text-warning font-bold">
                      {totalIncoming.toLocaleString()} kWh
                    </td>
                    <td className="px-4 py-2 text-right text-text-secondary text-xs">
                      {incomingMeters.reduce((sum, r) => sum + r.reading_count, 0)}
                    </td>
                  </tr>
                )}

                {/* ── 2. OUTGOING MAIN METERS ── */}
                <tr className="bg-accent/10 border-y border-accent/20">
                  <td colSpan={5} className="px-4 py-2.5 font-bold text-accent text-xs uppercase tracking-wider">
                    ⚡ Outgoing Meters (Main Distribution Panels)
                  </td>
                </tr>
                {outgoingMainMeters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-text-muted text-xs italic">
                      No outgoing (main) meter readings logged this month.
                    </td>
                  </tr>
                ) : (
                  outgoingMainMeters.map((row, idx) => (
                    <tr
                      key={row.meter_id}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-text-primary">{row.meter_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="accent">⚡ Outgoing (Main)</Badge>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{row.meter_location}</td>
                      <td className="px-4 py-3 text-right font-bold text-accent">
                        {Number(row.total_usage).toLocaleString()} kWh
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{row.reading_count}</td>
                    </tr>
                  ))
                )}
                {outgoingMainMeters.length > 0 && (
                  <tr className="bg-bg-elevated/70 font-semibold border-b border-border">
                    <td colSpan={3} className="px-4 py-2 text-accent text-xs">
                      Subtotal Outgoing (Main)
                    </td>
                    <td className="px-4 py-2 text-right text-accent font-bold">
                      {totalOutgoingMain.toLocaleString()} kWh
                    </td>
                    <td className="px-4 py-2 text-right text-text-secondary text-xs">
                      {outgoingMainMeters.reduce((sum, r) => sum + r.reading_count, 0)}
                    </td>
                  </tr>
                )}

                {/* ── 3. OUTGOING SUB METERS ── */}
                <tr className="bg-success/10 border-y border-success/20">
                  <td colSpan={5} className="px-4 py-2.5 font-bold text-success text-xs uppercase tracking-wider">
                    📊 Outgoing Meters (Submeters / Departments)
                  </td>
                </tr>
                {outgoingSubMeters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-text-muted text-xs italic">
                      No outgoing (sub) meter readings logged this month.
                    </td>
                  </tr>
                ) : (
                  outgoingSubMeters.map((row, idx) => (
                    <tr
                      key={row.meter_id}
                      className={`border-b border-border/50 ${
                        idx % 2 === 0 ? 'bg-bg-surface' : 'bg-bg-primary/50'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-text-primary">{row.meter_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="success">📊 Outgoing (Sub)</Badge>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{row.meter_location}</td>
                      <td className="px-4 py-3 text-right font-bold text-success">
                        {Number(row.total_usage).toLocaleString()} kWh
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{row.reading_count}</td>
                    </tr>
                  ))
                )}
                {outgoingSubMeters.length > 0 && (
                  <tr className="bg-bg-elevated/70 font-semibold border-b border-border">
                    <td colSpan={3} className="px-4 py-2 text-success text-xs">
                      Subtotal Outgoing (Sub)
                    </td>
                    <td className="px-4 py-2 text-right text-success font-bold">
                      {totalOutgoingSub.toLocaleString()} kWh
                    </td>
                    <td className="px-4 py-2 text-right text-text-secondary text-xs">
                      {outgoingSubMeters.reduce((sum, r) => sum + r.reading_count, 0)}
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot>
                <tr className="bg-bg-elevated border-t-2 border-border">
                  <td colSpan={3} className="px-4 py-3 font-bold text-text-primary">
                    Total Factory Energy Logged
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-accent text-base">
                    {(totalIncoming + totalOutgoingMain + totalOutgoingSub).toLocaleString()} kWh
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {currentMonthUsage.reduce((sum, r) => sum + r.reading_count, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
