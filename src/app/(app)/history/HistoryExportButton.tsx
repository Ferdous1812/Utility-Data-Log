'use client';

import React, { useCallback } from 'react';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { getTypeLabel } from './HistoryFilters';
import type { Reading, Meter, Profile, MeterSection } from '@/lib/types';

interface HistoryExportButtonProps {
  readings: (Reading & { meter: Meter; profile: Profile })[];
  sections: MeterSection[];
}

export function HistoryExportButton({ readings, sections }: HistoryExportButtonProps) {
  const { addToast } = useToast();

  const handleExport = useCallback(async () => {
    if (readings.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reading History');

    // Page setup — matched to the Log Reading export.
    worksheet.pageSetup.paperSize = 9; // A4
    worksheet.pageSetup.orientation = 'landscape';
    worksheet.pageSetup.fitToPage = true;
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 0;
    worksheet.pageSetup.horizontalCentered = true;
    worksheet.pageSetup.printTitlesRow = '1:1';
    worksheet.pageSetup.margins = {
      left: 0.25, right: 0.25,
      top: 0.85, bottom: 0.5,
      header: 0.1, footer: 0.1,
    };

    worksheet.headerFooter.oddHeader =
      '&C&"Cambria,Bold"&14ACI Formulations PLC\n' +
      '&"Cambria,Regular"&11Rajabari, Sreepur, Gazipur\n' +
      '&"Cambria,Bold"&11Meter Reading History';
    worksheet.headerFooter.evenHeader = worksheet.headerFooter.oddHeader;
    worksheet.headerFooter.oddFooter = '&C&"Cambria,Regular"&9Page &P of &N';
    worksheet.headerFooter.evenFooter = worksheet.headerFooter.oddFooter;

    const cambriaFont = { name: 'Cambria', size: 11 };
    const pxToColWidth = (px: number) => Number(((px - 5) / 7).toFixed(2));

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 16, style: { alignment: { horizontal: 'center' } } },
      { header: 'Meter Name', key: 'meterName', width: 24 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Previous Reading', key: 'prevReading', width: pxToColWidth(140), style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
      { header: 'Current Reading', key: 'currReading', width: pxToColWidth(140), style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
      { header: 'Difference', key: 'consumed', width: pxToColWidth(140), style: { alignment: { horizontal: 'right' }, numFmt: '0.00' } },
      { header: 'Logged By', key: 'loggedBy', width: 20 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { ...cambriaFont, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    const addGroupRows = (sectionName: string, rows: typeof readings) => {
      if (rows.length === 0) return;

      if (sectionName) {
        const sectionRow = worksheet.addRow([sectionName]);
        worksheet.mergeCells(`A${sectionRow.number}:G${sectionRow.number}`);
        sectionRow.font = { ...cambriaFont, bold: true, size: 12 };
        sectionRow.alignment = { horizontal: 'center', vertical: 'middle' };
        for (let i = 1; i <= 7; i++) {
          sectionRow.getCell(i).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' },
          };
        }
      }

      for (const r of rows) {
        const prevValue = r.usage != null ? Number(r.reading_value) - Number(r.usage) : null;
        const dataRow = worksheet.addRow({
          date: format(new Date(r.reading_date), 'dd MMM yyyy'),
          meterName: r.meter?.name || '—',
          location: r.meter?.location || '',
          prevReading: prevValue != null ? prevValue : '',
          currReading: Number(r.reading_value),
          consumed: r.usage != null ? Number(r.usage) : '',
          loggedBy: r.profile?.full_name || '—',
        });
        dataRow.font = cambriaFont;
      }
    };

    // Same grouping sequence as Settings / Log Reading: walk sections in
    // sort_order, then Incoming → Outgoing (Main) → Outgoing (Sub) → Sub of
    // Sub within each, followed by an Uncategorized group.
    const byType = (rows: typeof readings, type: string) =>
      rows.filter((r) => getTypeLabel(r.meter?.type || '') === type);

    const groupBySectionThenType = (rows: typeof readings, label: string) => {
      addGroupRows(label, byType(rows, 'Incoming'));
      addGroupRows(label, byType(rows, 'Outgoing (Main)'));
      addGroupRows(label, byType(rows, 'Outgoing (Sub)'));
      addGroupRows(label, byType(rows, 'Sub of Sub'));
    };

    if (sections.length > 0) {
      for (const sec of sections) {
        const secRows = readings.filter((r) => r.meter?.section_id === sec.id);
        if (secRows.length === 0) continue;
        groupBySectionThenType(secRows, sec.name);
      }
      const uncategorized = readings.filter((r) => !r.meter?.section_id);
      if (uncategorized.length > 0) {
        groupBySectionThenType(uncategorized, 'Uncategorized');
      }
    } else {
      groupBySectionThenType(readings, '');
    }

    worksheet.columns.forEach((column) => {
      if (column.key === 'prevReading' || column.key === 'currReading' || column.key === 'consumed') return;
      let maxLength = 0;
      column.eachCell!({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 10;
        if (len > maxLength) maxLength = len;
      });
      column.width = maxLength < 10 ? 10 : maxLength + 2;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reading_History_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    addToast('success', 'Reading history exported to Excel successfully!');
  }, [readings, sections, addToast]);

  return (
    <Button
      variant="outline"
      size="md"
      onClick={handleExport}
      disabled={readings.length === 0}
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
  );
}
