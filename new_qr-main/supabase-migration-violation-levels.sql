-- =====================================================================
-- Migration: blocklist violation levels (run once on an existing database
-- that already has section 16/17 of supabase-schema-complete.sql applied)
-- Run in: Supabase Dashboard > SQL Editor
-- =====================================================================
-- Violation levels: 1st and 2nd warnings are recorded and emailed;
-- gate_block denies entry at every campus until blocked_until.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'violation_level_enum') THEN
    CREATE TYPE violation_level_enum AS ENUM ('first_warning', 'second_warning', 'gate_block');
  END IF;
END $$;

-- Rejected / flagged gate attempts (duplicate entry, wrong campus exit, blocked) are logged with this status
ALTER TYPE logged_status_enum ADD VALUE IF NOT EXISTS 'denied';

DROP VIEW IF EXISTS public.active_blocklist;

ALTER TABLE public.blocklist DROP CONSTRAINT IF EXISTS blocklist_duration_chk;
ALTER TABLE public.blocklist RENAME COLUMN "when" TO recorded_at;
ALTER TABLE public.blocklist RENAME COLUMN how_long TO blocked_until;
ALTER TABLE public.blocklist ALTER COLUMN blocked_until DROP NOT NULL;
ALTER TABLE public.blocklist ADD COLUMN violation_level violation_level_enum NOT NULL;
ALTER TABLE public.blocklist ADD COLUMN evidence_image TEXT;
ALTER TABLE public.blocklist ADD CONSTRAINT blocklist_block_end_chk CHECK (
  (violation_level = 'gate_block' AND blocked_until IS NOT NULL AND blocked_until > recorded_at)
  OR (violation_level <> 'gate_block' AND blocked_until IS NULL)
);

DROP INDEX IF EXISTS idx_blocklist_how_long;
CREATE INDEX IF NOT EXISTS idx_blocklist_blocked_until
  ON public.blocklist (blocked_until DESC) WHERE violation_level = 'gate_block';

CREATE VIEW public.active_blocklist
WITH (security_invoker = true) AS
SELECT
  b.*,
  GREATEST(0, EXTRACT(EPOCH FROM (b.blocked_until - NOW()))::BIGINT) AS seconds_remaining
FROM public.blocklist b
WHERE b.violation_level = 'gate_block'
  AND b.blocked_until > NOW();

CREATE OR REPLACE FUNCTION verify_gate_entry(
  p_qr_code   VARCHAR,
  p_gate_text VARCHAR DEFAULT 'main'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg        RECORD;
  v_veh        RECORD;
  v_gate       campus_gate_enum := 'main';
  v_inside     BOOLEAN;
  v_log_id     INTEGER;
  v_block      RECORD;
BEGIN
  IF LOWER(p_gate_text) LIKE '%rnp%' THEN
    v_gate := 'rnp';
  ELSIF LOWER(p_gate_text) LIKE '%paseo%' THEN
    v_gate := 'paseo';
  ELSE
    v_gate := 'main';
  END IF;

  SELECT * INTO v_reg
  FROM registration
  WHERE qr_code = p_qr_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_QR', 'message', 'QR code not found.');
  END IF;

  IF v_reg.status != 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'NOT_APPROVED',
      'message', 'Registration status is ' || v_reg.status::text
    );
  END IF;

  IF v_reg.expires_at IS NOT NULL AND v_reg.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'status', 'EXPIRED', 'message', 'Sticker has expired.');
  END IF;

  -- Gate block (3rd violation level) applies to every campus gate (main, rnp, paseo)
  SELECT * INTO v_block
  FROM blocklist b
  WHERE (b.registration_id = v_reg.registration_id OR b.vehicle_id = v_reg.vehicle_information_id)
    AND b.violation_level = 'gate_block'
    AND b.blocked_until > NOW()
  ORDER BY b.blocked_until DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'BLOCKED',
      'message', 'Vehicle is blocked: ' || v_block.reason,
      'blocked_until', v_block.blocked_until,
      'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (v_block.blocked_until - NOW()))::BIGINT),
      'block_by', v_block.block_by::text
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM vehicle_log
    WHERE registration_id = v_reg.registration_id
      AND check_out IS NULL
      AND logged_status = 'inside_campus'
  ) INTO v_inside;

  IF v_inside THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'ALREADY_INSIDE',
      'message', 'Vehicle is already recorded as inside campus.'
    );
  END IF;

  SELECT * INTO v_veh
  FROM vehicle_information
  WHERE vehicle_information_id = v_reg.vehicle_information_id;

  INSERT INTO vehicle_log (
    registration_id,
    vehicle_information_id,
    campus_gate,
    logged_status,
    sticker_status,
    check_in
  ) VALUES (
    v_reg.registration_id,
    v_reg.vehicle_information_id,
    v_gate,
    'inside_campus',
    'registered',
    NOW()
  ) RETURNING vehicle_log_id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ALLOWED',
    'vehicle_log_id', v_log_id,
    'owner_name', v_reg.first_name || ' ' || v_reg.last_name,
    'plate_number', v_veh.plate_number,
    'role', v_reg.role::text,
    'vehicle_type', v_veh.type::text
  );
END;
$$;
