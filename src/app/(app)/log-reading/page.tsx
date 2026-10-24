'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logReading, updateReadingAction } from '@/lib/actions';
import { logBranchReading, updateBranchReading } from '@/lib/energyActions';
import { fetchSplitMeters, expandSplitMeters } from '@/lib/branchMeters';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { format, subDays } from 'date-fns';
import ExcelJS from 'exceljs';
import type { Meter, Reading, MeterSection } from '@/lib/types';
import { useTierLabels, getEnergyGroupLabel, getGasGroupLabel, getSectionDomain, getHourGroupKey } from '@/lib/useTierLabels';

// Reading values are always shown right-aligned with exactly two decimal places (xxxx.xx)
function formatReadingValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface MeterRow {
  meter: Meter;
  previousReadingValue: number; // 0 if no previous reading exists
  previousReadingDate: string | null; // N/A if no previous reading exists
  currentValue: string;
  readingId: string | null; // id of the saved reading row, once saved (enables edit)
  isReset?: boolean;
  originalPreviousValue?: number;
  originalPreviousDate?: string | null;
}

export default function LogReadingPage() {
  const supabase = createClient();
  const { addToast } = useToast();
  const tierLabels = useTierLabels();

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // Dual Selectable Dates:
  // 1. Target Previous Reading Date (user selectable)
  // 2. Current Reading Date (defaults to today)
  const [selectedPreviousDate, setSelectedPreviousDate] = useState(yesterdayStr);
  const [currentReadingDate, setCurrentReadingDate] = useState(todayStr);

  const [meters, setMeters] = useState<Meter[]>([]);
  const [sections, setSections] = useState<MeterSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string>('');
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [loadingMeters, setLoadingMeters] = useState(true);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState(false);
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
      const [metersRes, sectionsRes, hourMetersRes] = await Promise.all([
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
        supabase
          .from('hour_meters')
          .select('id, equipment_group, category')
          .eq('is_active', true),
      ]);

      const hourMap = new Map<string, { equipment_group?: string; category?: string }>();
      (hourMetersRes.data || []).forEach((hm: any) => {
        hourMap.set(hm.id, { equipment_group: hm.equipment_group, category: hm.category });
      });

      // Filter out meters whose location is 'N/A' (case-insensitive) and merge hour equipment groups
      const allMeters = ((metersRes.data || []) as any[]).map((m) => {
        const hm = hourMap.get(m.id);
        return {
          ...m,
          equipment_group: hm?.equipment_group,
          category: hm?.category || m.category,
        };
      }) as Meter[];

      const filteredMeters = allMeters.filter(
        (m) => !m.location || m.location.trim().toLowerCase() !== 'n/a'
      );
      // Split meters (e.g. REB) appear as one meter per branch: "REB — Peak", "REB — Off-Peak"
      const splitMeters = await fetchSplitMeters(supabase);
      setMeters(expandSplitMeters(filteredMeters, splitMeters));
      setSections((sectionsRes.data || []) as MeterSection[]);
      setLoadingMeters(false);
    }
    fetchMetersAndSections();
  }, [supabase]);

  // Smart "Previous Reading" Fetching Logic:
  // 1. Searches on or before selectedPreviousDate for the closest previous reading.
  // 2. If the chosen selectedPreviousDate has a reading, fetch it directly.
  // 3. If selectedPreviousDate has no reading, fetch the nearest preceding reading before currentReadingDate.
  // 4. Also checks utility logs (gas_reading_logs, hour_reading_logs) if not in readings table.
  // 5. If no reading exists at all before that date, return 0 for Previous Value and N/A for date.
  const fetchPreviousReadings = useCallback(async () => {
    if (meters.length === 0) return;
    setLoadingPrevious(true);

    const newRows: MeterRow[] = await Promise.all(
      meters.map(async (meter) => {
        let prevReading: { reading_value: number | string; reading_date: string } | null = null;

        // Branch of a split meter (Peak / Off-Peak): previous reading comes from its device logs
        if ((meter as any)._branch) {
          const { data: onOrBefore } = await supabase
            .from('energy_reading_logs')
            .select('reading_value, reading_date')
            .eq('device_id', meter.id)
            .lte('reading_date', selectedPreviousDate)
            .order('reading_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          let branchPrev = onOrBefore;
          if (!branchPrev) {
            const { data: beforeCurrent } = await supabase
              .from('energy_reading_logs')
              .select('reading_value, reading_date')
              .eq('device_id', meter.id)
              .lt('reading_date', currentReadingDate)
              .order('reading_date', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            branchPrev = beforeCurrent;
          }
          return {
            meter,
            previousReadingValue: branchPrev ? Number(branchPrev.reading_value) : 0,
            previousReadingDate: branchPrev ? branchPrev.reading_date : null,
            currentValue: '',
            readingId: null,
            isReset: false,
            originalPreviousValue: branchPrev ? Number(branchPrev.reading_value) : 0,
            originalPreviousDate: branchPrev ? branchPrev.reading_date : null,
          };
        }

        // 1. Try readings table on or before selectedPreviousDate
        const { data: readingData } = await supabase
          .from('readings')
          .select('*')
          .eq('meter_id', meter.id)
          .lte('reading_date', selectedPreviousDate)
          .order('reading_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (readingData) {
          prevReading = readingData;
        } else {
          // Fallback: check if any reading exists in readings before currentReadingDate
          const { data: beforeCurrent } = await supabase
            .from('readings')
            .select('*')
            .eq('meter_id', meter.id)
            .lt('reading_date', currentReadingDate)
            .order('reading_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (beforeCurrent) {
            prevReading = beforeCurrent;
          }
        }

        // 2. If still not found, check gas_reading_logs and hour_reading_logs
        if (!prevReading) {
          // Check gas_meter_devices / gas_reading_logs
          const { data: gasDevs } = await supabase
            .from('gas_meter_devices')
            .select('id')
            .eq('meter_id', meter.id);

          const devIds = (gasDevs || []).map((d) => d.id);
          if (devIds.length > 0) {
            const { data: gasLog } = await supabase
              .from('gas_reading_logs')
              .select('reading_value, reading_date')
              .in('device_id', devIds)
              .lte('reading_date', selectedPreviousDate)
              .order('reading_date', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (gasLog) {
              prevReading = gasLog;
            } else {
              const { data: fallbackGasLog } = await supabase
                .from('gas_reading_logs')
                .select('reading_value, reading_date')
                .in('device_id', devIds)
                .lt('reading_date', currentReadingDate)
                .order('reading_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fallbackGasLog) prevReading = fallbackGasLog;
            }
          }
        }

        if (!prevReading) {
          // Check hour_meter_devices / hour_reading_logs
          const { data: hourDevs } = await supabase
            .from('hour_meter_devices')
            .select('id')
            .eq('meter_id', meter.id);

          const devIds = (hourDevs || []).map((d) => d.id);
          if (devIds.length > 0) {
            const { data: hourLog } = await supabase
              .from('hour_reading_logs')
              .select('reading_value, reading_date')
              .in('device_id', devIds)
              .lte('reading_date', selectedPreviousDate)
              .order('reading_date', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (hourLog) {
              prevReading = hourLog;
            } else {
              const { data: fallbackHourLog } = await supabase
                .from('hour_reading_logs')
                .select('reading_value, reading_date')
                .in('device_id', devIds)
                .lt('reading_date', currentReadingDate)
                .order('reading_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fallbackHourLog) prevReading = fallbackHourLog;
            }
          }
        }

        return {
          meter,
          previousReadingValue: prevReading ? Number(prevReading.reading_value) : 0,
          previousReadingDate: prevReading ? prevReading.reading_date : null,
          currentValue: '',
          readingId: null,
          isReset: false,
          originalPreviousValue: prevReading ? Number(prevReading.reading_value) : 0,
          originalPreviousDate: prevReading ? prevReading.reading_date : null,
        };
      })
    );

    setRows(newRows);
    setSubmittedIds(new Set());
    setLoadingPrevious(false);
  }, [meters, selectedPreviousDate, currentReadingDate, supabase]);

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

  // Toggle reset baseline for a meter reading
  const handleToggleReset = (meterId: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.meter.id !== meterId) return r;
        const nextReset = !r.isReset;
        const origVal = r.originalPreviousValue ?? r.previousReadingValue;
        const origDate = r.originalPreviousDate ?? r.previousReadingDate;

        if (nextReset) {
          addToast(
            'info',
            `Resetting previous reading for "${r.meter.name}". Next reading will be saved as a new first reading (baseline). Past months data is preserved.`
          );
        } else {
          addToast('info', `Restored previous reading for "${r.meter.name}".`);
        }

        return {
          ...r,
          isReset: nextReset,
          originalPreviousValue: origVal,
          originalPreviousDate: origDate,
          previousReadingValue: nextReset ? 0 : origVal,
          previousReadingDate: nextReset ? null : origDate,
        };
      })
    );
  };

  // Calculate Consumption: Present (Current KWh) - Previous Value (null if reset / first reading)
  const getConsumption = (row: MeterRow): number | null => {
    if (row.isReset) return null;
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
    const isBranch = !!(row.meter as any)._branch;
    const result = isBranch
      ? row.readingId
        ? await updateBranchReading(row.readingId, {
            reading_value: val,
            reading_date: currentReadingDate,
            is_reset: row.isReset,
          })
        : await logBranchReading({
            device_id: row.meter.id,
            reading_value: val,
            reading_date: currentReadingDate,
            is_reset: row.isReset,
          })
      : row.readingId
      ? await updateReadingAction(row.readingId, {
          reading_value: val,
          reading_date: currentReadingDate,
          is_reset: row.isReset,
        })
      : await logReading({
          meter_id: row.meter.id,
          reading_value: val,
          reading_date: currentReadingDate,
          is_reset: row.isReset,
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

  // Save All: batch-save every row that has an unsaved, non-empty current value
  const handleSaveAll = async () => {
    // Collect rows that qualify: have a non-empty value AND are not already submitted
    const unsavedRows = rows.filter(
      (r) => r.currentValue.trim() !== '' && !submittedIds.has(r.meter.id)
    );

    if (unsavedRows.length === 0) {
      addToast('info', 'No unsaved readings to save.');
      return;
    }

    // Validate all qualifying rows first
    for (const row of unsavedRows) {
      const val = parseFloat(row.currentValue);
      if (isNaN(val) || val < 0) {
        addToast(
          'error',
          `Invalid reading for "${row.meter.name}". Must be a non-negative number. Fix it before using Save All.`
        );
        return;
      }
    }

    setSavingAll(true);
    // Mark all qualifying meters as saving
    setSavingIds((prev) => {
      const next = new Set(prev);
      unsavedRows.forEach((r) => next.add(r.meter.id));
      return next;
    });

    let successCount = 0;
    let failCount = 0;

    for (const row of unsavedRows) {
      const val = parseFloat(row.currentValue);
      const isBranch = !!(row.meter as any)._branch;

      const result = isBranch
        ? row.readingId
          ? await updateBranchReading(row.readingId, {
              reading_value: val,
              reading_date: currentReadingDate,
              is_reset: row.isReset,
            })
          : await logBranchReading({
              device_id: row.meter.id,
              reading_value: val,
              reading_date: currentReadingDate,
              is_reset: row.isReset,
            })
        : row.readingId
        ? await updateReadingAction(row.readingId, {
            reading_value: val,
            reading_date: currentReadingDate,
            is_reset: row.isReset,
          })
        : await logReading({
            meter_id: row.meter.id,
            reading_value: val,
            reading_date: currentReadingDate,
            is_reset: row.isReset,
          });

      if (result.success) {
        const newReadingId = (result as { readingId?: string }).readingId;
        setRows((prev) =>
          prev.map((r) =>
            r.meter.id === row.meter.id
              ? { ...r, readingId: newReadingId ?? r.readingId }
              : r
          )
        );
        setSubmittedIds((prev) => new Set(prev).add(row.meter.id));
        successCount++;
      } else {
        addToast('error', `${row.meter.name}: ${result.message}`);
        failCount++;
      }

      // Remove this meter from saving set
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.meter.id);
        return next;
      });
    }

    setSavingAll(false);

    if (successCount > 0) {
      addToast(
        'success',
        `Saved ${successCount} reading${successCount > 1 ? 's' : ''} successfully${failCount > 0 ? ` (${failCount} failed)` : ''}.`
      );
    }
  };

  // Unlock a saved row for editing again
  const handleEditRow = (meterId: string) => {
    setSubmittedIds((prev) => {
      const next = new Set(prev);
      next.delete(meterId);
      return next;
    });
  };

  const sectionTabs = useMemo(() => {
    const tabs: { id: string; label: string; badge: number }[] = [];
    sections.forEach((sec) => {
      const count = rows.filter((r) => r.meter.section_id === sec.id).length;
      if (count > 0) {
        tabs.push({
          id: sec.id,
          label: sec.name,
          badge: count,
        });
      }
    });
    const uncategorizedCount = rows.filter((r) => !r.meter.section_id).length;
    if (uncategorizedCount > 0) {
      tabs.push({
        id: '__uncategorized__',
        label: 'Uncategorized',
        badge: uncategorizedCount,
      });
    }
    return tabs;
  }, [sections, rows]);

  useEffect(() => {
    if (sectionTabs.length > 0) {
      if (!activeSectionId || !sectionTabs.some((t) => t.id === activeSectionId)) {
        setActiveSectionId(sectionTabs[0].id);
      }
    } else if (activeSectionId) {
      setActiveSectionId('');
    }
  }, [sectionTabs, activeSectionId]);

  const activeRows = useMemo(() => {
    const targetSectionId = activeSectionId || sectionTabs[0]?.id;
    if (!targetSectionId) {
      return rows;
    }
    if (targetSectionId === '__uncategorized__') {
      return rows.filter((r) => !r.meter.section_id);
    }
    return rows.filter((r) => r.meter.section_id === targetSectionId);
  }, [rows, activeSectionId, sectionTabs]);

  // Meter Groups for active section
  const incomingRows = activeRows.filter(
    (r) => r.meter.type === 'incoming' || r.meter.type === 'main'
  );
  const outgoingMainRows = activeRows.filter(
    (r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing'
  );
  const outgoingSubRows = activeRows.filter(
    (r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter'
  );
  const outgoingSubSubRows = activeRows.filter(
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
      { header: 'Previous Reading', key: 'prevReading', width: 15, style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
      { header: 'Current Date', key: 'currDate', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Current Reading', key: 'currReading', width: pxToColWidth(140), style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
      { header: 'Difference', key: 'difference', width: pxToColWidth(160), style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
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
          prevDate: row.isReset
            ? 'New Start'
            : row.previousReadingDate
            ? format(new Date(row.previousReadingDate), 'dd MMM yyyy')
            : 'N/A',
          prevReading: row.isReset ? 0 : row.previousReadingValue,
          currDate: format(new Date(currentReadingDate), 'dd MMM yyyy'),
          currReading: row.currentValue ? Number(row.currentValue) : '',
          difference: row.isReset ? '' : diff !== null ? diff : '',
        });
        dataRow.font = cambriaFont;
      }
    };

    if (sections.length > 0) {
      for (const sec of sections) {
        const secRows = rows.filter((r) => r.meter.section_id === sec.id);
        if (secRows.length === 0) continue;

        const domain = getSectionDomain(sec);

        if (domain === 'hour') {
          const compRows = secRows.filter((r) => getHourGroupKey(r.meter) === 'Compressor');
          const pumpRows = secRows.filter((r) => getHourGroupKey(r.meter) === 'Pump');
          const genRows = secRows.filter((r) => getHourGroupKey(r.meter) === 'Generator');
          const otherRows = secRows.filter((r) => getHourGroupKey(r.meter) === 'Other');

          addGroupRows(`${sec.name} - ${tierLabels.hour_compressor || 'Compressor'}`, compRows);
          addGroupRows(`${sec.name} - ${tierLabels.hour_pump || 'Pump'}`, pumpRows);
          addGroupRows(`${sec.name} - ${tierLabels.hour_generator || 'Generator'}`, genRows);
          addGroupRows(`${sec.name} - ${tierLabels.hour_other || 'Other Machinery'}`, otherRows);
          continue;
        }

        const secIncoming = secRows.filter((r) => r.meter.type === 'incoming' || r.meter.type === 'main');
        const secOutgoingMain = secRows.filter((r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing');
        const secOutgoingSub = secRows.filter((r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter');
        const secOutgoingSubSub = secRows.filter((r) => r.meter.type === 'outgoing_sub_sub');

        const getGroupLabel = domain === 'gas' ? getGasGroupLabel : getEnergyGroupLabel;

        addGroupRows(`${sec.name} - ${getGroupLabel('incoming', tierLabels)}`, secIncoming);
        addGroupRows(`${sec.name} - ${getGroupLabel('outgoing_main', tierLabels)}`, secOutgoingMain);
        addGroupRows(`${sec.name} - ${getGroupLabel('outgoing_sub', tierLabels)}`, secOutgoingSub);
        addGroupRows(`${sec.name} - ${getGroupLabel('outgoing_sub_sub', tierLabels)}`, secOutgoingSubSub);
      }

      // Uncategorized
      const uncategorized = rows.filter((r) => !r.meter.section_id);
      if (uncategorized.length > 0) {
        addGroupRows(`Other Meters - ${getEnergyGroupLabel('incoming', tierLabels)}`, uncategorized.filter((r) => r.meter.type === 'incoming' || r.meter.type === 'main'));
        addGroupRows(`Other Meters - ${getEnergyGroupLabel('outgoing_main', tierLabels)}`, uncategorized.filter((r) => r.meter.type === 'outgoing_main' || r.meter.type === 'outgoing'));
        addGroupRows(`Other Meters - ${getEnergyGroupLabel('outgoing_sub', tierLabels)}`, uncategorized.filter((r) => r.meter.type === 'outgoing_sub' || r.meter.type === 'submeter'));
        addGroupRows(`Other Meters - ${getEnergyGroupLabel('outgoing_sub_sub', tierLabels)}`, uncategorized.filter((r) => r.meter.type === 'outgoing_sub_sub'));
      }
    } else {
      addGroupRows(getEnergyGroupLabel('incoming', tierLabels), incomingRows);
      addGroupRows(getEnergyGroupLabel('outgoing_main', tierLabels), outgoingMainRows);
      addGroupRows(getEnergyGroupLabel('outgoing_sub', tierLabels), outgoingSubRows);
      addGroupRows(getEnergyGroupLabel('outgoing_sub_sub', tierLabels), outgoingSubSubRows);
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
    <div className="max-w-7xl mx-auto space-y-3.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-text-primary">Log Readings</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Select target Previous Reading Date &amp; Current Reading Date, then enter each Current Reading.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSaveAll}
            disabled={savingAll || rows.length === 0 || rows.every((r) => r.currentValue.trim() === '' || submittedIds.has(r.meter.id))}
            icon={
              savingAll ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              )
            }
          >
            {savingAll ? 'Saving...' : 'Save All'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportToExcel}
            disabled={rows.length === 0}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            }
          >
            Export to Excel
          </Button>
        </div>
      </div>

      {/* Sleek Dual Date Selector Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-[var(--radius-md)] bg-bg-surface border border-border/70 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Target Prev Date:
            </span>
            <input
              type="date"
              value={selectedPreviousDate}
              onChange={(e) => setSelectedPreviousDate(e.target.value)}
              className="h-7 px-2 py-0.5 rounded-[var(--radius-sm)] border border-border bg-bg-elevated text-text-primary text-xs font-medium focus:outline-none focus:border-accent"
              title="Fetches reading on or nearest before this date"
            />
          </div>

          <div className="hidden sm:block w-px h-4 bg-border/80" />

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Current Date:
            </span>
            <input
              type="date"
              value={currentReadingDate}
              onChange={(e) => setCurrentReadingDate(e.target.value)}
              className="h-7 px-2 py-0.5 rounded-[var(--radius-sm)] border border-border bg-bg-elevated text-text-primary text-xs font-medium focus:outline-none focus:border-accent"
              title="Date assigned to new readings"
            />
          </div>
        </div>

        <div className="text-[10px] text-text-muted font-medium">
          Auto-fetches closest preceding reading for each meter
        </div>
      </div>

      {/* Section Tabs */}
      {sectionTabs.length > 0 && (
        <Tabs
          tabs={sectionTabs}
          activeTab={activeSectionId || sectionTabs[0]?.id || ''}
          onChange={(id) => setActiveSectionId(id)}
          className="mb-1"
        />
      )}

      {/* Main Table View */}
      <div className="border border-border/80 rounded-[var(--radius-md)] bg-bg-elevated shadow-xs overflow-hidden">
        {loadingMeters || loadingPrevious ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-text-muted">Fetching previous readings...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <p className="text-xs">No meters configured yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-230px)] relative">
            <table className="w-full text-xs border-collapse table-fixed min-w-[760px]">
              <colgroup>
                <col className="w-[130px] sm:w-[170px]" />
                <col className="w-[85px]" />
                <col className="w-[110px]" />
                <col className="w-[85px]" />
                <col className="w-[130px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead className="sticky top-0 z-20 bg-table-header text-[10px] font-bold uppercase tracking-wider text-white border-b border-border select-none">
                <tr>
                  <th className="sticky left-0 z-30 bg-table-header px-2.5 py-1.5 text-left text-white">Meter Name</th>
                  <th className="px-1.5 py-1.5 text-center whitespace-nowrap text-white">Prev Date</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Previous Reading</th>
                  <th className="px-1.5 py-1.5 text-center whitespace-nowrap text-white">Current Date</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Current Reading</th>
                  <th className="px-2 py-1.5 text-right whitespace-nowrap text-white">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                      No meters found in this section.
                    </td>
                  </tr>
                ) : (
                  <>
                    {(() => {
                      const activeSec = sections.find((s) => s.id === activeSectionId);
                      const domain = getSectionDomain(activeSec);

                      if (domain === 'hour') {
                        const compRows = activeRows.filter((r) => getHourGroupKey(r.meter) === 'Compressor');
                        const pumpRows = activeRows.filter((r) => getHourGroupKey(r.meter) === 'Pump');
                        const genRows = activeRows.filter((r) => getHourGroupKey(r.meter) === 'Generator');
                        const otherRows = activeRows.filter((r) => getHourGroupKey(r.meter) === 'Other');

                        return (
                          <>
                            {renderGroup(tierLabels.hour_compressor || 'Compressor', 'accent', compRows)}
                            {renderGroup(tierLabels.hour_pump || 'Pump', 'warning', pumpRows)}
                            {renderGroup(tierLabels.hour_generator || 'Generator', 'success', genRows)}
                            {renderGroup(tierLabels.hour_other || 'Other Machinery', 'danger', otherRows)}
                          </>
                        );
                      }

                      const getGroupLabel = domain === 'gas' ? getGasGroupLabel : getEnergyGroupLabel;
                      return (
                        <>
                          {renderGroup(getGroupLabel('incoming', tierLabels), 'warning', incomingRows)}
                          {renderGroup(getGroupLabel('outgoing_main', tierLabels), 'accent', outgoingMainRows)}
                          {renderGroup(getGroupLabel('outgoing_sub', tierLabels), 'success', outgoingSubRows)}
                          {renderGroup(getGroupLabel('outgoing_sub_sub', tierLabels), 'danger', outgoingSubSubRows)}
                        </>
                      );
                    })()}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );

  function renderGroup(
    label: string,
    color: 'warning' | 'accent' | 'success' | 'danger',
    groupRows: MeterRow[]
  ) {
    if (groupRows.length === 0) return null;

    const colorClasses = {
      warning: 'bg-warning/10 border-warning/20 text-warning',
      accent: 'bg-accent/10 border-accent/20 text-accent',
      success: 'bg-success/10 border-success/20 text-success',
      danger: 'bg-danger/10 border-danger/20 text-danger',
    };
    const accentBorderClasses = {
      warning: 'border-l-3 border-l-warning',
      accent: 'border-l-3 border-l-accent',
      success: 'border-l-3 border-l-success',
      danger: 'border-l-3 border-l-danger',
    };

    return (
      <React.Fragment key={label}>
        <tr className={`${colorClasses[color]} border-y`}>
          <td colSpan={6} className={`px-2.5 py-1 text-center font-bold text-[10px] uppercase tracking-wider ${accentBorderClasses[color]}`}>
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
              className={`transition-colors border-b border-border/60 ${
                isSubmitted
                  ? 'bg-success/5 opacity-70'
                  : idx % 2 === 0
                  ? 'bg-bg-elevated hover:bg-bg-surface-hover/70'
                  : 'bg-bg-surface/40 hover:bg-bg-surface-hover/70'
              }`}
            >
              {/* Meter Name (Sticky Column) */}
              <td className="sticky left-0 z-10 bg-inherit px-2.5 py-1.5 text-xs border-r border-border/30">
                <div className="font-medium text-text-primary text-xs leading-tight truncate" title={row.meter.name}>
                  {row.meter.name}
                </div>
                {row.meter.location && (
                  <div className="text-[10px] text-text-muted truncate leading-none mt-0.5">
                    {row.meter.location}
                  </div>
                )}
              </td>

              {/* Previous Reading Date */}
              <td className="px-1.5 py-1.5 text-center text-text-muted text-xs whitespace-nowrap">
                {row.isReset ? (
                  <span className="text-[10px] font-semibold text-warning">New Start</span>
                ) : row.previousReadingDate ? (
                  format(new Date(row.previousReadingDate), 'dd MMM yyyy')
                ) : (
                  'N/A'
                )}
              </td>

              {/* Previous Reading */}
              <td className="px-2 py-1.5 text-right tabular-nums text-xs">
                {row.isReset ? (
                  <div className="flex flex-col items-end gap-0.5">
                    {row.originalPreviousValue !== undefined && row.originalPreviousValue > 0 && (
                      <span className="text-[10px] text-text-muted/70 line-through tabular-nums leading-none">
                        {formatReadingValue(row.originalPreviousValue)}
                      </span>
                    )}
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-semibold text-warning text-xs tabular-nums">
                        0.00
                      </span>
                      {!isSubmitted && (
                        <button
                          type="button"
                          onClick={() => handleToggleReset(row.meter.id)}
                          title="Undo reset and restore previous reading"
                          className="w-5 h-5 inline-flex items-center justify-center rounded text-warning bg-warning/15 hover:bg-warning/25 transition-colors cursor-pointer select-none"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-medium text-text-primary tabular-nums">
                      {formatReadingValue(row.previousReadingValue)}
                    </span>
                    {!isSubmitted && (
                      <button
                        type="button"
                        onClick={() => handleToggleReset(row.meter.id)}
                        title="Reset previous reading"
                        className="w-5 h-5 inline-flex items-center justify-center rounded text-text-muted hover:text-warning hover:bg-warning/10 transition-colors cursor-pointer select-none"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </td>

              {/* Current Reading Date */}
              <td className="px-1.5 py-1.5 text-center text-text-secondary text-xs whitespace-nowrap font-medium">
                {format(new Date(currentReadingDate), 'dd MMM yyyy')}
              </td>

              {/* Current Reading Input + Save / Edit */}
              <td className="px-1.5 py-1 text-xs">
                {isSubmitted ? (
                  <div className="w-full flex items-center justify-end gap-1.5">
                    <span className="flex-1 min-w-0 text-right font-bold text-success text-xs tabular-nums">
                      {formatReadingValue(parseFloat(row.currentValue))}
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => handleEditRow(row.meter.id)}
                        title="Edit reading"
                        className="flex-shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                          text-text-muted hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    ) : (
                      <div className="flex-shrink-0 w-5 h-5" />
                    )}
                  </div>
                ) : (
                  <div className="w-full flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="Reading"
                      value={row.currentValue}
                      onChange={(e) => updateCurrentValue(row.meter.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveRow(row.meter.id);
                        }
                      }}
                      disabled={isSaving}
                      className="flex-1 min-w-0 h-6 px-2 py-0.5 rounded-[var(--radius-sm)] border border-border bg-bg-primary text-text-primary text-right font-semibold tabular-nums text-xs
                        focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent
                        placeholder:text-text-muted/50 placeholder:font-normal
                        disabled:opacity-50
                        transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRow(row.meter.id)}
                      disabled={isSaving || !row.currentValue.trim()}
                      title="Save reading"
                      className="flex-shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-[var(--radius-sm)]
                        bg-success/15 text-success hover:bg-success/25 border border-success/30
                        disabled:opacity-30 disabled:cursor-not-allowed
                        transition-colors cursor-pointer"
                    >
                      {isSaving ? (
                        <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </td>

              {/* Difference: Current Reading - Previous Reading */}
              <td className="px-2 py-1.5 text-right tabular-nums text-xs font-semibold">
                {row.isReset ? (
                  <span className="inline-flex items-center text-[10px] font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded border border-warning/20">
                    First reading
                  </span>
                ) : difference !== null ? (
                  <span
                    className={`${
                      isNegative ? 'text-danger' : 'text-accent'
                    }`}
                  >
                    {formatReadingValue(difference)}
                  </span>
                ) : (
                  <span className="text-text-muted text-xs">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </React.Fragment>
    );
  }
}
