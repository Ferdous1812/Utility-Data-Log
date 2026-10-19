'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ─── Helpers ────────────────────────────────────────────────

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

// ─── Energy Meter CRUD ──────────────────────────────────────

export async function addEnergyMeter(formData: {
  name: string;
  section: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub';
  category: string;
  parent_id?: string | null;
  multiplication_factor?: number;
  is_primary_for_total?: boolean;
}): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from('energy_meters')
      .insert({
        name: formData.name.trim(),
        section: formData.section,
        category: formData.category.trim() || 'General',
        parent_id: formData.parent_id || null,
        multiplication_factor: formData.multiplication_factor ?? 1.0,
        is_primary_for_total: formData.is_primary_for_total ?? true,
      })
      .select('id')
      .single();

    if (error) {
      return { success: false, message: `Failed to add energy meter: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    revalidatePath('/hour-meters');
    revalidatePath('/gas-meters');
    return { success: true, message: `Energy meter "${formData.name}" added!`, id: data.id };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateEnergyMeter(
  id: string,
  formData: {
    name: string;
    section: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub';
    category: string;
    parent_id?: string | null;
    multiplication_factor?: number;
    is_primary_for_total?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error } = await supabase
      .from('energy_meters')
      .update({
        name: formData.name.trim(),
        section: formData.section,
        category: formData.category.trim() || 'General',
        parent_id: formData.parent_id || null,
        multiplication_factor: formData.multiplication_factor ?? 1.0,
        is_primary_for_total: formData.is_primary_for_total ?? true,
      })
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to update: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    revalidatePath('/hour-meters');
    revalidatePath('/gas-meters');
    return { success: true, message: `Energy meter "${formData.name}" updated!` };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateEnergyMeterQuickAction(
  id: string,
  formData: {
    name: string;
    is_primary_for_total?: boolean;
    category?: string;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      return { success: false, message: 'Meter name cannot be empty.' };
    }

    const updatePayload: { name: string; is_primary_for_total?: boolean; category?: string } = {
      name: trimmedName,
    };
    if (formData.is_primary_for_total !== undefined) {
      updatePayload.is_primary_for_total = formData.is_primary_for_total;
    }
    if (formData.category !== undefined) {
      updatePayload.category = formData.category.trim();
    }

    const { error: energyErr } = await supabase
      .from('energy_meters')
      .update(updatePayload)
      .eq('id', id);

    if (energyErr) {
      return { success: false, message: `Failed to update: ${energyErr.message}` };
    }

    // Also sync name to meters table if present
    await supabase
      .from('meters')
      .update({ name: trimmedName })
      .eq('id', id);

    revalidatePath('/energy-meters');
    revalidatePath('/hour-meters');
    revalidatePath('/gas-meters');
    revalidatePath('/dashboard');
    revalidatePath('/log-reading');
    revalidatePath('/history');
    return { success: true, message: `Meter "${trimmedName}" updated successfully!` };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function deleteEnergyMeter(
  id: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    // Check for reading logs via devices
    const { data: devices } = await supabase
      .from('energy_meter_devices')
      .select('id')
      .eq('meter_id', id);

    const deviceIds = (devices || []).map((d) => d.id as string);

    if (deviceIds.length > 0) {
      const { count } = await supabase
        .from('energy_reading_logs')
        .select('*', { count: 'exact', head: true })
        .in('device_id', deviceIds);

      if (count && count > 0) {
        // Soft-delete
        await supabase.from('energy_meters').update({ is_active: false }).eq('id', id);
        revalidatePath('/energy-meters');
        return {
          success: true,
          message: 'Meter has existing readings and was deactivated instead of deleted.',
        };
      }
    }

    const { error } = await supabase.from('energy_meters').delete().eq('id', id);
    if (error) {
      return { success: false, message: `Failed to delete: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return { success: true, message: 'Energy meter deleted.' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Energy Meter Device CRUD ───────────────────────────────

export async function addEnergyDevice(formData: {
  meter_id: string;
  checkpoint_label: string;
  serial_number?: string;
  is_billing_primary?: boolean;
}): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from('energy_meter_devices')
      .insert({
        meter_id: formData.meter_id,
        checkpoint_label: formData.checkpoint_label.trim(),
        serial_number: (formData.serial_number || '').trim(),
        is_billing_primary: formData.is_billing_primary ?? false,
      })
      .select('id')
      .single();

    if (error) {
      return { success: false, message: `Failed to add device: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return { success: true, message: `Device "${formData.checkpoint_label}" added!`, id: data.id };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateEnergyDevice(
  id: string,
  formData: {
    checkpoint_label: string;
    serial_number?: string;
    is_billing_primary?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error } = await supabase
      .from('energy_meter_devices')
      .update({
        checkpoint_label: formData.checkpoint_label.trim(),
        serial_number: (formData.serial_number || '').trim(),
        is_billing_primary: formData.is_billing_primary ?? false,
      })
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to update device: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return { success: true, message: `Device "${formData.checkpoint_label}" updated!` };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function deleteEnergyDevice(
  id: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error } = await supabase.from('energy_meter_devices').delete().eq('id', id);
    if (error) {
      return { success: false, message: `Failed to delete device: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return { success: true, message: 'Device deleted.' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Log an Energy Reading ──────────────────────────────────

export async function logEnergyReading(formData: {
  device_id: string;
  reading_value: number;
  reading_date: string;
}): Promise<{ success: boolean; message: string; usage?: number | null }> {
  try {
    const { supabase, user } = await requireAuth();

    if (isNaN(formData.reading_value) || formData.reading_value < 0) {
      return { success: false, message: 'Invalid reading value.' };
    }

    const { data, error } = await supabase
      .from('energy_reading_logs')
      .insert({
        device_id: formData.device_id,
        reading_value: formData.reading_value,
        reading_date: formData.reading_date,
        operator_id: user.id,
      })
      .select()
      .single();

    if (error) {
      return { success: false, message: `Failed to log reading: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return {
      success: true,
      message:
        data.usage != null
          ? `Reading logged! Usage: ${Number(data.usage).toLocaleString()} kWh`
          : 'Reading logged! (First reading — no usage calculated)',
      usage: data.usage,
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Batch Log (multiple devices at once) ───────────────────

export async function batchLogEnergyReadings(
  entries: { device_id: string; reading_value: number; reading_date: string }[]
): Promise<{ success: boolean; message: string; count?: number }> {
  try {
    const { supabase, user } = await requireAuth();

    const rows = entries
      .filter((e) => !isNaN(e.reading_value) && e.reading_value >= 0)
      .map((e) => ({
        device_id: e.device_id,
        reading_value: e.reading_value,
        reading_date: e.reading_date,
        operator_id: user.id,
      }));

    if (rows.length === 0) {
      return { success: false, message: 'No valid readings to log.' };
    }

    const { error } = await supabase.from('energy_reading_logs').insert(rows);

    if (error) {
      return { success: false, message: `Failed to log readings: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return {
      success: true,
      message: `${rows.length} reading(s) logged successfully!`,
      count: rows.length,
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Include / Exclude Meters from Settings in Energy System ─

export async function toggleMeterInEnergyAction(
  meterId: string,
  enable: boolean
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (enable) {
      // Fetch the meter from legacy meters table
      const { data: meter, error: meterErr } = await supabase
        .from('meters')
        .select(`
          id,
          name,
          type,
          location,
          parent_meter_id,
          section_id,
          multiplication_factor,
          section:meter_sections(name)
        `)
        .eq('id', meterId)
        .single();

      if (meterErr || !meter) {
        return { success: false, message: 'Meter not found.' };
      }

      const sectionMap: Record<string, 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub'> = {
        incoming: 'incoming', main: 'incoming',
        outgoing_main: 'outgoing_main', outgoing: 'outgoing_main',
        outgoing_sub: 'outgoing_sub', submeter: 'outgoing_sub',
        outgoing_sub_sub: 'outgoing_sub_sub',
      };

      const mappedSection = sectionMap[meter.type] || 'outgoing_sub';
      const sectionName = (meter.section as any)?.name || 'General';

      // Upsert into energy_meters
      const { error: upsertErr } = await supabase.from('energy_meters').upsert({
        id: meter.id,
        name: meter.name,
        section: mappedSection,
        category: sectionName,
        parent_id: meter.parent_meter_id,
        multiplication_factor: meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1,
        is_primary_for_total: mappedSection === 'incoming',
        is_active: true,
      }, { onConflict: 'id' });

      if (upsertErr) {
        return { success: false, message: `Failed to add meter: ${upsertErr.message}` };
      }

      // Ensure at least one checkpoint device exists
      const { count: devCount } = await supabase
        .from('energy_meter_devices')
        .select('*', { count: 'exact', head: true })
        .eq('meter_id', meter.id);

      if (!devCount || devCount === 0) {
        await supabase.from('energy_meter_devices').insert({
          meter_id: meter.id,
          checkpoint_label: 'Primary Meter',
          is_billing_primary: true,
        });
      }

      revalidatePath('/energy-meters');
      revalidatePath('/hour-meters');
      revalidatePath('/gas-meters');
      return { success: true, message: `"${meter.name}" included in meters!` };
    } else {
      // Exclude from energy_meters
      const { data: devices } = await supabase
        .from('energy_meter_devices')
        .select('id')
        .eq('meter_id', meterId);

      const deviceIds = (devices || []).map((d) => d.id as string);
      let hasReadings = false;

      if (deviceIds.length > 0) {
        const { count } = await supabase
          .from('energy_reading_logs')
          .select('*', { count: 'exact', head: true })
          .in('device_id', deviceIds);
        hasReadings = !!(count && count > 0);
      }

      if (hasReadings) {
        await supabase.from('energy_meters').update({ is_active: false }).eq('id', meterId);
      } else {
        await supabase.from('energy_meters').delete().eq('id', meterId);
      }

      revalidatePath('/energy-meters');
      revalidatePath('/hour-meters');
      revalidatePath('/gas-meters');
      return { success: true, message: 'Meter excluded from meters.' };
    }
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Exclude All Non-Energy (Gas / Hour) Meters ─────────────

export async function excludeNonEnergyMetersAction(): Promise<{
  success: boolean;
  message: string;
  removedCount?: number;
}> {
  try {
    const { supabase } = await requireAdmin();

    // Find all meters that are Gas or Hour meters
    const { data: nonEnergyMeters } = await supabase
      .from('meters')
      .select(`
        id,
        name,
        section:meter_sections(name, unit)
      `);

    const nonEnergyIds = (nonEnergyMeters || [])
      .filter((m) => {
        const secName = ((m.section as any)?.name || '').toLowerCase();
        const secUnit = ((m.section as any)?.unit || '').toLowerCase();
        return (
          secName.includes('gas') ||
          secName.includes('hour') ||
          secUnit === 'm³' ||
          secUnit === 'hrs'
        );
      })
      .map((m) => m.id);

    if (nonEnergyIds.length === 0) {
      return { success: true, message: 'No Gas or Hour meters found in the system.' };
    }

    // Deactivate or delete them in energy_meters
    const { error } = await supabase
      .from('energy_meters')
      .update({ is_active: false })
      .in('id', nonEnergyIds);

    if (error) {
      return { success: false, message: `Failed to remove non-energy meters: ${error.message}` };
    }

    revalidatePath('/energy-meters');
    return {
      success: true,
      message: `Excluded ${nonEnergyIds.length} Gas/Hour meter(s) from Energy Meters!`,
      removedCount: nonEnergyIds.length,
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Branch (Peak / Off-Peak) readings: used by Log Reading & Logbook History ───

export async function logBranchReading(formData: {
  device_id: string;
  reading_value: number;
  reading_date: string;
  is_reset?: boolean;
}): Promise<{ success: boolean; message: string; readingId?: string }> {
  try {
    const { supabase, user } = await requireAuth();

    if (isNaN(formData.reading_value) || formData.reading_value < 0) {
      return { success: false, message: 'Invalid reading value.' };
    }

    const payload: Record<string, unknown> = {
      device_id: formData.device_id,
      reading_value: formData.reading_value,
      reading_date: formData.reading_date,
      operator_id: user.id,
    };
    if (formData.is_reset) {
      payload.is_reset = true;
      payload.usage = null;
    }

    let { data, error } = await supabase.from('energy_reading_logs').insert(payload).select().single();
    if (error && formData.is_reset && (error.message?.includes('is_reset') || error.code === '42703')) {
      delete payload.is_reset;
      const retry = await supabase.from('energy_reading_logs').insert(payload).select().single();
      data = retry.data;
      error = retry.error;
    }
    if (error || !data) {
      return { success: false, message: `Failed to log reading: ${error?.message}` };
    }

    revalidatePath('/log-reading');
    revalidatePath('/history');
    revalidatePath('/energy-meters');
    revalidatePath('/dashboard');
    return {
      success: true,
      readingId: data.id,
      message:
        data.usage != null
          ? `Reading logged! Usage: ${Number(data.usage).toLocaleString()} kWh`
          : 'Reading logged! (First reading — no usage calculated)',
    };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateBranchReading(
  id: string,
  formData: { reading_value: number; reading_date: string; is_reset?: boolean }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    if (isNaN(formData.reading_value) || formData.reading_value < 0) {
      return { success: false, message: 'Invalid reading value.' };
    }

    const payload: Record<string, unknown> = {
      reading_value: formData.reading_value,
      reading_date: formData.reading_date,
    };
    if (formData.is_reset !== undefined) {
      payload.is_reset = formData.is_reset;
      if (formData.is_reset) payload.usage = null;
    }

    let { error } = await supabase.from('energy_reading_logs').update(payload).eq('id', id);
    if (error && (error.message?.includes('is_reset') || error.code === '42703')) {
      delete payload.is_reset;
      const retry = await supabase.from('energy_reading_logs').update(payload).eq('id', id);
      error = retry.error;
    }
    if (error) {
      return { success: false, message: `Failed to update reading: ${error.message}` };
    }

    revalidatePath('/log-reading');
    revalidatePath('/history');
    revalidatePath('/energy-meters');
    revalidatePath('/dashboard');
    return { success: true, message: 'Log reading updated successfully!' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function deleteBranchReading(
  id: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from('energy_reading_logs').delete().eq('id', id);
    if (error) {
      return { success: false, message: `Failed to delete reading: ${error.message}` };
    }
    revalidatePath('/log-reading');
    revalidatePath('/history');
    revalidatePath('/energy-meters');
    revalidatePath('/dashboard');
    return { success: true, message: 'Log reading deleted successfully!' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}
