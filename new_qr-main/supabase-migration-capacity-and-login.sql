-- =====================================================================
-- Migration: 2-wheel / 4-wheel parking limits + admin login email confirmation
-- Safe to run more than once. Run in: Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Parking limits per vehicle type
-- ---------------------------------------------------------------------
-- parking_capacity (total) stays as capacity_2_wheels + capacity_4_wheels once both are set.
ALTER TABLE public.parking_capacity ADD COLUMN IF NOT EXISTS capacity_2_wheels INTEGER CHECK (capacity_2_wheels >= 0);
ALTER TABLE public.parking_capacity ADD COLUMN IF NOT EXISTS capacity_4_wheels INTEGER CHECK (capacity_4_wheels >= 0);
ALTER TABLE public.parking_capacity ADD COLUMN IF NOT EXISTS occupied_2_wheels INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.parking_capacity ADD COLUMN IF NOT EXISTS occupied_4_wheels INTEGER NOT NULL DEFAULT 0;

-- Snapshot written after every gate entry/exit. It used to reset capacity to a hard-coded 200,
-- overwriting the limits Security had saved; it now carries the latest saved limits forward.
CREATE OR REPLACE FUNCTION trg_sync_parking_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate       campus_gate_enum;
  v_prev       RECORD;
  v_cap2       INTEGER;
  v_cap4       INTEGER;
  v_capacity   INTEGER;
  v_occ2       INTEGER := 0;
  v_occ4       INTEGER := 0;
  v_event_name VARCHAR(100);
BEGIN
  v_gate := COALESCE(NEW.campus_gate, 'main');

  SELECT * INTO v_prev
  FROM parking_capacity
  WHERE campus_gate = v_gate
  ORDER BY recorded_at DESC
  LIMIT 1;

  v_cap2 := v_prev.capacity_2_wheels;
  v_cap4 := v_prev.capacity_4_wheels;
  v_capacity := CASE
    WHEN v_cap2 IS NOT NULL AND v_cap4 IS NOT NULL THEN v_cap2 + v_cap4
    ELSE COALESCE(v_prev.parking_capacity, 200)
  END;

  -- Vehicles inside this gate, split by type (unknown type counts as 4-wheel)
  SELECT
    COUNT(*) FILTER (WHERE vi.type = '2_wheels'),
    COUNT(*) FILTER (WHERE vi.type IS DISTINCT FROM '2_wheels')
  INTO v_occ2, v_occ4
  FROM (
    SELECT DISTINCT ON (COALESCE(vl.registration_id::text, 'log' || vl.vehicle_log_id))
      vl.vehicle_information_id
    FROM vehicle_log vl
    WHERE vl.campus_gate = v_gate
      AND vl.check_out IS NULL
      AND vl.logged_status = 'inside_campus'
  ) inside
  LEFT JOIN vehicle_information vi ON vi.vehicle_information_id = inside.vehicle_information_id;

  SELECT event_name INTO v_event_name
  FROM campus_event
  WHERE campus_gate = v_gate
    AND is_active = TRUE
    AND NOW() BETWEEN start_date AND end_date
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO parking_capacity (
    vehicle_log_id, parking_capacity, capacity_2_wheels, capacity_4_wheels,
    slot_occupied, slot_unoccupied, occupied_2_wheels, occupied_4_wheels,
    recorded_at, campus_gate, event_name
  ) VALUES (
    NEW.vehicle_log_id, v_capacity, v_cap2, v_cap4,
    v_occ2 + v_occ4, GREATEST(0, v_capacity - (v_occ2 + v_occ4)), v_occ2, v_occ4,
    NOW(), v_gate, v_event_name
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- B. Admin login email confirmation ("Yes, this is me" / "This is not me")
-- ---------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'login_confirmation_status_enum') THEN
    CREATE TYPE login_confirmation_status_enum AS ENUM ('pending', 'approved', 'denied', 'used');
  END IF;
END $$;

-- One row per password login that needs the owner's email confirmation.
-- Only SHA-256 hashes of the secrets are stored: email_token_hash for the link in the email,
-- browser_token_hash for the waiting login screen (kept in an httpOnly cookie).
CREATE TABLE IF NOT EXISTS public.login_confirmation (
  login_confirmation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               INTEGER NOT NULL REFERENCES public.users (user_id) ON DELETE CASCADE,
  email_token_hash      TEXT NOT NULL UNIQUE,
  browser_token_hash    TEXT NOT NULL UNIQUE,
  status                login_confirmation_status_enum NOT NULL DEFAULT 'pending',
  session_role          TEXT NOT NULL,                 -- role / dashboard the session opens once confirmed
  redirect_url          TEXT NOT NULL,
  ip_address            TEXT,
  user_agent            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  decided_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_confirmation_user ON public.login_confirmation (user_id, created_at DESC);

-- Server-only table: no policies, so only the service role can read or write it
ALTER TABLE public.login_confirmation ENABLE ROW LEVEL SECURITY;
