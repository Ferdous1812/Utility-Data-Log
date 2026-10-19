'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { HourEquipmentGroup } from '@/types/hour';

// ─── Auth Helpers ───────────────────────────────────────────

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('You must be logged in.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') throw new Error('Only admins can perform this action.');

  return { supabase, user };
}

async function requireAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('You must be logged in.');

  return { supabase, user };
}

// ─── Hour Meter CRUD ────────────────────────────────────────

export async function addHourMeter(formData: {
  name: string;
  equipment_group: HourEquipmentGroup;
  category?: string;
  multiplication_factor?: number;
}): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from('hour_meters')
      .insert({
        name: formData.name.trim(),
        equipment_group: formData.equipment_group,
        category: (formData.category || formData.equipment_group).trim(),
        multiplication_factor: formData.multiplication_factor ?? 1.0,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      return { success: false, message: `Failed to add hour meter: ${error.message}` };
    }

    // Create default checkpoint device
    await supabase.from('hour_meter_devices').insert({
      meter_id: data.id,
      checkpoint_label: 'Primary Meter',
      is_billing_primary: true,
    });

    revalidatePath('/hour-meters');
    return { success: true, message: `Hour meter "${formData.name}" added!`, id: data.id };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateHourMeterQuickAction(
  id: string,
  formData: {
    name: string;
    equipment_group?: HourEquipmentGroup;
    category?: string;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      return { success: false, message: 'Meter name cannot be empty.' };
    }

    const payload: { name: string; equipment_group?: HourEquipmentGroup; category?: string } = {
      name: trimmedName,
    };
    if (formData.equipment_group) {
      payload.equipment_group = formData.equipment_group;
      payload.category = formData.category || formData.equipment_group;
    }

    const { error } = await supabase
      .from('hour_meters')
      .update(payload)
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to update: ${error.message}` };
    }

    revalidatePath('/hour-meters');
    return { success: true, message: `Meter "${trimmedName}" updated!` };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function deleteHourMeter(
  id: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error } = await supabase
      .from('hour_meters')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to delete: ${error.message}` };
    }

    revalidatePath('/hour-meters');
    return { success: true, message: 'Hour meter removed.' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Include / Exclude in Hour System ───────────────────────

export async function toggleMeterInHourAction(
  meterId: string,
  enable: boolean
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (enable) {
      // Get meter info from meters table
      const { data: meter, error: meterErr } = await supabase
        .from('meters')
        .select(`
          id,
          name,
          multiplication_factor,
          section:meter_sections(name)
        `)
        .eq('id', meterId)
        .single();

      if (meterErr || !meter) {
        return { success: false, message: 'Meter not found.' };
      }

      // Infer equipment group
      const n = (meter.name || '').toLowerCase();
      let grp: HourEquipmentGroup = 'Other';
      if (n.includes('compressor') || n.includes('comp') || n.includes('screw')) grp = 'Compressor';
      else if (n.includes('pump') || n.includes('water') || n.includes('booster')) grp = 'Pump';
      else if (n.includes('generator') || n.includes('gen') || n.includes('dg')) grp = 'Generator';

      const { error: upsertErr } = await supabase.from('hour_meters').upsert({
        id: meter.id,
        name: meter.name,
        equipment_group: grp,
        category: grp,
        multiplication_factor: meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1,
        is_active: true,
      }, { onConflict: 'id' });

      if (upsertErr) {
        return { success: false, message: `Failed to include meter: ${upsertErr.message}` };
      }

      // Check for device
      const { count } = await supabase
        .from('hour_meter_devices')
        .select('*', { count: 'exact', head: true })
        .eq('meter_id', meter.id);

      if (!count || count === 0) {
        await supabase.from('hour_meter_devices').insert({
          meter_id: meter.id,
          checkpoint_label: 'Primary Meter',
          is_billing_primary: true,
        });
      }

      revalidatePath('/hour-meters');
      return { success: true, message: `"${meter.name}" included in Hour Meters!` };
    } else {
      await supabase.from('hour_meters').update({ is_active: false }).eq('id', meterId);
      revalidatePath('/hour-meters');
      return { success: true, message: 'Meter excluded from Hour Meters.' };
    }
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}
