import { redirect } from 'next/navigation';

export default async function GasMetersPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const q = new URLSearchParams();
  q.set('tab', 'gas');
  if (month) q.set('month', month);
  redirect(`/consumption?${q.toString()}`);
}
