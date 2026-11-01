import { redirect } from 'next/navigation';

export default async function HourMetersPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const q = new URLSearchParams();
  q.set('tab', 'hour');
  if (month) q.set('month', month);
  redirect(`/consumption?${q.toString()}`);
}
