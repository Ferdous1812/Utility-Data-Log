-- ============================================================
-- Mixed Allocation Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
--
-- Previously a Unit was locked into ONE engine at a time:
-- either flat "Direct Assignment" (unit_allocations) OR a single
-- "Calculated Remainder" rule (unit_remainder_rules, unit_id as PK).
--
-- This migration lets a Unit use BOTH at once, and allows MULTIPLE
-- remainder rules per unit (e.g. one shared feed per group of
-- unmetered warehouses). A unit's total consumption becomes:
--
--   SUM(direct allocations) + SUM(each remainder rule's contribution)
-- ============================================================

-- 1. Give unit_remainder_rules its own id so a unit can have many rows.
ALTER TABLE public.unit_remainder_rules
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Backfill ids for any pre-existing rows (safe no-op if table is empty).
UPDATE public.unit_remainder_rules SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE public.unit_remainder_rules ALTER COLUMN id SET NOT NULL;

-- 2. Drop the old unit_id-as-primary-key constraint (was 1 rule/unit).
ALTER TABLE public.unit_remainder_rules DROP CONSTRAINT IF EXISTS unit_remainder_rules_pkey;

-- 3. Make id the new primary key.
ALTER TABLE public.unit_remainder_rules ADD PRIMARY KEY (id);

-- 4. unit_id is now a regular (non-unique) foreign key — add an index
--    since it will be queried/filtered on constantly.
CREATE INDEX IF NOT EXISTS idx_unit_remainder_rules_unit_id
  ON public.unit_remainder_rules (unit_id);

-- Note: units.allocation_mode is no longer read by the app (both engines
-- always combine now). The column is left in place, unused, so no data
-- is lost and no other integration is broken by dropping it.
