'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// ─── Sign In Server Action ───

export async function signInAction(formData: {
  email: string;
  password: string;
}): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.email.trim(),
    password: formData.password,
  });

  if (error) {
    console.error('Sign in server error:', error);
    return {
      success: false,
      message: error.message || 'Invalid email or password.',
    };
  }

  revalidatePath('/', 'layout');
  return { success: true, message: 'Logged in successfully!' };
}

// ─── Sign Up Server Action ───

export async function signUpAction(formData: {
  email: string;
  password: string;
  full_name: string;
}): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: formData.email.trim(),
    password: formData.password,
    options: {
      data: {
        full_name: formData.full_name.trim(),
      },
    },
  });

  if (error) {
    console.error('Sign up server error:', error);
    return {
      success: false,
      message: error.message || 'Failed to create account.',
    };
  }

  if (data?.user && !data?.session) {
    return {
      success: true,
      message: 'Account created! Please check your email inbox to confirm your account.',
    };
  }

  revalidatePath('/', 'layout');
  return { success: true, message: 'Account created successfully!' };
}

// ─── Log a Reading ───

export async function logReading(formData: {
  meter_id: string;
  reading_value: number;
  reading_date: string;
  is_reset?: boolean;
}): Promise<{ success: boolean; message: string; usage?: number | null; readingId?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in to log a reading.' };
  }

  if (isNaN(formData.reading_value) || formData.reading_value < 0) {
    return { success: false, message: 'Invalid reading value. Must be a non-negative number.' };
  }

  const insertPayload: Record<string, unknown> = {
    meter_id: formData.meter_id,
    reading_value: formData.reading_value,
    reading_date: formData.reading_date,
    logged_by: user.id,
  };

  if (formData.is_reset) {
    insertPayload.is_reset = true;
    insertPayload.usage = null;
  }

  let { data, error } = await supabase
    .from('readings')
    .insert(insertPayload)
    .select()
    .single();

  // If the is_reset column is not yet in Supabase schema cache, retry without is_reset
  if (error && (error.message?.includes('is_reset') || error.code === '42703')) {
    delete insertPayload.is_reset;
    const retry = await supabase
      .from('readings')
      .insert(insertPayload)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error('Error logging reading:', error);
    return { success: false, message: `Failed to log reading: ${error.message}` };
  }

  // If this reading was marked as reset / new baseline, ensure usage is NULL
  if (formData.is_reset && data && data.usage !== null) {
    await supabase.from('readings').update({ usage: null }).eq('id', data.id);
    data.usage = null;
  }

  // ── Multi-write to energy_reading_logs, hour_reading_logs, gas_reading_logs ──
  try {
    // 1. Energy
    // Split (Peak / Off-Peak) meters are logged per branch on the Energy Meters page;
    // never mirror a single legacy reading into one branch.
    const { data: energyMeterRow } = await supabase
      .from('energy_meters')
      .select('reading_mode')
      .eq('id', formData.meter_id)
      .maybeSingle();
    const isSplitEnergyMeter = energyMeterRow?.reading_mode === 'split';

    const { data: energyDev } = isSplitEnergyMeter
      ? { data: null }
      : await supabase
          .from('energy_meter_devices')
          .select('id')
          .eq('meter_id', formData.meter_id)
          .eq('is_billing_primary', true)
          .limit(1)
          .maybeSingle();

    if (energyDev) {
      const ePayload: Record<string, unknown> = {
        device_id: energyDev.id,
        reading_value: formData.reading_value,
        reading_date: formData.reading_date,
        operator_id: user.id,
      };
      if (formData.is_reset) {
        ePayload.is_reset = true;
        ePayload.usage = null;
      }
      const eRes = await supabase.from('energy_reading_logs').insert(ePayload);
      if (eRes.error && (eRes.error.message?.includes('is_reset') || eRes.error.code === '42703')) {
        delete ePayload.is_reset;
        await supabase.from('energy_reading_logs').insert(ePayload);
      }
    }

    // 2. Hour
    let { data: hourDev } = await supabase
      .from('hour_meter_devices')
      .select('id')
      .eq('meter_id', formData.meter_id)
      .eq('is_billing_primary', true)
      .limit(1)
      .maybeSingle();

    if (!hourDev) {
      let { data: hMeter } = await supabase
        .from('hour_meters')
        .select('id')
        .eq('id', formData.meter_id)
        .maybeSingle();

      if (!hMeter) {
        const { data: pMeter } = await supabase
          .from('meters')
          .select('id, name, multiplication_factor, sections:meter_sections(name, unit)')
          .eq('id', formData.meter_id)
          .maybeSingle();

        if (pMeter) {
          const sName = ((pMeter.sections as any)?.name || '').toLowerCase();
          const sUnit = ((pMeter.sections as any)?.unit || '').toLowerCase();
          if (sName.includes('hour') || sUnit === 'hrs') {
            const { data: newHMeter } = await supabase
              .from('hour_meters')
              .upsert({
                id: pMeter.id,
                name: pMeter.name,
                equipment_group: 'Other',
                multiplication_factor: pMeter.multiplication_factor || 1,
                is_active: true,
              }, { onConflict: 'id' })
              .select('id')
              .single();
            if (newHMeter) hMeter = newHMeter;
          }
        }
      }

      if (hMeter) {
        const { data: newDev } = await supabase
          .from('hour_meter_devices')
          .insert({
            meter_id: formData.meter_id,
            checkpoint_label: 'Primary Meter',
            is_billing_primary: true,
          })
          .select('id')
          .single();
        if (newDev) hourDev = newDev;
      }
    }

    if (hourDev) {
      const hPayload: Record<string, unknown> = {
        device_id: hourDev.id,
        reading_value: formData.reading_value,
        reading_date: formData.reading_date,
        operator_id: user.id,
      };
      if (formData.is_reset) {
        hPayload.is_reset = true;
        hPayload.usage = null;
      }
      const hRes = await supabase.from('hour_reading_logs').insert(hPayload);
      if (hRes.error && (hRes.error.message?.includes('is_reset') || hRes.error.code === '42703')) {
        delete hPayload.is_reset;
        await supabase.from('hour_reading_logs').insert(hPayload);
      }
    }

    // 3. Gas
    let { data: gasDev } = await supabase
      .from('gas_meter_devices')
      .select('id')
      .eq('meter_id', formData.meter_id)
      .eq('is_billing_primary', true)
      .limit(1)
      .maybeSingle();

    if (!gasDev) {
      let { data: gMeter } = await supabase
        .from('gas_meters')
        .select('id')
        .eq('id', formData.meter_id)
        .maybeSingle();

      if (!gMeter) {
        const { data: pMeter } = await supabase
          .from('meters')
          .select('id, name, type, parent_meter_id, multiplication_factor, sections:meter_sections(name, unit)')
          .eq('id', formData.meter_id)
          .maybeSingle();

        if (pMeter) {
          const sName = ((pMeter.sections as any)?.name || '').toLowerCase();
          const sUnit = ((pMeter.sections as any)?.unit || '').toLowerCase();
          if (sName.includes('gas') || sUnit === 'm³') {
            const sectionMap: Record<string, string> = {
              incoming: 'incoming', main: 'incoming',
              outgoing_main: 'outgoing_main', outgoing: 'outgoing_main',
              outgoing_sub: 'outgoing_sub', submeter: 'outgoing_sub',
              outgoing_sub_sub: 'outgoing_sub_sub',
            };
            const { data: newGMeter } = await supabase
              .from('gas_meters')
              .upsert({
                id: pMeter.id,
                name: pMeter.name,
                section: sectionMap[pMeter.type] || 'incoming',
                parent_id: pMeter.parent_meter_id || null,
                multiplication_factor: pMeter.multiplication_factor || 1,
                is_primary_for_total: pMeter.type === 'incoming' || pMeter.type === 'main',
                is_active: true,
              }, { onConflict: 'id' })
              .select('id')
              .single();
            if (newGMeter) gMeter = newGMeter;
          }
        }
      }

      if (gMeter) {
        const { data: newDev } = await supabase
          .from('gas_meter_devices')
          .insert({
            meter_id: formData.meter_id,
            checkpoint_label: 'Primary Meter',
            is_billing_primary: true,
          })
          .select('id')
          .single();
        if (newDev) gasDev = newDev;
      }
    }

    if (gasDev) {
      const gPayload: Record<string, unknown> = {
        device_id: gasDev.id,
        reading_value: formData.reading_value,
        reading_date: formData.reading_date,
        operator_id: user.id,
      };
      if (formData.is_reset) {
        gPayload.is_reset = true;
        gPayload.usage = null;
      }
      const gRes = await supabase.from('gas_reading_logs').insert(gPayload);
      if (gRes.error && (gRes.error.message?.includes('is_reset') || gRes.error.code === '42703')) {
        delete gPayload.is_reset;
        await supabase.from('gas_reading_logs').insert(gPayload);
      }
    }
  } catch (syncErr) {
    console.warn('Sync to utility reading logs warning:', syncErr);
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return {
    success: true,
    message: formData.is_reset
      ? 'Reading saved as new first reading (baseline reset). Past months data preserved!'
      : data.usage != null
      ? `Reading logged successfully! Usage: ${Number(data.usage).toLocaleString()} kWh`
      : 'Reading logged successfully! (First reading for this meter — no usage calculated)',
    usage: formData.is_reset ? null : data.usage,
    readingId: data.id,
  };
}

// ─── Admin Edit Reading Log ───

export async function updateReadingAction(
  readingId: string,
  formData: {
    reading_value: number;
    reading_date: string;
    is_reset?: boolean;
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
    return { success: false, message: 'Only admins can edit log readings.' };
  }

  if (isNaN(formData.reading_value) || formData.reading_value < 0) {
    return { success: false, message: 'Invalid reading value.' };
  }

  const { data: oldReading } = await supabase
    .from('readings')
    .select('meter_id, reading_date')
    .eq('id', readingId)
    .single();

  const updatePayload: Record<string, unknown> = {
    reading_value: formData.reading_value,
    reading_date: formData.reading_date,
  };
  if (formData.is_reset !== undefined) {
    updatePayload.is_reset = formData.is_reset;
    if (formData.is_reset) {
      updatePayload.usage = null;
    }
  }

  let { error } = await supabase
    .from('readings')
    .update(updatePayload)
    .eq('id', readingId);

  if (error && (error.message?.includes('is_reset') || error.code === '42703')) {
    delete updatePayload.is_reset;
    const retry = await supabase
      .from('readings')
      .update(updatePayload)
      .eq('id', readingId);
    error = retry.error;
  }

  if (error) {
    console.error('Error updating reading:', error);
    return { success: false, message: `Failed to update reading: ${error.message}` };
  }

  if (formData.is_reset) {
    await supabase.from('readings').update({ usage: null }).eq('id', readingId);
  }

  // Sync to energy, hour, gas logs if applicable
  if (oldReading?.meter_id) {
    try {
      const logUpdate: Record<string, unknown> = {
        reading_value: formData.reading_value,
        reading_date: formData.reading_date,
      };
      if (formData.is_reset !== undefined) {
        logUpdate.is_reset = formData.is_reset;
        if (formData.is_reset) logUpdate.usage = null;
      }

      // Hour logs
      const { data: hDevs } = await supabase
        .from('hour_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (hDevs && hDevs.length > 0) {
        const hDevIds = hDevs.map(d => d.id);
        await supabase
          .from('hour_reading_logs')
          .update(logUpdate)
          .in('device_id', hDevIds)
          .eq('reading_date', oldReading.reading_date);
      }

      // Gas logs
      const { data: gDevs } = await supabase
        .from('gas_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (gDevs && gDevs.length > 0) {
        const gDevIds = gDevs.map(d => d.id);
        await supabase
          .from('gas_reading_logs')
          .update(logUpdate)
          .in('device_id', gDevIds)
          .eq('reading_date', oldReading.reading_date);
      }

      // Energy logs
      const { data: eDevs } = await supabase
        .from('energy_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (eDevs && eDevs.length > 0) {
        const eDevIds = eDevs.map(d => d.id);
        await supabase
          .from('energy_reading_logs')
          .update(logUpdate)
          .in('device_id', eDevIds)
          .eq('reading_date', oldReading.reading_date);
      }
    } catch (syncErr) {
      console.warn('Sync update warning:', syncErr);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: 'Log reading updated successfully!' };
}

// ─── Admin Delete Reading Log ───

export async function deleteReadingAction(readingId: string): Promise<{ success: boolean; message: string }> {
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
    return { success: false, message: 'Only admins can delete log readings.' };
  }

  const { data: oldReading } = await supabase
    .from('readings')
    .select('meter_id, reading_date')
    .eq('id', readingId)
    .single();

  const { error } = await supabase
    .from('readings')
    .delete()
    .eq('id', readingId);

  if (error) {
    console.error('Error deleting reading:', error);
    return { success: false, message: `Failed to delete reading: ${error.message}` };
  }

  if (oldReading?.meter_id) {
    try {
      const { data: hDevs } = await supabase
        .from('hour_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (hDevs && hDevs.length > 0) {
        await supabase
          .from('hour_reading_logs')
          .delete()
          .in('device_id', hDevs.map(d => d.id))
          .eq('reading_date', oldReading.reading_date);
      }

      const { data: gDevs } = await supabase
        .from('gas_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (gDevs && gDevs.length > 0) {
        await supabase
          .from('gas_reading_logs')
          .delete()
          .in('device_id', gDevs.map(d => d.id))
          .eq('reading_date', oldReading.reading_date);
      }

      const { data: eDevs } = await supabase
        .from('energy_meter_devices')
        .select('id')
        .eq('meter_id', oldReading.meter_id);
      if (eDevs && eDevs.length > 0) {
        await supabase
          .from('energy_reading_logs')
          .delete()
          .in('device_id', eDevs.map(d => d.id))
          .eq('reading_date', oldReading.reading_date);
      }
    } catch (syncErr) {
      console.warn('Sync delete warning:', syncErr);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: 'Log reading deleted successfully!' };
}

// ─── Split (Peak / Off-Peak) energy meter helpers ───

type EnergyBranchInput = { id?: string; label: string };
type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/** Validate branches for a split meter. Returns an error message, or null when OK. */
async function validateEnergyBranches(
  supabase: SupabaseServer,
  meterId: string | null,
  mode: 'checkpoint' | 'split' | undefined,
  branches: EnergyBranchInput[] | undefined
): Promise<string | null> {
  if (mode !== 'split') return null;
  const clean = (branches || []).map((b) => ({ ...b, label: (b.label || '').trim() }));
  if (clean.length < 2) return 'A split meter needs at least two branches (e.g. Peak and Off-Peak).';
  if (clean.some((b) => !b.label)) return 'Every branch needs a name.';
  const labels = clean.map((b) => b.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return 'Branch names must be unique.';

  if (meterId) {
    const keep = new Set(clean.map((b) => b.id).filter(Boolean));
    const { data: existing } = await supabase
      .from('energy_meter_devices')
      .select('id, checkpoint_label')
      .eq('meter_id', meterId);
    for (const d of existing || []) {
      if (keep.has(d.id)) continue;
      const { count } = await supabase
        .from('energy_reading_logs')
        .select('*', { count: 'exact', head: true })
        .eq('device_id', d.id);
      if (count && count > 0) {
        return `Branch "${d.checkpoint_label}" has readings and can't be removed.`;
      }
    }
  }
  return null;
}

/** Apply reading mode + branches to an energy meter (call after the energy_meters upsert). */
async function applyEnergyBranches(
  supabase: SupabaseServer,
  meterId: string,
  mode: 'checkpoint' | 'split' | undefined,
  branches: EnergyBranchInput[] | undefined
): Promise<void> {
  if (!mode) return;

  if (mode === 'split') {
    const clean = (branches || []).map((b) => ({ ...b, label: (b.label || '').trim() }));
    const { data: existing } = await supabase
      .from('energy_meter_devices')
      .select('id')
      .eq('meter_id', meterId);
    const existingIds = new Set((existing || []).map((d) => d.id));
    const keep = new Set(clean.map((b) => b.id).filter(Boolean));

    for (const d of existing || []) {
      if (!keep.has(d.id)) await supabase.from('energy_meter_devices').delete().eq('id', d.id);
    }
    for (let i = 0; i < clean.length; i++) {
      const b = clean[i];
      if (b.id && existingIds.has(b.id)) {
        await supabase
          .from('energy_meter_devices')
          .update({ checkpoint_label: b.label, sort_order: i, is_billing_primary: i === 0 })
          .eq('id', b.id);
      } else {
        await supabase.from('energy_meter_devices').insert({
          meter_id: meterId,
          checkpoint_label: b.label,
          sort_order: i,
          is_billing_primary: i === 0,
        });
      }
    }
    await supabase.from('energy_meters').update({ reading_mode: 'split' }).eq('id', meterId);
  } else {
    await supabase.from('energy_meters').update({ reading_mode: 'checkpoint' }).eq('id', meterId);
    const { data: devs } = await supabase
      .from('energy_meter_devices')
      .select('id, is_billing_primary')
      .eq('meter_id', meterId)
      .order('sort_order', { ascending: true });
    if (devs && devs.length > 0 && !devs.some((d) => d.is_billing_primary)) {
      await supabase.from('energy_meter_devices').update({ is_billing_primary: true }).eq('id', devs[0].id);
    }
  }
}

// ─── Add a Meter ───

export async function addMeter(formData: {
  name: string;
  type: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub' | 'main' | 'submeter' | 'outgoing';
  location: string;
  parent_meter_id?: string | null;
  section_id?: string | null;
  multiplication_factor?: number;
  category?: string;
  is_primary_for_total?: boolean;
  equipment_group?: string;
  utility_domain?: 'energy' | 'gas' | 'hour';
  reading_mode?: 'checkpoint' | 'split';
  branches?: { id?: string; label: string }[];
}): Promise<{ success: boolean; message: string; meterId?: string }> {
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
    return { success: false, message: 'Only admins can add meters.' };
  }

  const isIncoming = formData.type === 'incoming' || formData.type === 'main';
  const effectiveParentId = isIncoming ? null : (formData.parent_meter_id || null);

  const branchError = await validateEnergyBranches(supabase, null, formData.reading_mode, formData.branches);
  if (branchError) return { success: false, message: branchError };

  const { data: newMeter, error } = await supabase.from('meters').insert({
    name: formData.name,
    type: formData.type,
    location: formData.location,
    parent_meter_id: effectiveParentId,
    section_id: formData.section_id || null,
    multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
  }).select('id').single();

  if (error || !newMeter) {
    console.error('Error adding meter:', error);
    return { success: false, message: `Failed to add meter: ${error?.message}` };
  }

  // ── Sync to domain tables (energy_meters, gas_meters, hour_meters) ──
  let isEnergyMeter = true;
  let isGasMeter = false;
  let isHourMeter = false;

  if (formData.utility_domain === 'hour') {
    isEnergyMeter = false;
    isGasMeter = false;
    isHourMeter = true;
  } else if (formData.utility_domain === 'gas') {
    isEnergyMeter = false;
    isGasMeter = true;
    isHourMeter = false;
  } else if (formData.utility_domain === 'energy') {
    isEnergyMeter = true;
    isGasMeter = false;
    isHourMeter = false;
  } else if (formData.section_id) {
    const { data: sec } = await supabase
      .from('meter_sections')
      .select('name, unit')
      .eq('id', formData.section_id)
      .single();
    if (sec) {
      const sName = (sec.name || '').toLowerCase();
      const sUnit = (sec.unit || '').toLowerCase();
      if (sName.includes('gas') || sName.includes('rms') || sUnit === 'm³' || sUnit === 'm3' || sUnit.includes('m3') || sUnit.includes('m³')) {
        isEnergyMeter = false;
        isGasMeter = true;
      } else if (sName.includes('hour') || sUnit === 'hrs' || sUnit === 'hr' || sUnit.includes('hour')) {
        isEnergyMeter = false;
        isHourMeter = true;
      }
    }
  }
  if ((formData as any).include_in_energy_meters !== undefined && formData.utility_domain === undefined) {
    isEnergyMeter = !!(formData as any).include_in_energy_meters;
  }

  const sectionMap: Record<string, string> = {
    incoming: 'incoming', main: 'incoming',
    outgoing_main: 'outgoing_main', outgoing: 'outgoing_main',
    outgoing_sub: 'outgoing_sub', submeter: 'outgoing_sub',
    outgoing_sub_sub: 'outgoing_sub_sub',
  };

  if (isEnergyMeter) {
    let energyParentId: string | null = null;
    if (effectiveParentId) {
      const { data: parentExists } = await supabase
        .from('energy_meters')
        .select('id')
        .eq('id', effectiveParentId)
        .maybeSingle();
      if (parentExists) energyParentId = effectiveParentId;
    }

    await supabase.from('energy_meters').upsert({
      id: newMeter.id,
      name: formData.name,
      section: sectionMap[formData.type] || 'outgoing_sub',
      category: formData.category || 'General',
      parent_id: energyParentId,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_primary_for_total: formData.is_primary_for_total ?? isIncoming,
      is_active: true,
    }, { onConflict: 'id' });

    // Create default checkpoint device if none exists
    const { count: deviceCount } = await supabase
      .from('energy_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', newMeter.id);

    if (!deviceCount || deviceCount === 0) {
      await supabase.from('energy_meter_devices').insert({
        meter_id: newMeter.id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
    await applyEnergyBranches(supabase, newMeter.id, formData.reading_mode, formData.branches);
  } else if (isGasMeter) {
    let gasParentId: string | null = null;
    if (effectiveParentId) {
      const { data: parentExists } = await supabase
        .from('gas_meters')
        .select('id')
        .eq('id', effectiveParentId)
        .maybeSingle();
      if (parentExists) gasParentId = effectiveParentId;
    }

    await supabase.from('gas_meters').upsert({
      id: newMeter.id,
      name: formData.name,
      section: sectionMap[formData.type] || 'incoming',
      category: formData.category || 'General',
      parent_id: gasParentId,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_primary_for_total: formData.is_primary_for_total ?? isIncoming,
      is_active: true,
    }, { onConflict: 'id' });

    const { count: deviceCount } = await supabase
      .from('gas_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', newMeter.id);

    if (!deviceCount || deviceCount === 0) {
      await supabase.from('gas_meter_devices').insert({
        meter_id: newMeter.id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
  } else if (isHourMeter) {
    const groupMap: Record<string, string> = {
      generator: 'Generator',
      compressor: 'Compressor',
      pump: 'Pump',
    };
    const equipGroup = (formData.equipment_group as any) || groupMap[(formData.category || '').toLowerCase()] || 'Other';
    await supabase.from('hour_meters').upsert({
      id: newMeter.id,
      name: formData.name,
      equipment_group: equipGroup,
      category: formData.category || 'General',
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_active: true,
    }, { onConflict: 'id' });

    const { count: deviceCount } = await supabase
      .from('hour_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', newMeter.id);

    if (!deviceCount || deviceCount === 0) {
      await supabase.from('hour_meter_devices').insert({
        meter_id: newMeter.id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/dashboard');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: `Meter "${formData.name}" added successfully!`, meterId: newMeter.id };
}

// ─── Update a Meter ───

export async function updateMeter(
  id: string,
  formData: {
    name: string;
    type: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub' | 'main' | 'submeter' | 'outgoing';
    location: string;
    parent_meter_id?: string | null;
    section_id?: string | null;
    multiplication_factor?: number;
    category?: string;
    is_primary_for_total?: boolean;
    equipment_group?: string;
    utility_domain?: 'energy' | 'gas' | 'hour';
    reading_mode?: 'checkpoint' | 'split';
    branches?: { id?: string; label: string }[];
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
    return { success: false, message: 'Only admins can update meters.' };
  }

  const isIncoming = formData.type === 'incoming' || formData.type === 'main';
  const effectiveParentId = isIncoming ? null : (formData.parent_meter_id || null);

  const branchError = await validateEnergyBranches(supabase, id, formData.reading_mode, formData.branches);
  if (branchError) return { success: false, message: branchError };

  const { error } = await supabase
    .from('meters')
    .update({
      name: formData.name,
      type: formData.type,
      location: formData.location,
      parent_meter_id: effectiveParentId,
      section_id: formData.section_id || null,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating meter:', error);
    return { success: false, message: `Failed to update meter: ${error.message}` };
  }

  // ── Sync to domain tables (energy_meters, gas_meters, hour_meters) ──
  let isEnergyMeter = true;
  let isGasMeter = false;
  let isHourMeter = false;

  if (formData.utility_domain === 'hour') {
    isEnergyMeter = false;
    isGasMeter = false;
    isHourMeter = true;
  } else if (formData.utility_domain === 'gas') {
    isEnergyMeter = false;
    isGasMeter = true;
    isHourMeter = false;
  } else if (formData.utility_domain === 'energy') {
    isEnergyMeter = true;
    isGasMeter = false;
    isHourMeter = false;
  } else if (formData.section_id) {
    const { data: sec } = await supabase
      .from('meter_sections')
      .select('name, unit')
      .eq('id', formData.section_id)
      .single();
    if (sec) {
      const sName = (sec.name || '').toLowerCase();
      const sUnit = (sec.unit || '').toLowerCase();
      if (sName.includes('gas') || sName.includes('rms') || sUnit === 'm³' || sUnit === 'm3' || sUnit.includes('m3') || sUnit.includes('m³')) {
        isEnergyMeter = false;
        isGasMeter = true;
      } else if (sName.includes('hour') || sUnit === 'hrs' || sUnit === 'hr' || sUnit.includes('hour')) {
        isEnergyMeter = false;
        isHourMeter = true;
      }
    }
  }
  if ((formData as any).include_in_energy_meters !== undefined && formData.utility_domain === undefined) {
    isEnergyMeter = !!(formData as any).include_in_energy_meters;
  }

  const sectionMap: Record<string, string> = {
    incoming: 'incoming', main: 'incoming',
    outgoing_main: 'outgoing_main', outgoing: 'outgoing_main',
    outgoing_sub: 'outgoing_sub', submeter: 'outgoing_sub',
    outgoing_sub_sub: 'outgoing_sub_sub',
  };

  if (isEnergyMeter) {
    // Clean up from other domain tables to avoid ghost records
    await supabase.from('gas_meters').delete().eq('id', id);
    await supabase.from('hour_meters').delete().eq('id', id);

    let energyParentId: string | null = null;
    if (effectiveParentId) {
      const { data: parentExists } = await supabase
        .from('energy_meters')
        .select('id')
        .eq('id', effectiveParentId)
        .maybeSingle();
      if (parentExists) energyParentId = effectiveParentId;
    }

    await supabase.from('energy_meters').upsert({
      id: id,
      name: formData.name,
      section: sectionMap[formData.type] || 'outgoing_sub',
      category: formData.category || 'General',
      parent_id: energyParentId,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_primary_for_total: formData.is_primary_for_total ?? isIncoming,
      is_active: true,
    }, { onConflict: 'id' });

    // Ensure checkpoint device exists
    const { count: devCount } = await supabase
      .from('energy_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', id);
    if (!devCount || devCount === 0) {
      await supabase.from('energy_meter_devices').insert({
        meter_id: id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
    await applyEnergyBranches(supabase, id, formData.reading_mode, formData.branches);
  } else if (isGasMeter) {
    // Clean up from other domain tables to avoid ghost records
    await supabase.from('energy_meters').delete().eq('id', id);
    await supabase.from('hour_meters').delete().eq('id', id);

    let gasParentId: string | null = null;
    if (effectiveParentId) {
      const { data: parentExists } = await supabase
        .from('gas_meters')
        .select('id')
        .eq('id', effectiveParentId)
        .maybeSingle();
      if (parentExists) gasParentId = effectiveParentId;
    }

    await supabase.from('gas_meters').upsert({
      id: id,
      name: formData.name,
      section: sectionMap[formData.type] || 'incoming',
      category: formData.category || 'General',
      parent_id: gasParentId,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_primary_for_total: formData.is_primary_for_total ?? isIncoming,
      is_active: true,
    }, { onConflict: 'id' });

    const { count: devCount } = await supabase
      .from('gas_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', id);
    if (!devCount || devCount === 0) {
      await supabase.from('gas_meter_devices').insert({
        meter_id: id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
  } else if (isHourMeter) {
    // Clean up from other domain tables to avoid ghost records
    await supabase.from('energy_meters').delete().eq('id', id);
    await supabase.from('gas_meters').delete().eq('id', id);
    const groupMap: Record<string, string> = {
      generator: 'Generator',
      compressor: 'Compressor',
      pump: 'Pump',
    };
    const equipGroup = (formData.equipment_group as any) || groupMap[(formData.category || '').toLowerCase()] || 'Other';
    await supabase.from('hour_meters').upsert({
      id: id,
      name: formData.name,
      equipment_group: equipGroup,
      category: formData.category || 'General',
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
      is_active: true,
    }, { onConflict: 'id' });

    const { count: devCount } = await supabase
      .from('hour_meter_devices')
      .select('*', { count: 'exact', head: true })
      .eq('meter_id', id);
    if (!devCount || devCount === 0) {
      await supabase.from('hour_meter_devices').insert({
        meter_id: id,
        checkpoint_label: 'Primary Meter',
        is_billing_primary: true,
      });
    }
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/dashboard');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: `Meter "${formData.name}" updated successfully!` };
}

// ─── Delete a Meter ───

export async function deleteMeter(id: string): Promise<{ success: boolean; message: string }> {
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
    return { success: false, message: 'Only admins can delete meters.' };
  }

  const { count } = await supabase
    .from('readings')
    .select('*', { count: 'exact', head: true })
    .eq('meter_id', id);

  if (count && count > 0) {
    const { error } = await supabase
      .from('meters')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      return { success: false, message: `Failed to deactivate meter: ${error.message}` };
    }

    await supabase.from('energy_meters').update({ is_active: false }).eq('id', id);
    await supabase.from('gas_meters').update({ is_active: false }).eq('id', id);
    await supabase.from('hour_meters').update({ is_active: false }).eq('id', id);

    revalidatePath('/settings');
    revalidatePath('/energy-meters');
    revalidatePath('/hour-meters');
    revalidatePath('/gas-meters');
    return {
      success: true,
      message: 'Meter has existing readings and was deactivated instead of deleted.',
    };
  }

  const { error } = await supabase.from('meters').delete().eq('id', id);

  if (error) {
    return { success: false, message: `Failed to delete meter: ${error.message}` };
  }

  await supabase.from('energy_meters').delete().eq('id', id);
  await supabase.from('gas_meters').delete().eq('id', id);
  await supabase.from('hour_meters').delete().eq('id', id);

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: 'Meter deleted successfully!' };
}

// ─── Update User Role ───

export async function updateUserRole(
  userId: string,
  newRole: 'admin' | 'operator'
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (currentProfile?.role !== 'admin') {
    return { success: false, message: 'Only admins can change user roles.' };
  }

  if (newRole === 'operator' && userId !== user.id) {
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'admin');

    if (count && count <= 1) {
      return {
        success: false,
        message: 'Cannot demote the last admin. Promote another user first.',
      };
    }
  }

  if (userId === user.id && newRole === 'operator') {
    return { success: false, message: 'You cannot demote yourself.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  if (error) {
    return { success: false, message: `Failed to update role: ${error.message}` };
  }

  revalidatePath('/users');

  return { success: true, message: `User role updated to ${newRole} successfully!` };
}

// ─── Update Sorting Order of Meters ───
export async function updateMetersOrder(
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
    return { success: false, message: 'Only admins can manage meter order.' };
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('meters')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);

    if (error) {
      console.error(`Error updating sort_order for meter ${orderedIds[i]}:`, error);
      return { success: false, message: `Failed to save meter order: ${error.message}` };
    }
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/dashboard');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: 'Meter order updated successfully!' };
}

// ─── Meter Section Actions ───

export async function addMeterSection(
  name: string,
  icon: string = '',
  color: string = 'accent',
  unit: string = 'kWh'
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
    return { success: false, message: 'Only admins can add meter sections.' };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, message: 'Section name is required.' };
  }

  const { error } = await supabase.from('meter_sections').insert({
    name: trimmed,
    icon: icon.trim(),
    color: color.trim() || 'accent',
    unit: unit.trim() || 'kWh',
  });

  if (error) {
    console.error('Error adding section:', error);
    return { success: false, message: `Failed to add section: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: `Section "${trimmed}" added successfully!` };
}

export async function updateMeterSection(
  id: string,
  name: string,
  unit: string = 'kWh'
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
    return { success: false, message: 'Only admins can edit meter sections.' };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, message: 'Section name is required.' };
  }

  const { error } = await supabase
    .from('meter_sections')
    .update({
      name: trimmed,
      unit: unit.trim() || 'kWh',
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating section:', error);
    return { success: false, message: `Failed to update section: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');
  revalidatePath('/dashboard');
  revalidatePath('/history');

  return { success: true, message: `Section "${trimmed}" updated successfully!` };
}

export async function deleteMeterSection(
  id: string
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
    return { success: false, message: 'Only admins can delete meter sections.' };
  }

  const { error } = await supabase.from('meter_sections').delete().eq('id', id);

  if (error) {
    console.error('Error deleting section:', error);
    return { success: false, message: `Failed to delete section: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/energy-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/gas-meters');

  return { success: true, message: 'Section deleted successfully!' };
}

export async function renameEquipmentCategory(
  oldName: string,
  newName: string
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
    return { success: false, message: 'Only admins can rename categories.' };
  }

  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew) {
    return { success: false, message: 'Both old and new category names are required.' };
  }

  const [energyRes, gasRes, hourRes] = await Promise.all([
    supabase.from('energy_meters').update({ category: trimmedNew }).eq('category', trimmedOld),
    supabase.from('gas_meters').update({ category: trimmedNew }).eq('category', trimmedOld),
    supabase.from('hour_meters').update({ category: trimmedNew }).eq('category', trimmedOld),
  ]);

  if (energyRes.error || gasRes.error || hourRes.error) {
    const err = energyRes.error || gasRes.error || hourRes.error;
    console.error('Error renaming category:', err);
    return { success: false, message: `Failed to rename category: ${err?.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/energy-meters');
  revalidatePath('/gas-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/dashboard');
  revalidatePath('/log-reading');
  revalidatePath('/history');

  return { success: true, message: `Category "${trimmedOld}" renamed to "${trimmedNew}" successfully!` };
}

export async function deleteEquipmentCategory(
  categoryName: string
): Promise<{ success: boolean; message: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in.' };
  }

  const trimmed = categoryName.trim();
  if (!trimmed) {
    return { success: false, message: 'Category name is required.' };
  }

  await Promise.all([
    supabase.from('energy_meters').update({ category: 'General' }).eq('category', trimmed),
    supabase.from('gas_meters').update({ category: 'General' }).eq('category', trimmed),
    supabase.from('hour_meters').update({ category: 'General' }).eq('category', trimmed),
  ]);

  revalidatePath('/settings');
  revalidatePath('/energy-meters');
  revalidatePath('/gas-meters');
  revalidatePath('/hour-meters');
  revalidatePath('/dashboard');

  return { success: true, message: `Category "${trimmed}" cleared successfully!` };
}


