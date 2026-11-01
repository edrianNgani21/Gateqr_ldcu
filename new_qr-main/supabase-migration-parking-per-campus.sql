-- =====================================================================
-- GateQR: parking_capacity = one row of limits per campus; occupancy comes live from gate_log
-- gate_log.campus_gate references parking_capacity, so every gate_log row still inside is one
-- occupied slot of its campus. Run after supabase-migration-clean-names.sql.
-- =====================================================================
BEGIN;

-- The per-event snapshot writer is replaced by the campus_occupancy view
DROP TRIGGER IF EXISTS trg_vehicle_log_parking_sync ON public.gate_log;
DROP FUNCTION IF EXISTS public.trg_sync_parking_availability();

-- Keep the latest limits per campus, drop the older snapshots
DELETE FROM public.parking_capacity p
USING public.parking_capacity newer
WHERE newer.campus_gate = p.campus_gate
  AND (newer.recorded_at, newer.parking_capacity_id) > (p.recorded_at, p.parking_capacity_id);

ALTER TABLE public.parking_capacity DROP CONSTRAINT IF EXISTS parking_capacity_pkey;
ALTER TABLE public.parking_capacity DROP CONSTRAINT IF EXISTS parking_availability_pkey;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS parking_capacity_id;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS occupied;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS available;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS occupied_2_wheels;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS occupied_4_wheels;
ALTER TABLE public.parking_capacity RENAME COLUMN recorded_at TO updated_at;
ALTER TABLE public.parking_capacity ALTER COLUMN campus_gate SET NOT NULL;
ALTER TABLE public.parking_capacity ADD PRIMARY KEY (campus_gate);

-- Every campus has a row (default limit 200, same as before when a campus had none)
INSERT INTO public.parking_capacity (campus_gate, capacity, updated_at)
SELECT g::public.campus_gate_enum, 200, now()
FROM unnest(enum_range(NULL::public.campus_gate_enum)) AS g
ON CONFLICT (campus_gate) DO NOTHING;

-- gate_log -> parking_capacity
UPDATE public.gate_log SET campus_gate = 'main' WHERE campus_gate IS NULL;
ALTER TABLE public.gate_log ALTER COLUMN campus_gate SET DEFAULT 'main';
ALTER TABLE public.gate_log ALTER COLUMN campus_gate SET NOT NULL;
ALTER TABLE public.gate_log
  ADD CONSTRAINT gate_log_campus_gate_fkey FOREIGN KEY (campus_gate)
  REFERENCES public.parking_capacity (campus_gate) ON UPDATE CASCADE;

-- Live occupancy per campus. A registered vehicle counts once even if it has several open logs;
-- guests / VIPs (which share a placeholder registration) count per log, as main.py does.
-- Unknown vehicle type counts as 4-wheel.
CREATE OR REPLACE VIEW public.campus_occupancy
WITH (security_invoker = true) AS
SELECT
  p.campus_gate,
  p.capacity,
  p.capacity_2_wheels,
  p.capacity_4_wheels,
  p.event_name,
  p.updated_at,
  COALESCE(o.occupied, 0)          AS occupied,
  COALESCE(o.occupied_2_wheels, 0) AS occupied_2_wheels,
  COALESCE(o.occupied_4_wheels, 0) AS occupied_4_wheels,
  GREATEST(0, p.capacity - COALESCE(o.occupied, 0)) AS available
FROM public.parking_capacity p
LEFT JOIN (
  SELECT
    inside.campus_gate,
    COUNT(*) AS occupied,
    COUNT(*) FILTER (WHERE v.vehicle_type = '2_wheels') AS occupied_2_wheels,
    COUNT(*) FILTER (WHERE v.vehicle_type IS DISTINCT FROM '2_wheels') AS occupied_4_wheels
  FROM (
    SELECT DISTINCT ON (
        gl.campus_gate,
        COALESCE(CASE WHEN gl.is_vip OR gl.guest_id IS NOT NULL THEN NULL ELSE gl.registration_id::text END, 'log' || gl.gate_log_id)
      )
      gl.campus_gate, gl.vehicle_id
    FROM public.gate_log gl
    WHERE gl.exited_at IS NULL AND gl.presence_status = 'inside_campus'
  ) inside
  LEFT JOIN public.vehicle v ON v.vehicle_id = inside.vehicle_id
  GROUP BY inside.campus_gate
) o ON o.campus_gate = p.campus_gate;

GRANT SELECT ON public.campus_occupancy TO authenticated, service_role;

COMMIT;
