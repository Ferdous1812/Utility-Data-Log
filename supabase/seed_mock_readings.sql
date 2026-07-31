-- ============================================================
-- Seed Mock Readings for Testing & Verification
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- Adds realistic readings on the 30th of April, May, June, & July 2026 for all meters
-- ============================================================

DO $$
DECLARE
  profile_user_id UUID;
  m RECORD;
  base_val NUMERIC;
  inc_may NUMERIC;
  inc_june NUMERIC;
  inc_july NUMERIC;
BEGIN
  -- Get any valid profile ID to set as logged_by
  SELECT id INTO profile_user_id FROM public.profiles LIMIT 1;

  -- If no profile exists, skip logged_by enforcement or insert fallback
  IF profile_user_id IS NULL THEN
    RAISE NOTICE 'No profile found in public.profiles. Please log in or create a user profile first.';
    RETURN;
  END IF;

  -- Loop through all active meters
  FOR m IN SELECT id, name, type FROM public.meters WHERE is_active = true LOOP

    -- Determine base value & increments according to meter type
    IF m.type IN ('incoming', 'main') THEN
      base_val := 45000.00;
      inc_may := 12500.00;
      inc_june := 13800.00;
      inc_july := 14200.00;
    ELSIF m.type IN ('outgoing_main', 'outgoing') THEN
      base_val := 18000.00;
      inc_may := 5200.00;
      inc_june := 5600.00;
      inc_july := 5900.00;
    ELSIF m.type IN ('outgoing_sub', 'submeter') THEN
      base_val := 6000.00;
      inc_may := 1800.00;
      inc_june := 1950.00;
      inc_july := 2100.00;
    ELSE -- outgoing_sub_sub or others
      base_val := 1500.00;
      inc_may := 450.00;
      inc_june := 520.00;
      inc_july := 580.00;
    END IF;

    -- Add slight variation per meter id hash to avoid identical values
    base_val := base_val + (hashtext(m.id::text) % 500);
    inc_may := inc_may + (hashtext(m.name) % 150);
    inc_june := inc_june + (hashtext(m.name) % 180);
    inc_july := inc_july + (hashtext(m.name) % 200);

    -- Delete old mock readings for these exact 30th dates to allow re-running cleanly
    DELETE FROM public.readings
    WHERE meter_id = m.id
      AND reading_date IN ('2026-04-30', '2026-05-30', '2026-06-30', '2026-07-30');

    -- Insert April 30, 2026 reading (Initial Baseline)
    INSERT INTO public.readings (meter_id, reading_value, reading_date, logged_by)
    VALUES (m.id, round(base_val, 2), '2026-04-30', profile_user_id);

    -- Insert May 30, 2026 reading
    INSERT INTO public.readings (meter_id, reading_value, reading_date, logged_by)
    VALUES (m.id, round(base_val + inc_may, 2), '2026-05-30', profile_user_id);

    -- Insert June 30, 2026 reading
    INSERT INTO public.readings (meter_id, reading_value, reading_date, logged_by)
    VALUES (m.id, round(base_val + inc_may + inc_june, 2), '2026-06-30', profile_user_id);

    -- Insert July 30, 2026 reading
    INSERT INTO public.readings (meter_id, reading_value, reading_date, logged_by)
    VALUES (m.id, round(base_val + inc_may + inc_june + inc_july, 2), '2026-07-30', profile_user_id);

  END LOOP;

  RAISE NOTICE 'Mock readings successfully seeded for all meters on 30th of April, May, June, & July 2026!';
END $$;
