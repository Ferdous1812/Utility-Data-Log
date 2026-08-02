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

  const { data, error } = await supabase
    .from('readings')
    .insert({
      meter_id: formData.meter_id,
      reading_value: formData.reading_value,
      reading_date: formData.reading_date,
      logged_by: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('Error logging reading:', error);
    return { success: false, message: `Failed to log reading: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');
  revalidatePath('/log-reading');

  return {
    success: true,
    message: data.usage != null
      ? `Reading logged successfully! Usage: ${Number(data.usage).toLocaleString()} kWh`
      : 'Reading logged successfully! (First reading for this meter — no usage calculated)',
    usage: data.usage,
    readingId: data.id,
  };
}

// ─── Admin Edit Reading Log ───

export async function updateReadingAction(
  readingId: string,
  formData: {
    reading_value: number;
    reading_date: string;
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

  const { error } = await supabase
    .from('readings')
    .update({
      reading_value: formData.reading_value,
      reading_date: formData.reading_date,
    })
    .eq('id', readingId);

  if (error) {
    console.error('Error updating reading:', error);
    return { success: false, message: `Failed to update reading: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');

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

  const { error } = await supabase
    .from('readings')
    .delete()
    .eq('id', readingId);

  if (error) {
    console.error('Error deleting reading:', error);
    return { success: false, message: `Failed to delete reading: ${error.message}` };
  }

  revalidatePath('/dashboard');
  revalidatePath('/history');

  return { success: true, message: 'Log reading deleted successfully!' };
}

// ─── Add a Meter ───

export async function addMeter(formData: {
  name: string;
  type: 'incoming' | 'outgoing_main' | 'outgoing_sub' | 'outgoing_sub_sub' | 'main' | 'submeter' | 'outgoing';
  location: string;
  parent_meter_id?: string | null;
  section_id?: string | null;
  multiplication_factor?: number;
}): Promise<{ success: boolean; message: string }> {
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

  const isSub = formData.type === 'outgoing_sub' || formData.type === 'submeter' || formData.type === 'outgoing_sub_sub';

  const { error } = await supabase.from('meters').insert({
    name: formData.name,
    type: formData.type,
    location: formData.location,
    parent_meter_id: isSub ? formData.parent_meter_id || null : null,
    section_id: formData.section_id || null,
    multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
  });

  if (error) {
    console.error('Error adding meter:', error);
    return { success: false, message: `Failed to add meter: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/dashboard');
  revalidatePath('/consumption');

  return { success: true, message: `Meter "${formData.name}" added successfully!` };
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

  const isSub = formData.type === 'outgoing_sub' || formData.type === 'submeter' || formData.type === 'outgoing_sub_sub';

  const { error } = await supabase
    .from('meters')
    .update({
      name: formData.name,
      type: formData.type,
      location: formData.location,
      parent_meter_id: isSub ? formData.parent_meter_id || null : null,
      section_id: formData.section_id || null,
      multiplication_factor: formData.multiplication_factor != null ? Number(formData.multiplication_factor) : 1,
    })
    .eq('id', id);

  if (error) {
    console.error('Error updating meter:', error);
    return { success: false, message: `Failed to update meter: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/dashboard');
  revalidatePath('/consumption');

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

    revalidatePath('/settings');
    return {
      success: true,
      message: 'Meter has existing readings and was deactivated instead of deleted.',
    };
  }

  const { error } = await supabase.from('meters').delete().eq('id', id);

  if (error) {
    return { success: false, message: `Failed to delete meter: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/dashboard');

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
  revalidatePath('/consumption');

  return { success: true, message: 'Meter order updated successfully!' };
}

// ─── Meter Section Actions ───

export async function addMeterSection(
  name: string,
  icon: string = '⚡',
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
    icon: icon.trim() || '⚡',
    color: color.trim() || 'accent',
    unit: unit.trim() || 'kWh',
  });

  if (error) {
    console.error('Error adding section:', error);
    return { success: false, message: `Failed to add section: ${error.message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/log-reading');
  revalidatePath('/consumption');

  return { success: true, message: `Section "${trimmed}" added successfully!` };
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
  revalidatePath('/consumption');

  return { success: true, message: 'Section deleted successfully!' };
}

