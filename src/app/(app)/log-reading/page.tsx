'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logReading, updateReadingAction } from '@/lib/actions';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { format, subDays } from 'date-fns';
import ExcelJS from 'exceljs';
import type { Meter, Reading, MeterSection } from '@/lib/types';

interface MeterRow {
  meter: Meter;
  previousReadingValue: number; // 0 if no previous reading exists
  previousReadingDate: string | null; // N/A if no previous reading exists
  currentValue: string;
  readingId: string | null; // id of the saved reading row, once saved (enables edit)
}

export default function LogReadingPage() {
  const supabase = createClient();
  const { addToast } = useToast();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // Dual Selectable Dates:
  // 1. Target Previous Reading Date (user selectable)
  // 2. Current Reading Date (defaults to today)
  const [selectedPreviousDate, setSelectedPreviousDate] = useState(yesterdayStr);
  const [currentReadingDate, setCurrentReadingDate] = useState(todayStr);

  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [loadingMeters, setLoadingMeters] = useState(true);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  // Fetch current user's role (edit access is admin-only, same as History page)
  useEffect(() => {
    async function fetchRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      setIsAdmin(data?.role === 'admin');
    }
    fetchRole();
  }, [supabase]);

  // Fetch active meters & sections
  useEffect(() => {
    async function fetchMetersAndSections() {
      const [metersRes, sectionsRes] = await Promise.all([
        supabase
          .from('meters')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('type')
          .order('name'),
        supabase
          .from('meter_sections')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);
      // Filter out meters whose location is 'N/A' (case-insensitive)
      const allMeters = (metersRes.data || []) as Meter[];
      const filteredMeters = allMeters.filter(
        (m) => !m.location || m.location.trim().toLowerCase() !== 'n/a'
      );
      setMeters(filteredMeters);
      setSections((sectionsRes.data || []) as MeterSection[]);
      setLoadingMeters(false);
    }
    fetchMetersAndSections();
  }, [supabase]);

  // Smart "Previous Reading" Fetching Logic:
  // 1. Searches on or before selectedPreviousDate for the closest previous reading.
  // 2. If the chosen selectedPreviousDate has a reading, fetch it directly.
  // 3. If selectedPreviousDate has no reading, fetch the nearest preceding reading before that date.
  // 4. If no reading exists at all before that date, return 0 for Previous KWH and N/A for date.
  const fetchPreviousReadings = useCallback(async () => {
    if (meters.length === 0) return;
    setLoadingPrevious(true);

    const newRows: MeterRow[] = [];

    for (const meter of meters) {
      const { data } = await supabase
        .from('readings')
        .select('*')
        .eq('meter_id', meter.id)
        .lte('reading_date', selectedPreviousDate)
        .order('reading_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevReading = data as Reading | null;

      newRows.push({
        meter,
        previousReadingValue: prevReading ? Number(prevReading.reading_value) : 0,
        previousReadingDate: prevReading ? prevReading.reading_date : null,
        currentValue: '',
        readingId: null,
      });
    }

    setRows(newRows);
    setSubmittedIds(new Set());
    setLoadingPrevious(false);
  }, [meters, selectedPreviousDate, supabase]);

  useEffect(() => {
    fetchPreviousReadings();
  }, [fetchPreviousReadings]);

  // Update inline Current KWh value
  const updateCurrentValue = (meterId: string, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.meter.id === meterId ? { ...r, currentValue: value } : r
      )
    );
  };

  // Calculate Consumption: Present (Current KWh) - Previous Value
  const getConsumption = (row: MeterRow): number | null => {
    if (!row.currentValue.trim()) return null;
    const current = parseFloat(row.currentValue);
    if (isNaN(current)) return null;
    return current - row.previousReadingValue;
  };

  // Save a single row's reading individually
  const handleSaveRow = async (meterId: string) => {
    const row = rows.find((r) => r.meter.id === meterId);
    if (!row) return;

    if (!row.currentValue.trim()) {
      addToast('error', `Please enter a Current Reading for "${row.meter.name}".`);
      return;
    }

    const val = parseFloat(row.currentValue);
    if (isNaN(val) || val < 0) {
      addToast('error', `Invalid reading for "${row.meter.name}". Must be a non-negative number.`);
      return;
    }

    setSavingIds((prev) => new Set(prev).add(meterId));

    // If this row was already saved before (has a readingId), update it in place
    // instead of inserting a duplicate reading.
    const result = row.readingId
      ? await updateReadingAction(row.readingId, {
          reading_value: val,
          reading_date: currentReadingDate,
        })
      : await logReading({
          meter_id: row.meter.id,
          reading_value: val,
          reading_date: currentReadingDate,
        });

    if (result.success) {
      const newReadingId = (result as { readingId?: string }).readingId;
      setRows((prev) =>
        prev.map((r) =>
          r.meter.id === meterId
            ? {
                ...r,
                readingId: newReadingId ?? r.readingId,
              }
            : r
        )
      );
      setSubmittedIds((prev) => new Set(prev).add(meterId));
      addToast('success', `${row.meter.name}: ${result.message}`);
    } else {
      addToast('error', `${row.meter.name}: ${result.message}`);
    }

    setSavingIds((prev) => {
      const next = new Set(prev);
      next.delete(meterId);
      return next;
    });
  };

  // Unlock a saved row for editing again
  const handleEditRow = (meterId: string) => {
    setSubmittedIds((prev) => {
      const next = new Set(prev);
      next.delete(meterId);
      return next;
    });
  };

  // Meter Groups
  const incomingRows = rows.filter(
    (r) => r.meter.type === 'incoming' || r.meter.type === 'main'
  );
  const outgoingMainRows = rows.filter(
    (r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing'
  );
  const outgoingSubRows = rows.filter(
    (r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter'
  );
  const outgoingSubSubRows = rows.filter(
    (r) => r.meter.type === 'outgoing_sub_sub'
  );

  // --- Export to Excel (XLSX) ---
  const handleExportToExcel = useCallback(async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Log Readings');

    // Page setup: A4, narrow margins, fit to one page wide, repeat header row when printed
    worksheet.pageSetup.paperSize = 9; // 9 = A4
    worksheet.pageSetup.orientation = 'landscape';
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 0;
    worksheet.pageSetup.horizontalCentered = true;
    worksheet.pageSetup.printTitlesRow = '1:1';
    // Margins matched to the user's Page Setup dialog
    worksheet.pageSetup.margins = {
      left: 0.25, right: 0.25,
      top: 0.85, bottom: 0.5,
      header: 0.1, footer: 0.1
    };

    // Print header: 3-line company header, centered
    worksheet.headerFooter.oddHeader =
      '&C&"Cambria,Bold"&14ACI Formulations PLC\n' +
      '&"Cambria,Regular"&11Rajabari, Sreepur, Gazipur\n' +
      '&"Cambria,Bold"&11Monthly Meter Reading';
    worksheet.headerFooter.evenHeader = worksheet.headerFooter.oddHeader;

    // Print footer: centered page number
    worksheet.headerFooter.oddFooter = '&C&"Cambria,Regular"&9Page &P of &N';
    worksheet.headerFooter.evenFooter = worksheet.headerFooter.oddFooter;

    const cambriaFont = { name: 'Cambria', size: 11 };

    // Approximate px -> Excel column-width conversion (Excel width units, ~7px per unit)
    const pxToColWidth = (px: number) => Number(((px - 5) / 7).toFixed(2));

    // Define columns (Removed 'Section')
    worksheet.columns = [
      { header: 'Meter Name', key: 'meterName', width: 20 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Previous Date', key: 'prevDate', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Previous Reading', key: 'prevReading', width: 15, style: { alignment: { horizontal: 'center' } } },
      { header: 'Current Date', key: 'currDate', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Current Reading', key: 'currReading', width: pxToColWidth(140), style: { alignment: { horizontal: 'center' } } },
      { header: 'Difference', key: 'difference', width: pxToColWidth(160), style: { alignment: { horizontal: 'center' } } },
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { ...cambriaFont, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    const addGroupRows = (sectionName: string, groupRows: MeterRow[]) => {
      if (groupRows.length === 0) return;

      // Add Section Header Row (Merge across all 7 columns)
      if (sectionName) {
        const sectionRow = worksheet.addRow([sectionName]);
        worksheet.mergeCells(`A${sectionRow.number}:G${sectionRow.number}`);
        sectionRow.font = { ...cambriaFont, bold: true, size: 12 };
        sectionRow.alignment = { horizontal: 'center', vertical: 'middle' };
        for (let i = 1; i <= 7; i++) {
          sectionRow.getCell(i).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
          };
        }
      }

      // Add Data Rows
      for (const row of groupRows) {
        const diff = getConsumption(row);
        const dataRow = worksheet.addRow({
          meterName: row.meter.name,
          location: row.meter.location || '',
          prevDate: row.previousReadingDate
            ? format(new Date(row.previousReadingDate), 'dd MMM yyyy')
            : 'N/A',
          prevReading: row.previousReadingValue,
          currDate: format(new Date(currentReadingDate), 'dd MMM yyyy'),
          currReading: row.currentValue ? Number(row.currentValue) : '',
          difference: diff !== null ? diff : '',
        });
        dataRow.font = cambriaFont;
      }
    };

    if (sections.length > 0) {
      for (const sec of sections) {
        const secRows = rows.filter((r) => r.meter.section_id === sec.id);
        if (secRows.length === 0) continue;

        const secIncoming = secRows.filter((r) => r.meter.type === 'incoming' || r.meter.type === 'main');
        const secOutgoingMain = secRows.filter((r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing');
        const secOutgoingSub = secRows.filter((r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter');
        const secOutgoingSubSub = secRows.filter((r) => r.meter.type === 'outgoing_sub_sub');

        addGroupRows(sec.name, secIncoming);
        addGroupRows(sec.name, secOutgoingMain);
        addGroupRows(sec.name, secOutgoingSub);
        addGroupRows(sec.name, secOutgoingSubSub);
      }

      // Uncategorized
      const uncategorized = rows.filter((r) => !r.meter.section_id);
      if (uncategorized.length > 0) {
        addGroupRows('Uncategorized', uncategorized.filter((r) => r.meter.type === 'incoming' || r.meter.type === 'main'));
        addGroupRows('Uncategorized', uncategorized.filter((r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing'));
        addGroupRows('Uncategorized', uncategorized.filter((r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter'));
        addGroupRows('Uncategorized', uncategorized.filter((r) => r.meter.type === 'outgoing_sub_sub'));
      }
    } else {
      addGroupRows('', incomingRows);
      addGroupRows('', outgoingMainRows);
      addGroupRows('', outgoingSubRows);
      addGroupRows('', outgoingSubSubRows);
    }

    // Auto-fit columns (skip Current Reading & Difference — they keep their fixed pixel widths)
    const fixedWidthKeys = new Set(['currReading', 'difference']);
    worksheet.columns.forEach((column) => {
      if (fixedWidthKeys.has(column.key as string)) return;
      let maxLength = 0;
      column.eachCell!({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = maxLength < 10 ? 10 : maxLength + 2;
    });

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Log_Reading_${format(new Date(currentReadingDate), 'yyyy-MM-dd')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    addToast('success', 'Log reading exported to Excel successfully!');
  }, [rows, sections, currentReadingDate, incomingRows, outgoingMainRows, outgoingSubRows, outgoingSubSubRows, addToast]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Log Readings</h1>
          <p className="text-sm text-text-secondary mt-1">
            Select target Previous Reading Date &amp; Current Reading Date, then enter and save each Current Reading individually.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="md"
            onClick={handleExportToExcel}
            disabled={rows.length === 0}
            fullWidth
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            }
          >
            Export to Excel
          </Button>
        </div>
      </div>

      {/* Selectable Dual Date Inputs Card */}
      <Card className="py-3.5 px-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Input
              label="Select Target Previous Reading Date"
              type="date"
              value={selectedPreviousDate}
              onChange={(e) => setSelectedPreviousDate(e.target.value)}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              }
            />
            <p className="text-[11px] text-text-muted mt-1">
              📅 Fetches the reading on this date, or the nearest previous date.
            </p>
          </div>

          <div>
            <Input
              label="Current Reading Date"
              type="date"
              value={currentReadingDate}
              onChange={(e) => setCurrentReadingDate(e.target.value)}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
            />
            <p className="text-[11px] text-text-muted mt-1">
              ⚡ Date assigned to new current readings (auto-filled to today).
            </p>
          </div>
        </div>
      </Card>

      {/* Main Table View */}
      <Card className="p-0 overflow-hidden">
        {loadingMeters || loadingPrevious ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-text-muted">Fetching previous readings...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <p className="text-sm">No meters configured yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-280px)] relative">
            <table className="responsive-table w-full text-sm border-separate border-spacing-0 table-fixed">
              <thead className="sticky top-0 z-20 bg-table-header">
                <tr>
                  <th className="sticky left-0 z-30 bg-table-header px-3 py-2.5 text-left font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[140px] sm:w-[200px] md:w-[260px] border-b-2 border-table-header-border">Meter Name</th>
                  <th className="bg-table-header px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[130px] sm:w-[160px] md:w-[180px] border-b-2 border-table-header-border">Previous Reading Date</th>
                  <th className="bg-table-header px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[130px] sm:w-[160px] md:w-[180px] border-b-2 border-table-header-border">Previous Reading</th>
                  <th className="bg-table-header px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[130px] sm:w-[160px] md:w-[180px] border-b-2 border-table-header-border">Current Reading Date</th>
                  <th className="bg-table-header px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wider text-accent w-[130px] sm:w-[160px] md:w-[180px] border-b-2 border-table-header-border">Current Reading</th>
                  <th className="bg-table-header px-3 py-2.5 text-center font-bold text-[11px] uppercase tracking-wider text-text-secondary w-[130px] sm:w-[160px] md:w-[180px] border-b-2 border-table-header-border">Difference</th>
                </tr>
              </thead>
              <tbody>
                {sections.length > 0 ? (
                  sections.map((sec) => {
                    const secRows = rows.filter((r) => r.meter.section_id === sec.id);
                    if (secRows.length === 0) return null;

                    const secIncoming = secRows.filter((r) => r.meter.type === 'incoming' || r.meter.type === 'main');
                    const secOutgoingMain = secRows.filter((r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing');
                    const secOutgoingSub = secRows.filter((r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter');
                    const secOutgoingSubSub = secRows.filter((r) => r.meter.type === 'outgoing_sub_sub');

                    return (
                      <React.Fragment key={sec.id}>
                        {/* Section Header Banner */}
                        <tr className="bg-bg-elevated border-y-2 border-accent/40 h-12 shadow-sm">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2.5">
                              <span className="text-xl">{sec.icon}</span>
                              <span className="font-extrabold text-sm text-text-primary tracking-widest uppercase">{sec.name}</span>
                              <Badge variant="accent">{secRows.length} meters</Badge>
                            </div>
                          </td>
                        </tr>
                        {renderGroup('Incoming Meters', 'warning', secIncoming)}
                        {renderGroup('Outgoing Meters (Main)', 'accent', secOutgoingMain)}
                        {renderGroup('Outgoing Meters (Sub)', 'success', secOutgoingSub)}
                        {renderGroup('Sub of Sub Outgoing', 'danger', secOutgoingSubSub)}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <>
                    {renderGroup('⚡ Incoming Meters', 'warning', incomingRows)}
                    {renderGroup('⚡ Outgoing Meters (Main)', 'accent', outgoingMainRows)}
                    {renderGroup('📊 Outgoing Meters (Sub)', 'success', outgoingSubRows)}
                    {renderGroup('📊 Sub of Sub Outgoing', 'danger', outgoingSubSubRows)}
                  </>
                )}

                {/* Uncategorized Meters if any */}
                {rows.some((r) => !r.meter.section_id && sections.length > 0) && (
                  <>
                    <tr className="bg-bg-elevated border-y-2 border-border h-12 shadow-sm">
                      <td colSpan={6} className="px-4 py-3 text-center font-extrabold text-sm text-text-muted tracking-widest uppercase">
                        📦 Uncategorized Meters
                      </td>
                    </tr>
                    {renderGroup('Incoming Meters', 'warning', rows.filter((r) => !r.meter.section_id && (r.meter.type === 'incoming' || r.meter.type === 'main')))}
                    {renderGroup('Outgoing Meters (Main)', 'accent', rows.filter((r) => !r.meter.section_id && (r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing')))}
                    {renderGroup('Outgoing Meters (Sub)', 'success', rows.filter((r) => !r.meter.section_id && (r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter')))}
                    {renderGroup('Sub of Sub Outgoing', 'danger', rows.filter((r) => !r.meter.section_id && r.meter.type === 'outgoing_sub_sub'))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

    </div>
  );

  function getTypeLabel(type: string) {
    if (type === 'incoming' || type === 'main') return 'Incoming';
    if (type === 'outgoing_main' || type === 'outgoing') return 'Outgoing (Main)';
    if (type === 'outgoing_sub_sub') return 'Sub of Sub';
    return 'Outgoing (Sub)';
  }

  function renderGroup(
    label: string,
    color: 'warning' | 'accent' | 'success' | 'danger',
    groupRows: MeterRow[]
  ) {
    if (groupRows.length === 0) return null;

    const colorClasses = {
      warning: 'bg-warning/15 border-warning/30 text-warning',
      accent: 'bg-accent/15 border-accent/30 text-accent',
      success: 'bg-success/15 border-success/30 text-success',
      danger: 'bg-danger/15 border-danger/30 text-danger',
    };
    const accentBorderClasses = {
      warning: 'border-l-4 border-l-warning',
      accent: 'border-l-4 border-l-accent',
      success: 'border-l-4 border-l-success',
      danger: 'border-l-4 border-l-danger',
    };

    return (
      <React.Fragment key={label}>
        <tr className={`${colorClasses[color]} border-y h-10`}>
          <td colSpan={6} className={`px-4 py-2 text-center font-bold text-xs uppercase tracking-wider ${accentBorderClasses[color]}`}>
            {label} ({groupRows.length})
          </td>
        </tr>
        {groupRows.map((row, idx) => {
          const difference = getConsumption(row);
          const isSubmitted = submittedIds.has(row.meter.id);
          const isSaving = savingIds.has(row.meter.id);
          const isNegative = difference !== null && difference < 0;

          return (
            <tr
              key={row.meter.id}
              className={`h-14 border-b border-border transition-colors ${
                isSubmitted
                  ? 'bg-success/5 opacity-60'
                  : idx % 2 === 0
                  ? 'bg-bg-surface hover:bg-bg-surface-hover'
                  : 'bg-bg-primary/50 hover:bg-bg-surface-hover'
              }`}
            >
              {/* Meter Name (Sticky Column) with By-Line */}
              <td className="sticky left-0 z-10 bg-bg-surface px-4 py-2.5 text-sm w-[140px] sm:w-[200px] md:w-[260px]">
                <div className="font-semibold text-text-primary text-sm leading-tight">
                  {row.meter.name}
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted flex items-center gap-1">
                  <span>{getTypeLabel(row.meter.type)}</span>
                  {row.meter.location && <span>· {row.meter.location}</span>}
                </div>
              </td>

              {/* Previous Reading Date */}
              <td className="px-4 py-2.5 text-center text-text-muted text-sm whitespace-nowrap">
                {row.previousReadingDate
                  ? format(new Date(row.previousReadingDate), 'dd MMM yyyy')
                  : 'N/A'}
              </td>

              {/* Previous Reading */}
              <td className="px-4 py-2.5 text-center tabular-nums text-sm font-medium text-text-primary">
                {row.previousReadingValue.toLocaleString()}
              </td>

              {/* Current Reading Date */}
              <td className="px-4 py-2.5 text-center text-text-secondary text-sm whitespace-nowrap font-medium">
                {format(new Date(currentReadingDate), 'dd MMM yyyy')}
              </td>

              {/* Current Reading Input + Save / Edit Icons */}
              <td className="px-4 py-2.5 text-sm">
                {isSubmitted ? (
                  <div className="w-full flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 text-center font-bold text-success text-sm tabular-nums">
                      {parseFloat(row.currentValue).toLocaleString()}
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => handleEditRow(row.meter.id)}
                        title="Edit this reading"
                        className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                          text-text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    ) : (
                      <div className="flex-shrink-0 w-8 h-8" />
                    )}
                  </div>
                ) : (
                  <div className="w-full flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder={`Enter ${
                        (() => {
                          const sec = sections.find((s) => s.id === row.meter.section_id);
                          if (sec?.unit) return sec.unit;
                          if (sec?.name?.toLowerCase().includes('gas')) return 'm³';
                          if (sec?.name?.toLowerCase().includes('hour')) return 'hrs';
                          return 'Reading';
                        })()
                      }`}
                      value={row.currentValue}
                      onChange={(e) => updateCurrentValue(row.meter.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveRow(row.meter.id);
                        }
                      }}
                      disabled={isSaving}
                      className="flex-1 min-w-0 h-9 px-3 py-1 rounded-[var(--radius-md)] border border-border bg-bg-primary text-text-primary text-center font-semibold tabular-nums text-sm
                        focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent
                        placeholder:text-text-muted/50 placeholder:font-normal
                        disabled:opacity-50
                        transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRow(row.meter.id)}
                      disabled={isSaving || !row.currentValue.trim()}
                      title="Save this reading"
                      className="flex-shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                        bg-success/10 text-success hover:bg-success/20 border border-success/20
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors cursor-pointer"
                    >
                      {isSaving ? (
                        <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </td>

              {/* Difference: Current Reading - Previous Reading */}
              <td className="px-4 py-2.5 text-center tabular-nums text-sm font-semibold">
                {difference !== null ? (
                  <span
                    className={`${
                      isNegative ? 'text-danger' : 'text-accent'
                    }`}
                  >
                    {isNegative && '⚠ '}
                    {difference.toLocaleString()}
                  </span>
                ) : (
                  <span className="text-text-muted text-sm">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </React.Fragment>
    );
  }
}
