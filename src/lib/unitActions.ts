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

  // Saving Direct Assignment rows always confirms the unit is in "direct"
  // mode, and clears out any leftover Calculated Remainder rule.
  const { error: modeError } = await supabase
    .from('units')
    .update({ allocation_mode: 'direct' })
    .eq('id', unitId);

  if (modeError) {
    console.error('Error updating allocation mode:', modeError);
    return { success: false, message: `Failed to update allocations: ${modeError.message}` };
  }

  await supabase.from('unit_remainder_rules').delete().eq('unit_id', unitId);

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

// ─── Save a Calculated Remainder Rule for a Unit ───
// unit_share = (base_source_meter - SUM(deduction meters)) * remainder_share_percent
export async function updateUnitRemainderRule(
  unitId: string,
  rule: {
    base_source_meter_id: string;
    deduction_meter_ids: string[];
    remainder_share_percent: number;
  }
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

  if (!rule.base_source_meter_id) {
    return { success: false, message: 'A Base Source meter is required.' };
  }

  if (
    Number.isNaN(rule.remainder_share_percent) ||
    rule.remainder_share_percent < 0 ||
    rule.remainder_share_percent > 100
  ) {
    return { success: false, message: 'Remainder Share % must be between 0 and 100.' };
  }

  // Switching a unit into "calculated_remainder" mode clears any legacy
  // flat percentage rows so the two engines never overlap for one unit.
  const { error: modeError } = await supabase
    .from('units')
    .update({ allocation_mode: 'calculated_remainder' })
    .eq('id', unitId);

  if (modeError) {
    console.error('Error updating allocation mode:', modeError);
    return { success: false, message: `Failed to update allocation mode: ${modeError.message}` };
  }

  const { error: clearError } = await supabase
    .from('unit_allocations')
    .delete()
    .eq('unit_id', unitId);

  if (clearError) {
    console.error('Error clearing direct allocations:', clearError);
    return { success: false, message: `Failed to save rule: ${clearError.message}` };
  }

  const { error: upsertError } = await supabase
    .from('unit_remainder_rules')
    .upsert(
      {
        unit_id: unitId,
        base_source_meter_id: rule.base_source_meter_id,
        deduction_meter_ids: rule.deduction_meter_ids,
        remainder_share_percent: rule.remainder_share_percent,
      },
      { onConflict: 'unit_id' }
    );

  if (upsertError) {
    console.error('Error saving remainder rule:', upsertError);
    return { success: false, message: `Failed to save rule: ${upsertError.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Calculated Remainder rule saved successfully!' };
}

// ─── Switch a Unit back to Direct Assignment mode ───
export async function updateUnitAllocationMode(
  unitId: string,
  mode: 'direct' | 'calculated_remainder'
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

  const { error } = await supabase.from('units').update({ allocation_mode: mode }).eq('id', unitId);

  if (error) {
    console.error('Error updating allocation mode:', error);
    return { success: false, message: `Failed to switch mode: ${error.message}` };
  }

  // Clear the other engine's data for this unit so stale rows never
  // silently resurface if the operator switches modes again later.
  if (mode === 'direct') {
    await supabase.from('unit_remainder_rules').delete().eq('unit_id', unitId);
  } else {
    await supabase.from('unit_allocations').delete().eq('unit_id', unitId);
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings');

  return { success: true, message: 'Allocation mode updated.' };
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
