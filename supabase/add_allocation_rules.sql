-- ============================================================
-- Rule-Based Allocation Engine Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Adds support for "Calculated Remainder" allocation, alongside
-- the existing flat "Direct Assignment" (unit_allocations) model.
-- ============================================================

-- 1. Track which allocation mode each unit is currently configured for.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS allocation_mode TEXT NOT NULL DEFAULT 'direct'
  CHECK (allocation_mode IN ('direct', 'calculated_remainder'));

-- 2. One remainder rule per unit:
--    unit_share = (base_source_meter - SUM(deduction meters)) * remainder_share_percent
CREATE TABLE IF NOT EXISTS public.unit_remainder_rules (
  unit_id UUID PRIMARY KEY REFERENCES public.units(id) ON DELETE CASCADE,
  base_source_meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE RESTRICT,
  deduction_meter_ids UUID[] NOT NULL DEFAULT '{}',
  remainder_share_percent NUMERIC NOT NULL DEFAULT 100 CHECK (remainder_share_percent >= 0 AND remainder_share_percent <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.unit_remainder_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "unit_remainder_rules_select" ON public.unit_remainder_rules FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_remainder_rules_insert_admin" ON public.unit_remainder_rules FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_remainder_rules_update_admin" ON public.unit_remainder_rules FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "unit_remainder_rules_delete_admin" ON public.unit_remainder_rules FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Keep updated_at fresh on every edit.
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
