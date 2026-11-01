import { format, subDays } from 'date-fns';
import {
  getEnergyMeters,
  getEnergyMeterDevices,
  getEnergyReadingLogs,
  getLatestReadingsPerDevice,
  getAvailableMetersForEnergy,
} from '@/lib/energyQueries';
import {
  getGasMeters,
  getGasMeterDevices,
  getGasReadingLogs,
  getPriorGasReadings,
  getAvailableMetersForGas,
} from '@/lib/gasQueries';
import {
  getHourMeters,
  getHourMeterDevices,
  getHourReadingLogs,
  getPriorHourReadings,
  getAvailableMetersForHour,
} from '@/lib/hourQueries';
import { ConsumptionClient } from './ConsumptionClient';

export default async function ConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const { month, tab } = await searchParams;
  const currentMonthStr = format(new Date(), 'yyyy-MM');
  const targetMonth = month && month.includes('-') ? month : currentMonthStr;

  const [y, m] = targetMonth.split('-');
  const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  const priorCutoff = format(subDays(monthDate, 1), 'yyyy-MM-dd');

  const [
    energyMeters,
    energyDevices,
    energyLogs,
    energyPriorReadings,
    energyAvailableMeters,
    gasMeters,
    gasDevices,
    gasLogs,
    gasPriorReadings,
    gasAvailableMeters,
    hourMeters,
    hourDevices,
    hourLogs,
    hourPriorReadings,
    hourAvailableMeters,
  ] = await Promise.all([
    getEnergyMeters(),
    getEnergyMeterDevices(),
    getEnergyReadingLogs({ month: targetMonth }),
    getLatestReadingsPerDevice(priorCutoff),
    getAvailableMetersForEnergy(),

    getGasMeters(),
    getGasMeterDevices(),
    getGasReadingLogs({ month: targetMonth }),
    getPriorGasReadings(priorCutoff),
    getAvailableMetersForGas(),

    getHourMeters(),
    getHourMeterDevices(),
    getHourReadingLogs({ month: targetMonth }),
    getPriorHourReadings(priorCutoff),
    getAvailableMetersForHour(),
  ]);

  return (
    <ConsumptionClient
      selectedMonth={targetMonth}
      initialTab={tab}
      energy={{
        meters: energyMeters,
        devices: energyDevices,
        logs: energyLogs,
        priorReadings: energyPriorReadings,
        availableMeters: energyAvailableMeters,
      }}
      gas={{
        meters: gasMeters,
        devices: gasDevices,
        logs: gasLogs,
        priorReadings: gasPriorReadings,
        availableMeters: gasAvailableMeters,
      }}
      hour={{
        meters: hourMeters,
        devices: hourDevices,
        logs: hourLogs,
        priorReadings: hourPriorReadings,
        availableMeters: hourAvailableMeters,
      }}
    />
  );
}
