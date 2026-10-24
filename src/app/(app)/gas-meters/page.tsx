import { format, subDays, subMonths } from 'date-fns';
import {
  getGasMeters,
  getGasMeterDevices,
  getGasReadingLogs,
  getPriorGasReadings,
  getAvailableMetersForGas,
} from '@/lib/gasQueries';
import { toggleMeterInGasAction } from '@/lib/gasActions';
import { GenericMetersClient } from '@/components/meters/GenericMetersClient';

export default async function GasMetersPage({
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
    getGasMeters(),
    getGasMeterDevices(),
    getGasReadingLogs({ month: targetMonth }),
    getPriorGasReadings(priorCutoff),
    getAvailableMetersForGas(),
  ]);

  return (
    <GenericMetersClient
      meters={meters}
      devices={devices}
      logs={logs}
      priorReadings={priorReadings}
      availableMeters={availableMeters}
      selectedMonth={targetMonth}
      routePath="/gas-meters"
      onToggle={toggleMeterInGasAction}
      config={{
        unitLabel: 'm³',
        unitSymbol: 'm³',
        pageTitle: 'Gas Meters',
        consumptionLabel: 'Volume',
      }}
    />
  );
}
