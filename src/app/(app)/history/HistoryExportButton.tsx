'use client';

import React, { useCallback } from 'react';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Reading, Meter, Profile, MeterSection } from '@/lib/types';
import { useTierLabels, getEnergyGroupLabel, getGasGroupLabel, getSectionDomain, getHourGroupKey } from '@/lib/useTierLabels';

interface HistoryExportButtonProps {
  readings: (Reading & { meter: Meter; profile: Profile })[];
  sections: MeterSection[];
}

export function HistoryExportButton({ readings, sections }: HistoryExportButtonProps) {
  const { addToast } = useToast();
  const tierLabels = useTierLabels();

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

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const nextOlder = rows.slice(i + 1).find((other) => other.meter_id === r.meter_id);
        const prevValue =
          r.is_reset
            ? null
            : r.usage != null
            ? Number(r.reading_value) - Number(r.usage)
            : nextOlder
            ? Number(nextOlder.reading_value)
            : null;
        const dataRow = worksheet.addRow({
          date: format(new Date(r.reading_date), 'dd MMM yyyy'),
          meterName: r.meter?.name || '—',
          location: r.meter?.location || '',
          prevReading: r.is_reset ? 0 : prevValue != null ? prevValue : '',
          currReading: Number(r.reading_value),
          consumed: r.is_reset ? '' : r.usage != null ? Number(r.usage) : '',
          loggedBy: r.profile?.full_name || '—',
        });
        dataRow.font = cambriaFont;
      }
    };

    // Grouping sequence matched to Settings & Log Reading using configured tier labels
    const isIncoming = (t?: string) => t === 'incoming' || t === 'main';
    const isOutgoingMain = (t?: string) => t === 'outgoing_main' || t === 'outgoing';
    const isOutgoingSub = (t?: string) => t === 'outgoing_sub' || t === 'submeter';
    const isOutgoingSubSub = (t?: string) => t === 'outgoing_sub_sub';

    const groupBySectionThenType = (rows: typeof readings, label: string, section?: MeterSection) => {
      const domain = getSectionDomain(section);
      const prefix = label ? `${label} - ` : '';

      if (domain === 'hour') {
        const comp = rows.filter((r) => getHourGroupKey(r.meter) === 'Compressor');
        const pump = rows.filter((r) => getHourGroupKey(r.meter) === 'Pump');
        const gen = rows.filter((r) => getHourGroupKey(r.meter) === 'Generator');
        const other = rows.filter((r) => getHourGroupKey(r.meter) === 'Other');

        addGroupRows(`${prefix}${tierLabels.hour_compressor || 'Compressor'}`, comp);
        addGroupRows(`${prefix}${tierLabels.hour_pump || 'Pump'}`, pump);
        addGroupRows(`${prefix}${tierLabels.hour_generator || 'Generator'}`, gen);
        addGroupRows(`${prefix}${tierLabels.hour_other || 'Other Machinery'}`, other);
        return;
      }

      const getGroup = domain === 'gas' ? getGasGroupLabel : getEnergyGroupLabel;

      addGroupRows(`${prefix}${getGroup('incoming', tierLabels)}`, rows.filter((r) => isIncoming(r.meter?.type)));
      addGroupRows(`${prefix}${getGroup('outgoing_main', tierLabels)}`, rows.filter((r) => isOutgoingMain(r.meter?.type)));
      addGroupRows(`${prefix}${getGroup('outgoing_sub', tierLabels)}`, rows.filter((r) => isOutgoingSub(r.meter?.type)));
      addGroupRows(`${prefix}${getGroup('outgoing_sub_sub', tierLabels)}`, rows.filter((r) => isOutgoingSubSub(r.meter?.type)));
    };

    if (sections.length > 0) {
      for (const sec of sections) {
        const secRows = readings.filter((r) => r.meter?.section_id === sec.id);
        if (secRows.length === 0) continue;
        groupBySectionThenType(secRows, sec.name, sec);
      }
      const uncategorized = readings.filter((r) => !r.meter?.section_id);
      if (uncategorized.length > 0) {
        groupBySectionThenType(uncategorized, 'Other Meters');
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
  }, [readings, sections, tierLabels, addToast]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={readings.length === 0}
      className="text-xs"
      icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      }
    >
      Export Excel
    </Button>
  );
}
