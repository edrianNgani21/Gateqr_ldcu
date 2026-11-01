-- =====================================================================
-- GateQR: clean table and column names (run once, at the planned switchover)
-- Deploy the matching app code and main.py right after running this.
-- Enum type names, index names and trigger names are unchanged on purpose.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Old "keep duplicate columns in sync" triggers go away first
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_vehicle_log_legacy_sync ON public.vehicle_log;
DROP TRIGGER IF EXISTS trg_parking_legacy_sync ON public.parking_capacity;
-- trg_vehicle_log_parking_sync stays: Postgres moves it (and its column list) with the renames

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
ALTER TABLE public.registration         RENAME TO sticker_application;
ALTER TABLE public.vehicle_information  RENAME TO vehicle;
ALTER TABLE public.vehicle_log          RENAME TO gate_log;
ALTER TABLE public.modification_request RENAME TO profile_update_request;
ALTER TABLE public.form_settings        RENAME TO application_form_setting;

-- ---------------------------------------------------------------------
-- 3. Columns
-- ---------------------------------------------------------------------
-- users
ALTER TABLE public.users RENAME COLUMN user_type      TO account_role;
ALTER TABLE public.users RENAME COLUMN identification TO account_type;
ALTER TABLE public.users RENAME COLUMN auth_user_id   TO google_auth_id;

-- sticker_application (qr_code holds the image link, qr_unique_code the scanned code)
ALTER TABLE public.sticker_application RENAME COLUMN qr_code                TO qr_image;
ALTER TABLE public.sticker_application RENAME COLUMN qr_unique_code         TO qr_code;
ALTER TABLE public.sticker_application RENAME COLUMN vehicle_information_id TO vehicle_id;
ALTER TABLE public.sticker_application RENAME COLUMN doc_id                 TO school_id_file;
ALTER TABLE public.sticker_application RENAME COLUMN drivers_license        TO drivers_license_file;
ALTER TABLE public.sticker_application RENAME COLUMN enrollment_form        TO enrollment_form_file;
ALTER TABLE public.sticker_application RENAME COLUMN agreement_form         TO agreement_form_file;
ALTER TABLE public.sticker_application RENAME COLUMN receipt                TO payment_receipt_file;
ALTER TABLE public.sticker_application RENAME COLUMN dept_val_at            TO dept_approved_at;
ALTER TABLE public.sticker_application RENAME COLUMN osa_val_at             TO osa_approved_at;
ALTER TABLE public.sticker_application RENAME COLUMN osa_dist_at            TO hardcopy_received_at;
ALTER TABLE public.sticker_application RENAME COLUMN security_check_at      TO security_checked_at;
ALTER TABLE public.sticker_application RENAME COLUMN schedule               TO hardcopy_due_at;
ALTER TABLE public.sticker_application RENAME COLUMN revoke_at              TO revoked_at;
ALTER TABLE public.sticker_application RENAME COLUMN revoke_reason          TO revoked_reason;
ALTER TABLE public.sticker_application RENAME COLUMN rejection_reason       TO rejected_reason;
-- Used by the agreement reminder email but never created
ALTER TABLE public.sticker_application ADD COLUMN IF NOT EXISTS agreement_reminder_sent_at TIMESTAMPTZ;

-- vehicle
ALTER TABLE public.vehicle RENAME COLUMN vehicle_information_id TO vehicle_id;
ALTER TABLE public.vehicle RENAME COLUMN "or"                   TO official_receipt_file;
ALTER TABLE public.vehicle RENAME COLUMN cr                     TO certificate_of_registration_file;
ALTER TABLE public.vehicle RENAME COLUMN type                   TO vehicle_type;
ALTER TABLE public.vehicle RENAME COLUMN authorization_letter   TO authorization_letter_file;

-- gate_log (campus_gate is the one campus column kept)
ALTER TABLE public.gate_log RENAME COLUMN vehicle_log_id         TO gate_log_id;
ALTER TABLE public.gate_log RENAME COLUMN vehicle_information_id TO vehicle_id;
ALTER TABLE public.gate_log RENAME COLUMN check_in               TO entered_at;
ALTER TABLE public.gate_log RENAME COLUMN check_out              TO exited_at;
ALTER TABLE public.gate_log RENAME COLUMN logged_status          TO presence_status;
ALTER TABLE public.gate_log RENAME COLUMN vip_access             TO is_vip;
ALTER TABLE public.gate_log RENAME COLUMN reason                 TO note;
ALTER TABLE public.gate_log RENAME COLUMN deleted_owner_name     TO owner_name_snapshot;
ALTER TABLE public.gate_log RENAME COLUMN deleted_plate          TO plate_snapshot;
ALTER TABLE public.gate_log DROP COLUMN IF EXISTS campus;

-- parking_capacity: keep one copy of each value
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS parking_capacity;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS slot_occupied;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS slot_unoccupied;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS recorded_at;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS vehicle_log_id;
ALTER TABLE public.parking_capacity DROP COLUMN IF EXISTS campus;
ALTER TABLE public.parking_capacity RENAME COLUMN date_time               TO recorded_at;
ALTER TABLE public.parking_capacity RENAME COLUMN parking_availability_id TO parking_capacity_id;
ALTER TABLE public.parking_capacity ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE public.parking_capacity ALTER COLUMN capacity  SET DEFAULT 200;
ALTER TABLE public.parking_capacity ALTER COLUMN occupied  SET DEFAULT 0;
ALTER TABLE public.parking_capacity ALTER COLUMN available SET DEFAULT 200;

-- blocklist
ALTER TABLE public.blocklist RENAME COLUMN block_by       TO blocked_by;
ALTER TABLE public.blocklist RENAME COLUMN recorded_at    TO blocked_at;
ALTER TABLE public.blocklist RENAME COLUMN evidence_image TO evidence_image_file;

-- incident_report
ALTER TABLE public.incident_report RENAME COLUMN complaint_id TO incident_report_id;
ALTER TABLE public.incident_report RENAME COLUMN schedule     TO scheduled_at;

-- profile_update_request
ALTER TABLE public.profile_update_request RENAME COLUMN change_vehicle_request_id TO profile_update_request_id;
ALTER TABLE public.profile_update_request RENAME COLUMN request_at                TO requested_at;
ALTER TABLE public.profile_update_request RENAME COLUMN process_at                TO processed_at;
ALTER TABLE public.profile_update_request RENAME COLUMN recipient_id              TO assigned_to_user_id;

-- application_form_setting
ALTER TABLE public.application_form_setting RENAME COLUMN application_form_settings_id TO application_form_setting_id;
ALTER TABLE public.application_form_setting RENAME COLUMN status                       TO form_status;
ALTER TABLE public.application_form_setting RENAME COLUMN updated_by                   TO updated_by_email;

-- guest
ALTER TABLE public.guest RENAME COLUMN id_number   TO guest_id_number;
ALTER TABLE public.guest RENAME COLUMN "timestamp" TO arrived_at;

-- notification (all columns kept)
ALTER TABLE public.notification RENAME COLUMN user_id  TO recipient_user_id;
ALTER TABLE public.notification RENAME COLUMN activity TO title;

-- campus_event
ALTER TABLE public.campus_event RENAME COLUMN user_id    TO created_by_user_id;
ALTER TABLE public.campus_event RENAME COLUMN start_date TO starts_at;
ALTER TABLE public.campus_event RENAME COLUMN end_date   TO ends_at;

-- ---------------------------------------------------------------------
-- 4. Functions rewritten for the new names
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_user_if_not_exists(p_email text, p_user_type character varying DEFAULT 'applicant', p_identification character varying DEFAULT 'student')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user_id INTEGER;
BEGIN
  SELECT user_id INTO v_user_id FROM users WHERE LOWER(email) = LOWER(p_email) LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    RETURN v_user_id;
  END IF;
  INSERT INTO users (email, account_role, account_type)
  VALUES (LOWER(p_email), p_user_type::user_type_enum, p_identification::identification_enum)
  RETURNING user_id INTO v_user_id;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_department()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT department_id FROM users
  WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email') OR google_auth_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT user_id FROM users
  WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email') OR google_auth_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(p_email character varying)
RETURNS character varying LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_role  user_type_enum;
  v_type  identification_enum;
BEGIN
  SELECT account_role, account_type INTO v_role, v_type
  FROM users WHERE LOWER(email) = LOWER(p_email) LIMIT 1;

  IF v_role = 'osa' THEN
    RETURN 'osa';
  ELSIF v_role = 'safety_security' THEN
    RETURN 'security';
  ELSIF v_role = 'Office Head' THEN
    RETURN 'administrative';
  ELSIF v_role IN ('Academic Head', 'dean') OR v_type = 'faculty' THEN
    RETURN 'dean';
  ELSE
    RETURN 'applicant';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_default_dept INTEGER;
BEGIN
  SELECT department_id INTO v_default_dept FROM department ORDER BY department_id LIMIT 1;
  INSERT INTO public.users (google_auth_id, email, account_role, account_type, department_id)
  VALUES (NEW.id, NEW.email, 'applicant', 'student', v_default_dept)
  ON CONFLICT (email) DO UPDATE SET google_auth_id = EXCLUDED.google_auth_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_dean(p_email character varying)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER(p_email) AND account_type = 'faculty');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_osa_admin(p_email character varying)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER(p_email) AND account_role = 'osa');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_security_admin(p_email character varying)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER(p_email) AND account_role = 'safety_security');
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_blocklist_fill_ids()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.vehicle_id IS NULL AND NEW.registration_id IS NOT NULL THEN
    SELECT vehicle_id INTO NEW.vehicle_id FROM sticker_application WHERE registration_id = NEW.registration_id;
  ELSIF NEW.registration_id IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT registration_id INTO NEW.registration_id FROM sticker_application
    WHERE vehicle_id = NEW.vehicle_id ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_handle_registration_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'dept_validated' AND OLD.status != 'dept_validated' THEN
    NEW.dept_approved_at = COALESCE(NEW.dept_approved_at, NOW());
  ELSIF NEW.status = 'osa_validated' AND OLD.status != 'osa_validated' THEN
    NEW.osa_approved_at = COALESCE(NEW.osa_approved_at, NOW());
  ELSIF NEW.status = 'security_checked' AND OLD.status != 'security_checked' THEN
    NEW.security_checked_at = COALESCE(NEW.security_checked_at, NOW());
  ELSIF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
    NEW.rejected_at = COALESCE(NEW.rejected_at, NOW());
  ELSIF NEW.status = 'revoked' AND OLD.status != 'revoked' THEN
    NEW.revoked_at = COALESCE(NEW.revoked_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_registration_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO notification (recipient_user_id, title, is_read, target_id)
    VALUES (
      NEW.user_id,
      CASE
        WHEN NEW.status = 'dept_validated'   THEN 'Your vehicle application has been validated by your Department Dean.'
        WHEN NEW.status = 'osa_validated'    THEN 'Your vehicle application has been validated by OSA.'
        WHEN NEW.status = 'security_checked' THEN 'Security physical check completed.'
        WHEN NEW.status = 'approved'         THEN 'Congratulations! Your vehicle registration sticker has been approved.'
        WHEN NEW.status = 'rejected'         THEN 'Your vehicle registration application was rejected: ' || COALESCE(NEW.rejected_reason, 'No reason specified')
        WHEN NEW.status = 'revoked'          THEN 'Your vehicle registration sticker was revoked: ' || COALESCE(NEW.revoked_reason, 'No reason specified')
        ELSE 'Your vehicle application status is now: ' || NEW.status::text
      END,
      FALSE,
      NEW.registration_id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Only sticker_application and notification still need filling in on insert/update
CREATE OR REPLACE FUNCTION public.trg_sync_legacy_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_TABLE_NAME = 'sticker_application' THEN
    -- Never copy the 'PENDING' placeholder: qr_code stays NULL until a real QR exists
    NEW.qr_code := NULLIF(COALESCE(NEW.qr_code, NULLIF(NEW.qr_image, 'PENDING')), 'PENDING');
  ELSIF TG_TABLE_NAME = 'notification' THEN
    NEW.created_at := COALESCE(NEW.created_at, NEW.date, NOW());
    NEW.date := COALESCE(NEW.date, NEW.created_at, NOW());
    NEW.title := COALESCE(NULLIF(NEW.title, ''), NEW.message, 'Notification');
    NEW.message := COALESCE(NEW.message, NEW.title);
    NEW.target_id := COALESCE(NEW.target_id, NEW.target_entity_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_parking_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  SELECT * INTO v_prev FROM parking_capacity WHERE campus_gate = v_gate ORDER BY recorded_at DESC LIMIT 1;

  v_cap2 := v_prev.capacity_2_wheels;
  v_cap4 := v_prev.capacity_4_wheels;
  v_capacity := CASE
    WHEN v_cap2 IS NOT NULL AND v_cap4 IS NOT NULL THEN v_cap2 + v_cap4
    ELSE COALESCE(v_prev.capacity, 200)
  END;

  SELECT
    COUNT(*) FILTER (WHERE v.vehicle_type = '2_wheels'),
    COUNT(*) FILTER (WHERE v.vehicle_type IS DISTINCT FROM '2_wheels')
  INTO v_occ2, v_occ4
  FROM (
    SELECT DISTINCT ON (COALESCE(gl.registration_id::text, 'log' || gl.gate_log_id)) gl.vehicle_id
    FROM gate_log gl
    WHERE gl.campus_gate = v_gate AND gl.exited_at IS NULL AND gl.presence_status = 'inside_campus'
  ) inside
  LEFT JOIN vehicle v ON v.vehicle_id = inside.vehicle_id;

  SELECT event_name INTO v_event_name FROM campus_event
  WHERE campus_gate = v_gate AND is_active = TRUE AND NOW() BETWEEN starts_at AND ends_at
  ORDER BY created_at DESC LIMIT 1;

  INSERT INTO parking_capacity (
    capacity, capacity_2_wheels, capacity_4_wheels,
    occupied, available, occupied_2_wheels, occupied_4_wheels,
    recorded_at, campus_gate, event_name
  ) VALUES (
    v_capacity, v_cap2, v_cap4,
    v_occ2 + v_occ4, GREATEST(0, v_capacity - (v_occ2 + v_occ4)), v_occ2, v_occ4,
    NOW(), v_gate, v_event_name
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_gate_entry(p_qr_code character varying, p_gate_text character varying DEFAULT 'main')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_reg    RECORD;
  v_veh    RECORD;
  v_gate   campus_gate_enum := 'main';
  v_inside BOOLEAN;
  v_log_id INTEGER;
  v_block  RECORD;
BEGIN
  IF LOWER(p_gate_text) LIKE '%rnp%' THEN
    v_gate := 'rnp';
  ELSIF LOWER(p_gate_text) LIKE '%paseo%' THEN
    v_gate := 'paseo';
  ELSE
    v_gate := 'main';
  END IF;

  SELECT * INTO v_reg FROM sticker_application WHERE qr_code = p_qr_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_QR', 'message', 'QR code not found.');
  END IF;

  IF v_reg.status != 'approved' THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_APPROVED', 'message', 'Registration status is ' || v_reg.status::text);
  END IF;

  IF v_reg.expires_at IS NOT NULL AND v_reg.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'status', 'EXPIRED', 'message', 'Sticker has expired.');
  END IF;

  -- Gate block (3rd violation level) applies to every campus gate (main, rnp, paseo)
  SELECT * INTO v_block FROM blocklist b
  WHERE (b.registration_id = v_reg.registration_id OR b.vehicle_id = v_reg.vehicle_id)
    AND b.violation_level = 'gate_block' AND b.blocked_until > NOW()
  ORDER BY b.blocked_until DESC LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'BLOCKED',
      'message', 'Vehicle is blocked: ' || v_block.reason,
      'blocked_until', v_block.blocked_until,
      'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (v_block.blocked_until - NOW()))::BIGINT),
      'blocked_by', v_block.blocked_by::text
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM gate_log
    WHERE registration_id = v_reg.registration_id AND exited_at IS NULL AND presence_status = 'inside_campus'
  ) INTO v_inside;

  IF v_inside THEN
    RETURN jsonb_build_object('success', false, 'status', 'ALREADY_INSIDE', 'message', 'Vehicle is already recorded as inside campus.');
  END IF;

  SELECT * INTO v_veh FROM vehicle WHERE vehicle_id = v_reg.vehicle_id;

  INSERT INTO gate_log (registration_id, vehicle_id, campus_gate, presence_status, sticker_status, entered_at)
  VALUES (v_reg.registration_id, v_reg.vehicle_id, v_gate, 'inside_campus', 'registered', NOW())
  RETURNING gate_log_id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ALLOWED',
    'gate_log_id', v_log_id,
    'owner_name', v_reg.first_name || ' ' || v_reg.last_name,
    'plate_number', v_veh.plate_number,
    'role', v_reg.role::text,
    'vehicle_type', v_veh.vehicle_type::text
  );
END;
$$;

COMMIT;
