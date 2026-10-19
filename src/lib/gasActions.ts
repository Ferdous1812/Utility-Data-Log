'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { GasMeterSection } from '@/types/gas';

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

// ─── Gas Meter CRUD ─────────────────────────────────────────

export async function addGasMeter(formData: {
  name: string;
  section: GasMeterSection;
  category?: string;
  multiplication_factor?: number;
  is_primary_for_total?: boolean;
}): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { data, error } = await supabase
      .from('gas_meters')
      .insert({
        name: formData.name.trim(),
        section: formData.section,
        category: (formData.category || 'General').trim(),
        multiplication_factor: formData.multiplication_factor ?? 1.0,
        is_primary_for_total: formData.is_primary_for_total ?? true,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      return { success: false, message: `Failed to add gas meter: ${error.message}` };
    }

    // Create default checkpoint device
    await supabase.from('gas_meter_devices').insert({
      meter_id: data.id,
      checkpoint_label: 'Primary Meter',
      is_billing_primary: true,
    });

    revalidatePath('/gas-meters');
    return { success: true, message: `Gas meter "${formData.name}" added!`, id: data.id };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function updateGasMeterQuickAction(
  id: string,
  formData: {
    name: string;
    is_primary_for_total?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      return { success: false, message: 'Meter name cannot be empty.' };
    }

    const payload: { name: string; is_primary_for_total?: boolean } = {
      name: trimmedName,
    };
    if (formData.is_primary_for_total !== undefined) {
      payload.is_primary_for_total = formData.is_primary_for_total;
    }

    const { error } = await supabase
      .from('gas_meters')
      .update(payload)
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to update: ${error.message}` };
    }

    revalidatePath('/gas-meters');
    return { success: true, message: `Meter "${trimmedName}" updated!` };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export async function deleteGasMeter(
  id: string
): Promise<{ success: boolean; message: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error } = await supabase
      .from('gas_meters')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to delete: ${error.message}` };
    }

    revalidatePath('/gas-meters');
    return { success: true, message: 'Gas meter removed.' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

// ─── Include / Exclude in Gas System ────────────────────────

export async function toggleMeterInGasAction(
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
          type,
          multiplication_factor,
          section:meter_sections(name)
        `)
        .eq('id', meterId)
        .single();

      if (meterErr || !meter) {
        return { success: false, message: 'Meter not found.' };
      }

      const sectionMap: Record<string, GasMeterSection> = {
        incoming: 'incoming', main: 'incoming',
        outgoing_main: 'outgoing_main', outgoing: 'outgoing_main',
        outgoing_sub: 'outgoing_sub', submeter: 'outgoing_sub',
        outgoing_sub_sub: 'outgoing_sub_sub',
      };

      const mappedSection = sectionMap[meter.type] || 'incoming';

      const { error: upsertErr } = await supabase.from('gas_meters').upsert({
        id: meter.id,
        name: meter.name,
        section: mappedSection,
        category: (meter.section as any)?.name || 'Gas Supply',
        multiplication_factor: meter.multiplication_factor != null ? Number(meter.multiplication_factor) : 1,
        is_primary_for_total: mappedSection === 'incoming',
        is_active: true,
      }, { onConflict: 'id' });

      if (upsertErr) {
        return { success: false, message: `Failed to include meter: ${upsertErr.message}` };
      }

      // Check for device
      const { count } = await supabase
        .from('gas_meter_devices')
        .select('*', { count: 'exact', head: true })
        .eq('meter_id', meter.id);

      if (!count || count === 0) {
        await supabase.from('gas_meter_devices').insert({
          meter_id: meter.id,
          checkpoint_label: 'Primary Meter',
          is_billing_primary: true,
        });
      }

      revalidatePath('/gas-meters');
      return { success: true, message: `"${meter.name}" included in Gas Meters!` };
    } else {
      await supabase.from('gas_meters').update({ is_active: false }).eq('id', meterId);
      revalidatePath('/gas-meters');
      return { success: true, message: 'Meter excluded from Gas Meters.' };
    }
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}
