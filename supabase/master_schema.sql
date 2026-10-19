-- ============================================================================
--  UTILITY DATA LOG — MASTER DATABASE SCHEMA  (single source of truth)
--
--  Run this ONE file in the Supabase SQL Editor (Dashboard → SQL Editor).
--  It is idempotent: safe on a brand-new project AND on a database that
--  already has any earlier version of the schema (it only adds what is missing
--  and refreshes functions, triggers and views). No existing data is changed
--  or deleted.
--
--  Contents
--    1. Profiles ........................ users / roles (admin | operator)
--    2. Meter sections .................. Energy / Gas / Hour tabs (+ defaults)
--    3. Meters + Readings ............... generic meter log (legacy `readings`)
--    4. Units & allocation rules ........ direct + calculated-remainder
--    5. Energy meters ................... meters, devices/branches, reading logs
--    6. Hour meters ..................... meters, devices, reading logs
--    7. Gas meters ...................... meters, devices, reading logs
--    8. Usage triggers .................. auto usage = reading - previous
--    9. Views ........................... monthly usage
--   10. Row Level Security .............. admin-write / authenticated-read
--
--  Split (Peak / Off-Peak) energy meters: energy_meters.reading_mode = 'split'
--  makes the meter's devices parallel branches whose usage is SUMMED.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES  (extends auth.users)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. METER SECTIONS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meter_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '⚡',
  color       TEXT NOT NULL DEFAULT 'accent',
  unit        TEXT NOT NULL DEFAULT 'kWh',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.meter_sections ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'kWh';

-- Default sections (inserted only if a section with that name does not exist)
INSERT INTO public.meter_sections (name, icon, color, unit, sort_order)
SELECT v.name, v.icon, v.color, v.unit, v.sort_order
FROM (VALUES
  ('Energy Meter', '⚡',  'accent',  'kWh', 0),
  ('Gas Meter',    '🔥', 'warning', 'm³',  1),
  ('Hour Meter',   '⏱️', 'success', 'hrs', 2)
) AS v(name, icon, color, unit, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.meter_sections s WHERE s.name = v.name);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. METERS + READINGS  (generic meter log)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meters (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL,
  location               TEXT NOT NULL DEFAULT '',
  parent_meter_id        UUID REFERENCES public.meters(id) ON DELETE SET NULL,
  section_id             UUID REFERENCES public.meter_sections(id) ON DELETE SET NULL,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  multiplication_factor  NUMERIC NOT NULL DEFAULT 1,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.meters ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.meters ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.meter_sections(id) ON DELETE SET NULL;

ALTER TABLE public.meters DROP CONSTRAINT IF EXISTS meters_type_check;
ALTER TABLE public.meters ADD CONSTRAINT meters_type_check CHECK (
  type IN ('incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub', 'main', 'submeter', 'outgoing')
);

CREATE TABLE IF NOT EXISTS public.readings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id       UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  reading_value  NUMERIC NOT NULL,
  reading_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  usage          NUMERIC,
  is_reset       BOOLEAN NOT NULL DEFAULT false,   -- new baseline: usage = NULL
  logged_by      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.readings ADD COLUMN IF NOT EXISTS is_reset BOOLEAN NOT NULL DEFAULT false;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. UNITS & ALLOCATION RULES
--    A unit's consumption = SUM(direct allocations) + SUM(remainder rules)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  allocation_mode  TEXT NOT NULL DEFAULT 'direct' CHECK (allocation_mode IN ('direct', 'calculated_remainder')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- (allocation_mode is no longer read by the app; kept so no data/integration breaks)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS allocation_mode TEXT NOT NULL DEFAULT 'direct'
  CHECK (allocation_mode IN ('direct', 'calculated_remainder'));

CREATE TABLE IF NOT EXISTS public.unit_allocations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES public.units(id)  ON DELETE CASCADE,
  meter_id    UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  percentage  NUMERIC NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_id, meter_id)
);

-- Many remainder rules per unit:
--   contribution = (base_source_meter - SUM(deduction meters)) * remainder_share_percent
CREATE TABLE IF NOT EXISTS public.unit_remainder_rules (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                  UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  base_source_meter_id     UUID NOT NULL REFERENCES public.meters(id) ON DELETE RESTRICT,
  deduction_meter_ids      UUID[] NOT NULL DEFAULT '{}',
  remainder_share_percent  NUMERIC NOT NULL DEFAULT 100
                           CHECK (remainder_share_percent >= 0 AND remainder_share_percent <= 100),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade path for databases where unit_id was still the primary key (1 rule per unit)
ALTER TABLE public.unit_remainder_rules ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE public.unit_remainder_rules SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.unit_remainder_rules ALTER COLUMN id SET NOT NULL;
DO $$
DECLARE pk_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
  WHERE i.indrelid = 'public.unit_remainder_rules'::regclass AND i.indisprimary;
  IF pk_cols IS DISTINCT FROM 'id' THEN
    ALTER TABLE public.unit_remainder_rules DROP CONSTRAINT IF EXISTS unit_remainder_rules_pkey;
    ALTER TABLE public.unit_remainder_rules ADD PRIMARY KEY (id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_unit_remainder_rules_unit_id ON public.unit_remainder_rules (unit_id);

CREATE OR REPLACE FUNCTION public.touch_unit_remainder_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_unit_remainder_rules ON public.unit_remainder_rules;
CREATE TRIGGER trg_touch_unit_remainder_rules
  BEFORE UPDATE ON public.unit_remainder_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_unit_remainder_rules_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ENERGY METERS
--    energy_meters         logical / named meter (shown in the Energy tree)
--    energy_meter_devices  checkpoints (series)  OR  branches (parallel) of a meter
--    energy_reading_logs   timestamped readings, one per device
--
--    reading_mode = 'checkpoint' (default): only the billing-primary device counts
--    reading_mode = 'split'               : usage = SUM of all branch devices
--                                           (e.g. REB → Peak + Off-Peak)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.energy_meters (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  section                TEXT NOT NULL CHECK (section IN ('incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub')),
  category               TEXT NOT NULL DEFAULT 'General',
  parent_id              UUID REFERENCES public.energy_meters(id) ON DELETE SET NULL,
  multiplication_factor  NUMERIC NOT NULL DEFAULT 1.0,
  is_primary_for_total   BOOLEAN NOT NULL DEFAULT true,
  reading_mode           TEXT NOT NULL DEFAULT 'checkpoint',
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.energy_meters ADD COLUMN IF NOT EXISTS reading_mode TEXT NOT NULL DEFAULT 'checkpoint';
ALTER TABLE public.energy_meters DROP CONSTRAINT IF EXISTS energy_meters_reading_mode_check;
ALTER TABLE public.energy_meters ADD CONSTRAINT energy_meters_reading_mode_check
  CHECK (reading_mode IN ('checkpoint', 'split'));

CREATE TABLE IF NOT EXISTS public.energy_meter_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id            UUID NOT NULL REFERENCES public.energy_meters(id) ON DELETE CASCADE,
  checkpoint_label    TEXT NOT NULL,                    -- checkpoint name, or branch name (Peak / Off-Peak)
  serial_number       TEXT NOT NULL DEFAULT '',
  is_billing_primary  BOOLEAN NOT NULL DEFAULT false,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.energy_reading_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      UUID NOT NULL REFERENCES public.energy_meter_devices(id) ON DELETE CASCADE,
  reading_value  NUMERIC NOT NULL,
  reading_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  usage          NUMERIC,                               -- auto-calculated by trigger
  is_reset       BOOLEAN NOT NULL DEFAULT false,
  operator_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.energy_reading_logs ADD COLUMN IF NOT EXISTS is_reset BOOLEAN NOT NULL DEFAULT false;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. HOUR METERS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hour_meters (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  equipment_group        TEXT NOT NULL DEFAULT 'Compressor'
                         CHECK (equipment_group IN ('Compressor', 'Pump', 'Generator', 'Other')),
  category               TEXT NOT NULL DEFAULT 'General',
  multiplication_factor  NUMERIC NOT NULL DEFAULT 1.0,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hour_meter_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id            UUID NOT NULL REFERENCES public.hour_meters(id) ON DELETE CASCADE,
  checkpoint_label    TEXT NOT NULL DEFAULT 'Primary Meter',
  serial_number       TEXT NOT NULL DEFAULT '',
  is_billing_primary  BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hour_reading_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      UUID NOT NULL REFERENCES public.hour_meter_devices(id) ON DELETE CASCADE,
  reading_value  NUMERIC NOT NULL,
  reading_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  usage          NUMERIC,
  is_reset       BOOLEAN NOT NULL DEFAULT false,
  operator_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.hour_reading_logs ADD COLUMN IF NOT EXISTS is_reset BOOLEAN NOT NULL DEFAULT false;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. GAS METERS
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gas_meters (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  section                TEXT NOT NULL DEFAULT 'incoming'
                         CHECK (section IN ('incoming', 'outgoing_main', 'outgoing_sub', 'outgoing_sub_sub')),
  category               TEXT NOT NULL DEFAULT 'General',
  parent_id              UUID REFERENCES public.gas_meters(id) ON DELETE SET NULL,
  multiplication_factor  NUMERIC NOT NULL DEFAULT 1.0,
  is_primary_for_total   BOOLEAN NOT NULL DEFAULT true,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gas_meter_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id            UUID NOT NULL REFERENCES public.gas_meters(id) ON DELETE CASCADE,
  checkpoint_label    TEXT NOT NULL DEFAULT 'Primary Meter',
  serial_number       TEXT NOT NULL DEFAULT '',
  is_billing_primary  BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gas_reading_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      UUID NOT NULL REFERENCES public.gas_meter_devices(id) ON DELETE CASCADE,
  reading_value  NUMERIC NOT NULL,
  reading_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  usage          NUMERIC,
  is_reset       BOOLEAN NOT NULL DEFAULT false,
  operator_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gas_reading_logs ADD COLUMN IF NOT EXISTS is_reset BOOLEAN NOT NULL DEFAULT false;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. USAGE TRIGGERS
--    usage = reading_value - previous reading (same meter / device).
--    A reset reading starts a new baseline: usage = NULL, history is kept.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_usage()
RETURNS TRIGGER AS $$
DECLARE
  prev_value NUMERIC;
BEGIN
  IF NEW.is_reset = TRUE THEN
    NEW.usage := NULL;
    RETURN NEW;
  END IF;

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
  FOR EACH ROW EXECUTE FUNCTION public.calculate_usage();


CREATE OR REPLACE FUNCTION public.calculate_energy_usage()
RETURNS TRIGGER AS $$
DECLARE
  prev_value NUMERIC;
BEGIN
  IF NEW.is_reset = TRUE THEN
    NEW.usage := NULL;
    RETURN NEW;
  END IF;

  SELECT reading_value INTO prev_value
  FROM public.energy_reading_logs
  WHERE device_id = NEW.device_id
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

DROP TRIGGER IF EXISTS trg_calculate_energy_usage ON public.energy_reading_logs;
CREATE TRIGGER trg_calculate_energy_usage
  BEFORE INSERT OR UPDATE ON public.energy_reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.calculate_energy_usage();


CREATE OR REPLACE FUNCTION public.calculate_hour_usage()
RETURNS TRIGGER AS $$
DECLARE
  prev_value NUMERIC;
BEGIN
  IF NEW.is_reset = TRUE THEN
    NEW.usage := NULL;
    RETURN NEW;
  END IF;

  SELECT reading_value INTO prev_value
  FROM public.hour_reading_logs
  WHERE device_id = NEW.device_id
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

DROP TRIGGER IF EXISTS trg_calculate_hour_usage ON public.hour_reading_logs;
CREATE TRIGGER trg_calculate_hour_usage
  BEFORE INSERT OR UPDATE ON public.hour_reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.calculate_hour_usage();


CREATE OR REPLACE FUNCTION public.calculate_gas_usage()
RETURNS TRIGGER AS $$
DECLARE
  prev_value NUMERIC;
BEGIN
  IF NEW.is_reset = TRUE THEN
    NEW.usage := NULL;
    RETURN NEW;
  END IF;

  SELECT reading_value INTO prev_value
  FROM public.gas_reading_logs
  WHERE device_id = NEW.device_id
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

DROP TRIGGER IF EXISTS trg_calculate_gas_usage ON public.gas_reading_logs;
CREATE TRIGGER trg_calculate_gas_usage
  BEFORE INSERT OR UPDATE ON public.gas_reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.calculate_gas_usage();


-- ────────────────────────────────────────────────────────────────────────────
-- 9. VIEWS
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.monthly_usage AS
SELECT
  m.id        AS meter_id,
  m.name      AS meter_name,
  m.type      AS meter_type,
  m.location  AS meter_location,
  DATE_TRUNC('month', r.reading_date) AS month,
  SUM(r.usage)  AS total_usage,
  COUNT(r.id)   AS reading_count
FROM public.readings r
JOIN public.meters m ON m.id = r.meter_id
WHERE r.usage IS NOT NULL
GROUP BY m.id, m.name, m.type, m.location, DATE_TRUNC('month', r.reading_date);

CREATE OR REPLACE VIEW public.energy_monthly_usage AS
SELECT
  em.id                 AS meter_id,
  em.name               AS meter_name,
  em.section            AS meter_section,
  em.category           AS meter_category,
  em.multiplication_factor,
  em.parent_id,
  emd.id                AS device_id,
  emd.checkpoint_label,
  emd.is_billing_primary,
  DATE_TRUNC('month', erl.reading_date) AS month,
  SUM(erl.usage)        AS total_usage,
  COUNT(erl.id)         AS reading_count
FROM public.energy_reading_logs erl
JOIN public.energy_meter_devices emd ON emd.id = erl.device_id
JOIN public.energy_meters em         ON em.id  = emd.meter_id
WHERE erl.usage IS NOT NULL
GROUP BY
  em.id, em.name, em.section, em.category, em.multiplication_factor, em.parent_id,
  emd.id, emd.checkpoint_label, emd.is_billing_primary,
  DATE_TRUNC('month', erl.reading_date);


-- ────────────────────────────────────────────────────────────────────────────
-- 10. ROW LEVEL SECURITY
--     • everyone signed in can READ everything
--     • only admins can INSERT / UPDATE / DELETE configuration tables
--     • reading tables: anyone can INSERT their own reading; admins edit/delete
--     Existing policies with the same name are left untouched.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t          TEXT;
  own_col    TEXT;
  admin_chk  TEXT := 'EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = ''admin'')';

  config_tables TEXT[] := ARRAY[
    'meter_sections', 'meters', 'units', 'unit_allocations', 'unit_remainder_rules',
    'energy_meters', 'energy_meter_devices',
    'hour_meters',   'hour_meter_devices',
    'gas_meters',    'gas_meter_devices'
  ];
  -- reading tables → column holding the logged-in user's id
  log_tables TEXT[] := ARRAY['readings', 'energy_reading_logs', 'hour_reading_logs', 'gas_reading_logs'];
  log_owner  TEXT[] := ARRAY['logged_by', 'operator_id',        'operator_id',       'operator_id'];
  i INTEGER;

BEGIN
  -- profiles
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select') THEN
    CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own') THEN
    CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
      USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_admin') THEN
    CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
  END IF;

  -- configuration tables: read all, admin write
  FOREACH t IN ARRAY config_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_insert_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t || '_insert_admin', t, admin_chk);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_update_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s)', t || '_update_admin', t, admin_chk);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_delete_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', t || '_delete_admin', t, admin_chk);
    END IF;
  END LOOP;

  -- reading tables: read all, insert own, admin edit/delete
  FOR i IN 1 .. array_length(log_tables, 1) LOOP
    t := log_tables[i];
    own_col := log_owner[i];
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_select') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_insert') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = %I)', t || '_insert', t, own_col);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_update_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s)', t || '_update_admin', t, admin_chk);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_delete_admin') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', t || '_delete_admin', t, admin_chk);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
--  END OF MASTER SCHEMA
-- ============================================================================
