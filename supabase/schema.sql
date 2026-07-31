-- ============================================================
-- Digital Meter Logbook — Supabase Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ────────────────────────────────────────────
-- 1. PROFILES TABLE (extends auth.users)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────
-- 2. METER SECTIONS TABLE
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meter_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '⚡',
  color TEXT NOT NULL DEFAULT 'accent',
  unit TEXT NOT NULL DEFAULT 'kWh',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meter_sections ENABLE ROW LEVEL SECURITY;

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

-- ────────────────────────────────────────────
-- 3. METERS TABLE
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub', 'main', 'submeter', 'outgoing')),
  location TEXT NOT NULL DEFAULT '',
  parent_meter_id UUID REFERENCES public.meters(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.meter_sections(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  multiplication_factor NUMERIC NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meters DROP CONSTRAINT IF EXISTS meters_type_check;
ALTER TABLE public.meters ADD CONSTRAINT meters_type_check CHECK (type IN ('incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub', 'main', 'submeter', 'outgoing'));

ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "meters_select" ON public.meters FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meters_insert_admin" ON public.meters FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meters_update_admin" ON public.meters FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "meters_delete_admin" ON public.meters FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────
-- 4. READINGS TABLE
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  reading_value NUMERIC NOT NULL,
  reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
  usage NUMERIC,
  logged_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.readings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "readings_select" ON public.readings FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "readings_insert" ON public.readings FOR INSERT TO authenticated WITH CHECK (auth.uid() = logged_by);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "readings_update_admin" ON public.readings FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "readings_delete_admin" ON public.readings FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────
-- 5. UNITS & UNIT ALLOCATIONS TABLES
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "units_select" ON public.units FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "units_insert_admin" ON public.units FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "units_update_admin" ON public.units FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "units_delete_admin" ON public.units FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.unit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  percentage NUMERIC NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(unit_id, meter_id)
);

ALTER TABLE public.unit_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "unit_allocations_select" ON public.unit_allocations FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_allocations_insert_admin" ON public.unit_allocations FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_allocations_update_admin" ON public.unit_allocations FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_allocations_delete_admin" ON public.unit_allocations FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────
-- 6. AUTO-CALCULATE USAGE TRIGGER
-- ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_usage()
RETURNS TRIGGER AS $$
DECLARE
  prev_value NUMERIC;
BEGIN
  SELECT reading_value INTO prev_value
  FROM public.readings
  WHERE meter_id = NEW.meter_id
    AND id != NEW.id
    AND (reading_date < NEW.reading_date
         OR (reading_date = NEW.reading_date AND created_at < NEW.created_at))
  ORDER BY reading_date DESC, created_at DESC
  LIMIT 1;

  IF prev_value IS NOT NULL THEN
    NEW.usage := NEW.reading_value - prev_value;
  ELSE
    NEW.usage := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_calculate_usage ON public.readings;
CREATE TRIGGER trg_calculate_usage
  BEFORE INSERT OR UPDATE ON public.readings
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_usage();

-- ────────────────────────────────────────────
-- 7. MONTHLY USAGE VIEW
-- ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.monthly_usage AS
SELECT
  m.id AS meter_id,
  m.name AS meter_name,
  m.type AS meter_type,
  m.location AS meter_location,
  DATE_TRUNC('month', r.reading_date) AS month,
  SUM(r.usage) AS total_usage,
  COUNT(r.id) AS reading_count
FROM public.readings r
JOIN public.meters m ON m.id = r.meter_id
WHERE r.usage IS NOT NULL
GROUP BY m.id, m.name, m.type, m.location, DATE_TRUNC('month', r.reading_date);
