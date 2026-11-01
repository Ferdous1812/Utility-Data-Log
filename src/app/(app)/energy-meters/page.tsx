import { redirect } from 'next/navigation';

export default async function EnergyMetersPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const q = new URLSearchParams();
  q.set('tab', 'energy');
  if (month) q.set('month', month);
  redirect(`/consumption?${q.toString()}`);
}
