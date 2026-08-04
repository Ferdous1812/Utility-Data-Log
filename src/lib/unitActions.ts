'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ─── Add a Unit ───
export async function addUnit(name: string): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return { success: false, message: 'Only admins can manage units.' };
  }

  if (!name.trim()) {
    return { success: false, message: 'Unit name cannot be empty.' };
  }

  // Get max sort_order
  const { data: maxRes } = await supabase
    .from('units')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = maxRes ? (maxRes.sort_order || 0) + 1 : 1;

  const { error } = await supabase.from('units').insert({
    name: name.trim(),
    sort_order: nextOrder,
  });

  if (error) {
    console.error('Error adding unit:', error);
    return { success: false, message: `Failed to add unit: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: `Unit "${name}" added successfully!` };
}

// ─── Delete a Unit ───
export async function deleteUnit(id: string): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return { success: false, message: 'Only admins can delete units.' };
  }

  const { error } = await supabase.from('units').delete().eq('id', id);

  if (error) {
    console.error('Error deleting unit:', error);
    return { success: false, message: `Failed to delete unit: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Unit deleted successfully!' };
}

// ─── Update Allocations for a Unit ───
export async function updateUnitAllocations(
  unitId: string,
  allocations: { meter_id: string; percentage: number }[]
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return { success: false, message: 'Only admins can update allocations.' };
  }

  // 1. Delete existing allocations for this unit
  const { error: deleteError } = await supabase
    .from('unit_allocations')
    .delete()
    .eq('unit_id', unitId);

  if (deleteError) {
    console.error('Error deleting old allocations:', deleteError);
    return { success: false, message: `Failed to update allocations: ${deleteError.message}` };
  }

  if (allocations.length === 0) {
    revalidatePath('/dashboard');
    revalidatePath('/settings');
    return { success: true, message: 'Allocations updated successfully!' };
  }

  // 2. Insert new allocations
  const insertRows = allocations.map((a) => ({
    unit_id: unitId,
    meter_id: a.meter_id,
    percentage: a.percentage,
  }));

  const { error: insertError } = await supabase
    .from('unit_allocations')
    .insert(insertRows);

  if (insertError) {
    console.error('Error inserting allocations:', insertError);
    return { success: false, message: `Failed to save new allocations: ${insertError.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Allocations saved successfully!' };
}

// ─── Shared validation for a Calculated Remainder Rule payload ───
function validateRemainderRulePayload(rule: {
  base_source_meter_id: string;
  deduction_meter_ids: string[];
  remainder_share_percent: number;
}): string | null {
  if (!rule.base_source_meter_id) {
    return 'A Base Source meter is required.';
  }
  if (
    Number.isNaN(rule.remainder_share_percent) ||
    rule.remainder_share_percent < 0 ||
    rule.remainder_share_percent > 100
  ) {
    return 'Remainder Share % must be between 0 and 100.';
  }
  return null;
}

async function requireAdmin(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, message: 'You must be logged in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return { ok: false, message: 'Only admins can update allocations.' };
  }

  return { ok: true, supabase };
}

// ─── Add a new Calculated Remainder Rule to a Unit ───
// A unit can hold multiple remainder rules (e.g. one per shared/unmetered
// feed), alongside any Direct Assignment rows — the two engines combine.
// unit_share = (base_source_meter - SUM(deduction meters)) * remainder_share_percent
export async function addUnitRemainderRule(
  unitId: string,
  rule: {
    base_source_meter_id: string;
    deduction_meter_ids: string[];
    remainder_share_percent: number;
  }
): Promise<{ success: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, message: auth.message };
  const { supabase } = auth;

  const validationError = validateRemainderRulePayload(rule);
  if (validationError) return { success: false, message: validationError };

  const { error } = await supabase.from('unit_remainder_rules').insert({
    unit_id: unitId,
    base_source_meter_id: rule.base_source_meter_id,
    deduction_meter_ids: rule.deduction_meter_ids,
    remainder_share_percent: rule.remainder_share_percent,
  });

  if (error) {
    console.error('Error adding remainder rule:', error);
    return { success: false, message: `Failed to add rule: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Calculated Remainder rule added successfully!' };
}

// ─── Update an existing Calculated Remainder Rule by its own id ───
export async function updateUnitRemainderRule(
  ruleId: string,
  rule: {
    base_source_meter_id: string;
    deduction_meter_ids: string[];
    remainder_share_percent: number;
  }
): Promise<{ success: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, message: auth.message };
  const { supabase } = auth;

  const validationError = validateRemainderRulePayload(rule);
  if (validationError) return { success: false, message: validationError };

  const { error } = await supabase
    .from('unit_remainder_rules')
    .update({
      base_source_meter_id: rule.base_source_meter_id,
      deduction_meter_ids: rule.deduction_meter_ids,
      remainder_share_percent: rule.remainder_share_percent,
    })
    .eq('id', ruleId);

  if (error) {
    console.error('Error updating remainder rule:', error);
    return { success: false, message: `Failed to save rule: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Calculated Remainder rule saved successfully!' };
}

// ─── Delete a single Calculated Remainder Rule by its own id ───
export async function deleteUnitRemainderRule(
  ruleId: string
): Promise<{ success: boolean; message: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, message: auth.message };
  const { supabase } = auth;

  const { error } = await supabase.from('unit_remainder_rules').delete().eq('id', ruleId);

  if (error) {
    console.error('Error deleting remainder rule:', error);
    return { success: false, message: `Failed to delete rule: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Remainder rule deleted.' };
}

// ─── Update Sorting Order of Units ───
export async function updateUnitsOrder(
  orderedIds: string[]
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return { success: false, message: 'Only admins can manage unit order.' };
  }

  // Update sort_order for each unit
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('units')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);

    if (error) {
      console.error(`Error updating sort_order for unit ${orderedIds[i]}:`, error);
      return { success: false, message: `Failed to save new order: ${error.message}` };
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');
  revalidatePath('/consumption');

  return { success: true, message: 'Unit order updated successfully!' };
}
