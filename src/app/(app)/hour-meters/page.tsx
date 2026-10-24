import { format, subDays, subMonths } from 'date-fns';
import {
  getHourMeters,
  getHourMeterDevices,
  getHourReadingLogs,
  getPriorHourReadings,
  getAvailableMetersForHour,
} from '@/lib/hourQueries';
import { HourMetersClient } from '@/components/meters/HourMetersClient';

export default async function HourMetersPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const defaultMonthStr = format(subMonths(new Date(), 1), 'yyyy-MM');
  const targetMonth = month && month.includes('-') ? month : defaultMonthStr;

  const [y, m] = targetMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const priorCutoff = format(subDays(monthDate, 1), 'yyyy-MM-dd');

  const [meters, devices, logs, priorReadings, availableMeters] = await Promise.all([
    getHourMeters(),
    getHourMeterDevices(),
    getHourReadingLogs({ month: targetMonth }),
    getPriorHourReadings(priorCutoff),
    getAvailableMetersForHour(),
  ]);

  return (
    <HourMetersClient
      meters={meters}
      devices={devices}
      logs={logs}
      priorReadings={priorReadings}
      availableMeters={availableMeters}
      selectedMonth={targetMonth}
    />
  );
}
