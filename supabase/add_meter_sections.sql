-- ============================================================
-- Complete Clean Migration Script
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Ensure sort_order column exists on meters table
ALTER TABLE public.meters ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 2. Create meter_sections table
CREATE TABLE IF NOT EXISTS public.meter_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '⚡',
  color TEXT NOT NULL DEFAULT 'accent',
  unit TEXT NOT NULL DEFAULT 'kWh',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure unit column exists on meter_sections table (if table pre-existed)
ALTER TABLE public.meter_sections ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'kWh';

-- Enable Row Level Security (RLS) on meter_sections
ALTER TABLE public.meter_sections ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
DO $$ BEGIN
  CREATE POLICY "meter_sections_select" ON public.meter_sections FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meter_sections_insert_admin" ON public.meter_sections FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meter_sections_update_admin" ON public.meter_sections FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meter_sections_delete_admin" ON public.meter_sections FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Seed default sections
INSERT INTO public.meter_sections (name, icon, color, unit, sort_order) VALUES
  ('Energy Meter', '⚡', 'accent', 'kWh', 0),
  ('Gas Meter', '🔥', 'warning', 'm³', 1),
  ('Hour Meter', '⏱️', 'success', 'hrs', 2)
ON CONFLICT DO NOTHING;

-- Explicitly update units for default sections
UPDATE public.meter_sections SET unit = 'kWh' WHERE name = 'Energy Meter';
UPDATE public.meter_sections SET unit = 'm³' WHERE name = 'Gas Meter';
UPDATE public.meter_sections SET unit = 'hrs' WHERE name = 'Hour Meter';

-- 4. Add section_id column to meters table
ALTER TABLE public.meters ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.meter_sections(id) ON DELETE SET NULL;

-- 5. Assign all existing unassigned meters to "Energy Meter" section
UPDATE public.meters
SET section_id = (SELECT id FROM public.meter_sections WHERE name = 'Energy Meter' LIMIT 1)
WHERE section_id IS NULL;
