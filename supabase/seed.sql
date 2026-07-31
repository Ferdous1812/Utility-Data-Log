-- ============================================================
-- Seed File for Digital Meter Logbook
-- Run this in your Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- Seed Sample Factory Meters
INSERT INTO public.meters (id, name, type, location) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Main Feeder 01', 'main', 'Substation A'),
  ('11111111-0000-0000-0000-000000000002', 'Main Feeder 02', 'main', 'Substation B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meters (id, name, type, location, parent_meter_id) VALUES
  ('22222222-0000-0000-0000-000000000003', 'Assembly Line A', 'submeter', 'Building 1', '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000004', 'Packaging Dept', 'submeter', 'Building 2', '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000005', 'HVAC System', 'submeter', 'Rooftop Plant', '11111111-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;
