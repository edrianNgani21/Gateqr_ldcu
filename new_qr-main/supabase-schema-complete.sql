-- =====================================================================
-- Campus Vehicle Registration System - Supabase (PostgreSQL) Schema
-- Generated and Aligned for GATEQR System
-- Run in: Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 2. DROP EXISTING VIEWS AND TABLES (Clean reset in dependency order)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'form_settings', 'application_form_settings', 'notifications', 'notification',
        'modification_request', 'change_vehicle_requests', 'change_vehicle_request',
        'otp_codes', 'guest_log', 'guest', 'vip_log',
        'incident_report', 'complaint', 'parking_capacity', 'parking_availability', 'vehicle_log',
        'registration', 'vehicle_information', 'user_log',
        'system_settings', 'department', 'user', 'users',
        'campus_events', 'campus_event', 'blocklist', 'login_confirmation'
      )
  ) LOOP
    IF r.table_type = 'VIEW' THEN
      EXECUTE 'DROP VIEW IF EXISTS public."' || r.table_name || '" CASCADE';
    ELSE
      EXECUTE 'DROP TABLE IF EXISTS public."' || r.table_name || '" CASCADE';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. ENUM TYPES
-- ---------------------------------------------------------------------
DROP TYPE IF EXISTS user_type_enum CASCADE;
DROP TYPE IF EXISTS identification_enum CASCADE;
DROP TYPE IF EXISTS registration_status_enum CASCADE;
DROP TYPE IF EXISTS registration_role_enum CASCADE;
DROP TYPE IF EXISTS vehicle_type_enum CASCADE;
DROP TYPE IF EXISTS logged_status_enum CASCADE;
DROP TYPE IF EXISTS sticker_status_enum CASCADE;
DROP TYPE IF EXISTS complaint_status_enum CASCADE;
DROP TYPE IF EXISTS campus_gate_enum CASCADE;
DROP TYPE IF EXISTS change_request_status_enum CASCADE;
DROP TYPE IF EXISTS form_status_enum CASCADE;
DROP TYPE IF EXISTS blocklist_by_enum CASCADE;
DROP TYPE IF EXISTS violation_level_enum CASCADE;
DROP TYPE IF EXISTS login_confirmation_status_enum CASCADE;

CREATE TYPE user_type_enum          AS ENUM ('applicant', 'safety_security', 'osa', 'dean', 'Academic Head', 'Office Head');
CREATE TYPE identification_enum     AS ENUM ('admin', 'staff', 'faculty', 'student');
CREATE TYPE registration_status_enum AS ENUM (
  'pending', 'dept_validated', 'osa_validated', 'distributed',
  'security_checked', 'receipt_submitted', 'completed', 'approved', 'rejected', 'expired', 'revoked'
);
-- Migration SQL for existing databases:
-- ALTER TYPE registration_role_enum ADD VALUE IF NOT EXISTS 'administrator';
-- ALTER TYPE registration_role_enum ADD VALUE IF NOT EXISTS 'concessionnaire';
-- ALTER TYPE registration_role_enum ADD VALUE IF NOT EXISTS 'supplier';
-- ALTER TYPE registration_role_enum ADD VALUE IF NOT EXISTS 'vps';
CREATE TYPE registration_role_enum  AS ENUM ('student', 'staff', 'faculty', 'administrator', 'concessionnaire', 'supplier', 'vps');
CREATE TYPE vehicle_type_enum       AS ENUM ('2_wheels', '4_wheels');
CREATE TYPE logged_status_enum      AS ENUM ('inside_campus', 'exited_campus', 'denied');  -- denied = flagged / refused gate attempt
CREATE TYPE sticker_status_enum     AS ENUM ('registered', 'unregistered');
CREATE TYPE complaint_status_enum   AS ENUM ('pending', 'resolved', 'Pending', 'Resolved');
CREATE TYPE campus_gate_enum        AS ENUM ('main', 'rnp', 'paseo');
CREATE TYPE change_request_status_enum AS ENUM ('pending', 'approved', 'rejected', 'Pending', 'Approved', 'Rejected');
CREATE TYPE form_status_enum        AS ENUM ('open', 'closed');

-- ---------------------------------------------------------------------
-- 4. TABLES
-- ---------------------------------------------------------------------

-- Table 1. DEPARTMENT
-- Migration SQL for existing databases:
-- ALTER TABLE department RENAME COLUMN department_name TO academic_department;
-- ALTER TABLE department ADD COLUMN IF NOT EXISTS administrative_department VARCHAR(100) UNIQUE;
-- ALTER TABLE department ALTER COLUMN academic_department DROP NOT NULL;
CREATE TABLE department (
  department_id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  academic_department       VARCHAR(100) UNIQUE,
  administrative_department VARCHAR(100) UNIQUE,
  is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Table 2. USERS ("user" is reserved in Postgres; table is "users")
CREATE TABLE users (
  user_id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id      UUID UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,  -- links to Supabase Auth
  department_id     INTEGER REFERENCES department (department_id) ON DELETE SET NULL,
  user_type         user_type_enum      NOT NULL DEFAULT 'applicant',
  email             VARCHAR(100) NOT NULL UNIQUE,
  identification    identification_enum NOT NULL DEFAULT 'student',
  password_hash     VARCHAR(255),                                              -- bcrypt hash for custom auth
  security_pin_hash VARCHAR(255),                                              -- 4-digit security PIN hash
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Table 3. VEHICLE_INFORMATION
CREATE TABLE vehicle_information (
  vehicle_information_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "or"                   VARCHAR(255) NOT NULL,   -- Official Receipt ("or" is a keyword, so quoted)
  cr                     VARCHAR(255) NOT NULL,   -- Certificate of Registration
  plate_number           VARCHAR(15)  NOT NULL,
  color                  VARCHAR(50)  NOT NULL,
  brand                  VARCHAR(50)  NOT NULL,
  type                   vehicle_type_enum NOT NULL,
  authorization_letter   VARCHAR(255) NOT NULL
);

-- Table 4. REGISTRATION
CREATE TABLE registration (
  registration_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_information_id INTEGER NOT NULL REFERENCES vehicle_information (vehicle_information_id) ON DELETE CASCADE,
  status                 registration_status_enum NOT NULL DEFAULT 'pending',
  user_id                INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  department_id          INTEGER NOT NULL REFERENCES department (department_id),
  agreement_form         VARCHAR(255) NOT NULL,
  first_name             VARCHAR(50)  NOT NULL,
  last_name              VARCHAR(50)  NOT NULL,
  mobile                 VARCHAR(20)  NOT NULL,
  school_id              VARCHAR(50)  NOT NULL,
  doc_id                 VARCHAR(500),                            -- Student / Employee ID document URL
  drivers_license        VARCHAR(255) NOT NULL,
  enrollment_form        VARCHAR(255) NOT NULL,   -- White Form / Enrollment Form
  year_level             VARCHAR(50),             -- Applicant year level (e.g. 1st Year, 2nd Year)
  role                   registration_role_enum NOT NULL DEFAULT 'student',
  qr_code                VARCHAR(255) NOT NULL,
  qr_unique_code         VARCHAR(255),                            -- Compatibility column
  dept_val_at            TIMESTAMPTZ,             -- Dean validated timestamp
  osa_val_at             TIMESTAMPTZ,             -- OSA validated timestamp
  osa_dist_at            TIMESTAMPTZ,             -- OSA hardcopy documents compliance timestamp
  security_check_at      TIMESTAMPTZ,             -- Security inspection / document review timestamp
  receipt                TEXT,                    -- Payment receipt image URL uploaded by applicant
  sticker_released_at    TIMESTAMPTZ,             -- OSA sticker released timestamp
  schedule               TIMESTAMPTZ,             -- Hardcopy schedule for compliance
  expires_at             TIMESTAMPTZ,             -- Sticker expiration
  school_year            VARCHAR(20) DEFAULT '2025-2026', -- School Year (e.g. 2025-2026)
  revoke_at              TIMESTAMPTZ,             -- Sticker revocation timestamp
  rejected_at            TIMESTAMPTZ,             -- Rejection timestamp
  rejection_reason       TEXT,                    -- Specific reason why application was rejected
  revoke_reason          TEXT,                    -- Specific reason why registration was revoked
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Table 5. GUEST
CREATE TABLE guest (
  guest_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plate_number VARCHAR(15) NOT NULL,
  id_number    VARCHAR(50) NOT NULL,              -- Driver's license ID number
  purpose      TEXT        NOT NULL,
  "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 6. VEHICLE_LOG
CREATE TABLE vehicle_log (
  vehicle_log_id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id        INTEGER REFERENCES registration (registration_id) ON DELETE SET NULL,
  vehicle_information_id INTEGER REFERENCES vehicle_information (vehicle_information_id) ON DELETE SET NULL,
  guest_id               INTEGER REFERENCES guest (guest_id) ON DELETE SET NULL,
  campus_gate            campus_gate_enum NOT NULL DEFAULT 'main',
  campus                 VARCHAR(50) NOT NULL DEFAULT 'Main Campus', -- Compatibility column
  check_in               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out              TIMESTAMPTZ,
  logged_status          logged_status_enum NOT NULL DEFAULT 'inside_campus',
  sticker_status         sticker_status_enum NOT NULL DEFAULT 'registered',
  vip_access             BOOLEAN DEFAULT FALSE,
  reason                 TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vehicle_log_owner_chk CHECK (registration_id IS NOT NULL OR guest_id IS NOT NULL OR vip_access IS TRUE),
  CONSTRAINT vehicle_log_time_chk  CHECK (check_out IS NULL OR check_out >= check_in)
);

-- Table 7. INCIDENT_REPORT (Formerly Complaint)
CREATE TABLE incident_report (
  complaint_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  message      TEXT    NOT NULL,
  schedule     TIMESTAMPTZ,
  status       complaint_status_enum NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ            -- null until resolved
);

-- Table 8. PARKING_CAPACITY (Formerly Parking_Availability)
CREATE TABLE parking_capacity (
  parking_availability_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_log_id          INTEGER REFERENCES vehicle_log (vehicle_log_id) ON DELETE SET NULL,
  parking_capacity        INTEGER NOT NULL DEFAULT 200 CHECK (parking_capacity >= 0),
  slot_occupied           INTEGER NOT NULL DEFAULT 0 CHECK (slot_occupied >= 0),
  slot_unoccupied         INTEGER NOT NULL DEFAULT 200 CHECK (slot_unoccupied >= 0),
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- "Date&Time"
  campus_gate             campus_gate_enum NOT NULL DEFAULT 'main',
  event_name              VARCHAR(100),
  -- Compatibility columns for legacy queries
  capacity                INTEGER NOT NULL DEFAULT 200,
  occupied                INTEGER NOT NULL DEFAULT 0,
  available               INTEGER NOT NULL DEFAULT 200,
  date_time               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  campus                  VARCHAR(50) NOT NULL DEFAULT 'Main Campus'
);

-- Table 9. NOTIFICATION
CREATE TABLE notification (
  notification_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  date                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Compatibility alias
  activity            VARCHAR(150) NOT NULL DEFAULT '',
  message             TEXT,                              -- Full message text
  notification_type   VARCHAR(50),
  actor_id            INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
  action_type         VARCHAR(50),
  target_id           INTEGER,                           -- doc specification
  target_entity_type  VARCHAR(50),
  target_entity_id    INTEGER,
  reference_id        INTEGER,
  metadata            JSONB,
  is_read             BOOLEAN NOT NULL DEFAULT FALSE
);

-- Table 10. MODIFICATION_REQUEST (Formerly Change_Vehicle_Request)
CREATE TABLE modification_request (
  change_vehicle_request_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  registration_id   INTEGER NOT NULL REFERENCES registration (registration_id) ON DELETE CASCADE,
  status            change_request_status_enum NOT NULL DEFAULT 'pending',
  reason            TEXT    NOT NULL,
  recipient_id      INTEGER NOT NULL REFERENCES users (user_id),  -- OSA admin receiving the request
  request_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  process_at        TIMESTAMPTZ,                                  -- null until processed
  proposed_changes  JSONB   NOT NULL                              -- new vehicle details
);

-- Table 11. CAMPUS_EVENT
CREATE TABLE campus_event (
  campus_event_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  event_name      VARCHAR(100) NOT NULL,
  campus_gate     campus_gate_enum NOT NULL DEFAULT 'main',
  start_date      TIMESTAMPTZ NOT NULL,
  end_date        TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campus_event_dates_chk CHECK (end_date >= start_date)
);

-- Table 12. FORM_SETTINGS (Formerly Application_Form_Settings)
CREATE TABLE form_settings (
  application_form_settings_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
  status     form_status_enum NOT NULL DEFAULT 'open',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(100) NOT NULL DEFAULT 'System'
);

-- ---------------------------------------------------------------------
-- 5. COMPATIBILITY VIEWS (Ensure both old and new table names resolve)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public."user" CASCADE;
DROP VIEW IF EXISTS public.notifications CASCADE;
DROP VIEW IF EXISTS public.change_vehicle_requests CASCADE;
DROP VIEW IF EXISTS public.campus_events CASCADE;
DROP VIEW IF EXISTS public.guest_log CASCADE;

CREATE OR REPLACE VIEW public.complaint AS SELECT * FROM public.incident_report;
CREATE OR REPLACE VIEW public.parking_availability AS SELECT * FROM public.parking_capacity;
CREATE OR REPLACE VIEW public.change_vehicle_request AS SELECT * FROM public.modification_request;
CREATE OR REPLACE VIEW public.application_form_settings AS SELECT * FROM public.form_settings;

-- ---------------------------------------------------------------------
-- 6. INDEXES (Foreign keys + frequent lookups)
-- ---------------------------------------------------------------------
CREATE INDEX idx_users_department            ON users (department_id);
CREATE INDEX idx_users_email                 ON users (email);
CREATE INDEX idx_users_auth_id               ON users (auth_user_id);
CREATE INDEX idx_registration_user           ON registration (user_id);
CREATE INDEX idx_registration_department     ON registration (department_id);
CREATE INDEX idx_registration_vehicle        ON registration (vehicle_information_id);
CREATE INDEX idx_registration_status         ON registration (status);
CREATE INDEX idx_registration_qr             ON registration (qr_code);
CREATE INDEX idx_vehicle_info_plate          ON vehicle_information (plate_number);
CREATE INDEX idx_guest_plate                 ON guest (plate_number);
CREATE INDEX idx_vehicle_log_registration    ON vehicle_log (registration_id);
CREATE INDEX idx_vehicle_log_vehicle         ON vehicle_log (vehicle_information_id);
CREATE INDEX idx_vehicle_log_guest           ON vehicle_log (guest_id);
CREATE INDEX idx_vehicle_log_check_in        ON vehicle_log (check_in DESC);
CREATE INDEX idx_vehicle_log_status          ON vehicle_log (logged_status);
CREATE INDEX idx_complaint_user              ON incident_report (user_id);
CREATE INDEX idx_parking_vehicle_log         ON parking_capacity (vehicle_log_id);
CREATE INDEX idx_parking_recorded_at         ON parking_capacity (recorded_at DESC);
CREATE INDEX idx_notification_user_unread    ON notification (user_id, is_read);
CREATE INDEX idx_cvr_user                    ON modification_request (user_id);
CREATE INDEX idx_cvr_registration            ON modification_request (registration_id);
CREATE INDEX idx_cvr_recipient               ON modification_request (recipient_id);
CREATE INDEX idx_campus_event_user           ON campus_event (user_id);
CREATE INDEX idx_app_form_settings_user      ON form_settings (user_id);

-- ---------------------------------------------------------------------
-- 7. AUTOMATIC TIMESTAMPS & WORKFLOW TRIGGERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registration_updated_at
  BEFORE UPDATE ON registration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_app_form_settings_updated_at
  BEFORE UPDATE ON form_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trigger: Automatically manage registration workflow timestamps
CREATE OR REPLACE FUNCTION trg_handle_registration_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'dept_validated' AND OLD.status != 'dept_validated' THEN
    NEW.dept_val_at = COALESCE(NEW.dept_val_at, NOW());
  ELSIF NEW.status = 'osa_validated' AND OLD.status != 'osa_validated' THEN
    NEW.osa_val_at = COALESCE(NEW.osa_val_at, NOW());
  ELSIF NEW.status = 'security_checked' AND OLD.status != 'security_checked' THEN
    NEW.security_check_at = COALESCE(NEW.security_check_at, NOW());
  ELSIF NEW.status = 'rejected' AND OLD.status != 'rejected' THEN
    NEW.rejected_at = COALESCE(NEW.rejected_at, NOW());
  ELSIF NEW.status = 'revoked' AND OLD.status != 'revoked' THEN
    NEW.revoke_at = COALESCE(NEW.revoke_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registration_workflow_status
  BEFORE UPDATE ON registration
  FOR EACH ROW EXECUTE FUNCTION trg_handle_registration_workflow();

-- Trigger: Synchronize legacy compatibility columns
CREATE OR REPLACE FUNCTION trg_sync_legacy_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'registration' THEN
    -- New applications store qr_code = 'PENDING' until OSA schedules them; never copy that
    -- placeholder, or every second pending application violates idx_registration_unique_qr_code
    NEW.qr_unique_code := NULLIF(COALESCE(NEW.qr_unique_code, NULLIF(NEW.qr_code, 'PENDING')), 'PENDING');
  ELSIF TG_TABLE_NAME = 'vehicle_log' THEN
    IF NEW.campus IS NULL OR NEW.campus = '' OR NEW.campus = 'Main Campus' THEN
      NEW.campus := CASE NEW.campus_gate WHEN 'rnp' THEN 'RNP' WHEN 'paseo' THEN 'PASEO' ELSE 'Main Campus' END;
    END IF;
  ELSIF TG_TABLE_NAME = 'parking_capacity' OR TG_TABLE_NAME = 'parking_availability' THEN
    NEW.capacity := COALESCE(NEW.parking_capacity, NEW.capacity, 200);
    NEW.occupied := COALESCE(NEW.slot_occupied, NEW.occupied, 0);
    NEW.available := COALESCE(NEW.slot_unoccupied, NEW.available, 200);
    NEW.date_time := COALESCE(NEW.recorded_at, NEW.date_time, NOW());
    NEW.campus := CASE NEW.campus_gate WHEN 'rnp' THEN 'RNP' WHEN 'paseo' THEN 'PASEO' ELSE 'Main Campus' END;
  ELSIF TG_TABLE_NAME = 'notification' THEN
    NEW.created_at := COALESCE(NEW.created_at, NEW.date, NOW());
    NEW.date := COALESCE(NEW.date, NEW.created_at, NOW());
    NEW.activity := COALESCE(NULLIF(NEW.activity, ''), NEW.message, 'Notification');
    NEW.message := COALESCE(NEW.message, NEW.activity);
    NEW.target_id := COALESCE(NEW.target_id, NEW.target_entity_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registration_legacy_sync
  BEFORE INSERT OR UPDATE ON registration
  FOR EACH ROW EXECUTE FUNCTION trg_sync_legacy_columns();

CREATE TRIGGER trg_vehicle_log_legacy_sync
  BEFORE INSERT OR UPDATE ON vehicle_log
  FOR EACH ROW EXECUTE FUNCTION trg_sync_legacy_columns();

CREATE TRIGGER trg_parking_legacy_sync
  BEFORE INSERT OR UPDATE ON parking_capacity
  FOR EACH ROW EXECUTE FUNCTION trg_sync_legacy_columns();

CREATE TRIGGER trg_notification_legacy_sync
  BEFORE INSERT OR UPDATE ON notification
  FOR EACH ROW EXECUTE FUNCTION trg_sync_legacy_columns();

-- Trigger: Real-time Parking Calculation
CREATE OR REPLACE FUNCTION trg_sync_parking_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate campus_gate_enum;
  v_capacity INTEGER := 200;
  v_occupied INTEGER := 0;
  v_unoccupied INTEGER := 200;
  v_event_name VARCHAR(100);
BEGIN
  v_gate := COALESCE(NEW.campus_gate, 'main');

  -- Count vehicles currently inside this gate
  SELECT COUNT(DISTINCT COALESCE(registration_id, vehicle_log_id))
  INTO v_occupied
  FROM vehicle_log
  WHERE campus_gate = v_gate
    AND check_out IS NULL
    AND logged_status = 'inside_campus';

  -- Get active event for this gate if any
  SELECT event_name INTO v_event_name
  FROM campus_event
  WHERE campus_gate = v_gate
    AND is_active = TRUE
    AND NOW() BETWEEN start_date AND end_date
  ORDER BY created_at DESC
  LIMIT 1;

  v_unoccupied := GREATEST(0, v_capacity - v_occupied);

  INSERT INTO parking_capacity (
    vehicle_log_id,
    parking_capacity,
    slot_occupied,
    slot_unoccupied,
    recorded_at,
    campus_gate,
    event_name
  ) VALUES (
    NEW.vehicle_log_id,
    v_capacity,
    v_occupied,
    v_unoccupied,
    NOW(),
    v_gate,
    v_event_name
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vehicle_log_parking_sync
  AFTER INSERT OR UPDATE OF check_out, logged_status ON vehicle_log
  FOR EACH ROW EXECUTE FUNCTION trg_sync_parking_availability();

-- Trigger: Automated Notifications on Status Change
CREATE OR REPLACE FUNCTION trg_notify_registration_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    INSERT INTO notification (
      user_id,
      activity,
      is_read,
      target_id
    ) VALUES (
      NEW.user_id,
      CASE
        WHEN NEW.status = 'dept_validated'  THEN 'Your vehicle application has been validated by your Department Dean.'
        WHEN NEW.status = 'osa_validated'   THEN 'Your vehicle application has been validated by OSA.'
        WHEN NEW.status = 'security_checked' THEN 'Security physical check completed.'
        WHEN NEW.status = 'approved'        THEN 'Congratulations! Your vehicle registration sticker has been approved.'
        WHEN NEW.status = 'rejected'        THEN 'Your vehicle registration application was rejected: ' || COALESCE(NEW.rejection_reason, 'No reason specified')
        WHEN NEW.status = 'revoked'         THEN 'Your vehicle registration sticker was revoked: ' || COALESCE(NEW.revoke_reason, 'No reason specified')
        ELSE 'Your vehicle application status is now: ' || NEW.status::text
      END,
      FALSE,
      NEW.registration_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registration_notification
  AFTER UPDATE OF status ON registration
  FOR EACH ROW EXECUTE FUNCTION trg_notify_registration_status_change();

-- ---------------------------------------------------------------------
-- 8. SYSTEM ROLE & AUTH FUNCTIONS
-- ---------------------------------------------------------------------

-- Function to determine user system role (Dean identified via identification = 'faculty')
CREATE OR REPLACE FUNCTION get_user_role(p_email VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_type user_type_enum;
  v_ident     identification_enum;
BEGIN
  SELECT user_type, identification
  INTO v_user_type, v_ident
  FROM users
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1;

  IF v_user_type = 'osa' THEN
    RETURN 'osa';
  ELSIF v_user_type = 'safety_security' THEN
    RETURN 'security';
  ELSIF v_user_type = 'Office Head' THEN
    RETURN 'administrative';
  ELSIF v_user_type IN ('Academic Head', 'dean') OR v_ident = 'faculty' THEN
    RETURN 'dean';
  ELSE
    RETURN 'applicant';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION is_osa_admin(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE LOWER(email) = LOWER(p_email)
      AND user_type = 'osa'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_security_admin(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE LOWER(email) = LOWER(p_email)
      AND user_type = 'safety_security'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_dean(p_email VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE LOWER(email) = LOWER(p_email)
      AND identification = 'faculty'
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM users
  WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
     OR auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_current_user_department()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id
  FROM users
  WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
     OR auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Function to check if a user has configured a security PIN
CREATE OR REPLACE FUNCTION user_has_pin(p_user_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT security_pin_hash IS NOT NULL
  FROM users
  WHERE user_id = p_user_id;
$$;

-- Function to verify user PIN using pgcrypto crypt()
CREATE OR REPLACE FUNCTION verify_user_pin(p_user_id INTEGER, p_pin VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash VARCHAR(255);
BEGIN
  SELECT security_pin_hash INTO v_hash
  FROM users
  WHERE user_id = p_user_id;

  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN v_hash = crypt(p_pin, v_hash);
END;
$$;

-- Function to set user PIN using pgcrypto gen_salt()
CREATE OR REPLACE FUNCTION set_user_pin(p_user_id INTEGER, p_pin VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  UPDATE users
  SET security_pin_hash = crypt(p_pin, gen_salt('bf', 10))
  WHERE user_id = p_user_id;

  RETURN FOUND;
END;
$$;

-- RPC Function for Raspberry Pi Gate Fast Verification
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
  -- Parse gate
  IF LOWER(p_gate_text) LIKE '%rnp%' THEN
    v_gate := 'rnp';
  ELSIF LOWER(p_gate_text) LIKE '%paseo%' THEN
    v_gate := 'paseo';
  ELSE
    v_gate := 'main';
  END IF;

  -- 1. Find registration
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

  -- 2. Check if already inside
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

  -- 3. Fetch vehicle details
  SELECT * INTO v_veh
  FROM vehicle_information
  WHERE vehicle_information_id = v_reg.vehicle_information_id;

  -- 4. Create check-in log
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

-- ---------------------------------------------------------------------
-- 9. SUPABASE AUTH USER AUTOMATIC SYNC TRIGGER
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_dept INTEGER;
BEGIN
  -- Get or use the first department
  SELECT department_id INTO v_default_dept FROM department ORDER BY department_id LIMIT 1;

  INSERT INTO public.users (
    auth_user_id,
    email,
    user_type,
    identification,
    department_id
  ) VALUES (
    NEW.id,
    NEW.email,
    'applicant',
    'student',
    v_default_dept
  )
  ON CONFLICT (email) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------
ALTER TABLE department                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_information        ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration               ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_report            ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_capacity           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification               ENABLE ROW LEVEL SECURITY;
ALTER TABLE modification_request       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_event               ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_settings              ENABLE ROW LEVEL SECURITY;

-- Department: readable by all signed-in users
CREATE POLICY "Departments are readable by authenticated users"
  ON department FOR SELECT TO authenticated USING (true);

-- Users: Read own profile or OSA/Security full read
CREATE POLICY "Users read own profile"
  ON users FOR SELECT TO authenticated
  USING (
    auth_user_id = (SELECT auth.uid())
    OR is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
    OR is_dean((SELECT auth.jwt() ->> 'email'))
  );

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));

-- Registrations: Applicants read own, Deans read department, OSA & Security read all
CREATE POLICY "View registrations by role"
  ON registration FOR SELECT TO authenticated
  USING (
    user_id = (SELECT get_current_user_id())
    OR is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
    OR (
      is_dean((SELECT auth.jwt() ->> 'email'))
      AND department_id = (SELECT get_current_user_department())
    )
  );

CREATE POLICY "Insert own registration"
  ON registration FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT get_current_user_id()));

CREATE POLICY "Update registrations by authorized roles"
  ON registration FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT get_current_user_id())
    OR is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
    OR (
      is_dean((SELECT auth.jwt() ->> 'email'))
      AND department_id = (SELECT get_current_user_department())
    )
  );

-- Vehicle Information
CREATE POLICY "View vehicle information"
  ON vehicle_information FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Insert vehicle information"
  ON vehicle_information FOR INSERT TO authenticated
  WITH CHECK (true);

-- Notifications
CREATE POLICY "Users view their own notifications"
  ON notification FOR SELECT TO authenticated
  USING (user_id = (SELECT get_current_user_id()));

CREATE POLICY "Users update their own notifications"
  ON notification FOR UPDATE TO authenticated
  USING (user_id = (SELECT get_current_user_id()));

-- Vehicle Log & Parking
CREATE POLICY "Allow authenticated read on vehicle_log"
  ON vehicle_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read on parking_capacity"
  ON parking_capacity FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read on campus_event"
  ON campus_event FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read on form_settings"
  ON form_settings FOR SELECT TO authenticated USING (true);

-- Incident Reports (Complaints)
CREATE POLICY "Users view own complaints"
  ON incident_report FOR SELECT TO authenticated
  USING (
    user_id = (SELECT get_current_user_id())
    OR is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
  );

CREATE POLICY "Users create complaint"
  ON incident_report FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT get_current_user_id()));

-- ---------------------------------------------------------------------
-- 11. SUPABASE REALTIME REPLICATION CONFIGURATION
-- ---------------------------------------------------------------------
ALTER TABLE public.registration REPLICA IDENTITY FULL;
ALTER TABLE public.vehicle_log REPLICA IDENTITY FULL;
ALTER TABLE public.incident_report REPLICA IDENTITY FULL;
ALTER TABLE public.modification_request REPLICA IDENTITY FULL;
ALTER TABLE public.parking_capacity REPLICA IDENTITY FULL;
ALTER TABLE public.campus_event REPLICA IDENTITY FULL;
ALTER TABLE public.department REPLICA IDENTITY FULL;
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.notification REPLICA IDENTITY FULL;
ALTER TABLE public.form_settings REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.registration; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_log; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_report; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.modification_request; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_capacity; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.campus_event; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.department; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.users; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notification; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.form_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ---------------------------------------------------------------------
-- 12. SEED INITIAL DATA (Default Admin, Form Setting)
-- ---------------------------------------------------------------------
-- Default OSA Administrator (Password: Admin123!)
INSERT INTO users (
  department_id,
  user_type,
  email,
  identification,
  password_hash
) VALUES (
  NULL,
  'osa',
  'aluban98304@liceo.edu.ph',
  'admin',
  '$2b$10$/ShvmvVm2Uk8nfCqVNFg9.3fxQs4K8cIqmAayu77FuOKHcahsJPvW'
)
ON CONFLICT (email) DO UPDATE SET
  user_type = 'osa',
  identification = 'admin',
  password_hash = '$2b$10$/ShvmvVm2Uk8nfCqVNFg9.3fxQs4K8cIqmAayu77FuOKHcahsJPvW';

-- Default initial application form setting
INSERT INTO form_settings (status, updated_by)
VALUES ('open', 'System')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 13. COMPATIBILITY & LIFECYCLE MIGRATION PATCH (For Existing Databases)
-- ---------------------------------------------------------------------
-- Adds the missing 6-step lifecycle statuses and timestamp columns
ALTER TYPE registration_status_enum ADD VALUE IF NOT EXISTS 'distributed';
ALTER TYPE registration_status_enum ADD VALUE IF NOT EXISTS 'receipt_submitted';
ALTER TYPE registration_status_enum ADD VALUE IF NOT EXISTS 'completed';

-- Adds uppercase fallbacks to prevent enum type mismatch errors
ALTER TYPE change_request_status_enum ADD VALUE IF NOT EXISTS 'Pending';
ALTER TYPE change_request_status_enum ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE change_request_status_enum ADD VALUE IF NOT EXISTS 'Rejected';

ALTER TYPE complaint_status_enum ADD VALUE IF NOT EXISTS 'Pending';
ALTER TYPE complaint_status_enum ADD VALUE IF NOT EXISTS 'Resolved';

ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS osa_dist_at TIMESTAMPTZ;
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS receipt TEXT;
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS sticker_released_at TIMESTAMPTZ;
ALTER TABLE public.registration DROP COLUMN IF EXISTS sticker_installed_at;
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS school_year VARCHAR(20) DEFAULT '2025-2026';
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS year_level VARCHAR(50);

-- ---------------------------------------------------------------------
-- 14. TABLE RENAMES MIGRATION (Safe rename for existing databases)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- 1. application_form_settings -> form_settings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'application_form_settings' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'form_settings') THEN
    ALTER TABLE public.application_form_settings RENAME TO form_settings;
  END IF;

  -- 2. change_vehicle_request -> modification_request
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'change_vehicle_request' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'modification_request') THEN
    ALTER TABLE public.change_vehicle_request RENAME TO modification_request;
  END IF;

  -- 3. complaint -> incident_report
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'complaint' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incident_report') THEN
    ALTER TABLE public.complaint RENAME TO incident_report;
  END IF;

  -- 4. parking_availability -> parking_capacity
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parking_availability' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parking_capacity') THEN
    ALTER TABLE public.parking_availability RENAME TO parking_capacity;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 15. DUPLICATE PREVENTION & UNIQUE CONSTRAINTS
-- ---------------------------------------------------------------------
-- Prevent duplicate active applications per user account
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_unique_active_user 
  ON public.registration (user_id) 
  WHERE status NOT IN ('rejected', 'revoked');

-- Prevent duplicate School ID / Employee ID registrations
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_unique_active_school_id 
  ON public.registration (school_id) 
  WHERE status NOT IN ('rejected', 'revoked');

-- Ensure unique QR Code identifier
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_unique_qr_code 
  ON public.registration (qr_unique_code) 
  WHERE qr_unique_code IS NOT NULL;

-- ---------------------------------------------------------------------
-- 16. BLOCKLIST (idempotent - safe to run alone on an existing database)
-- ---------------------------------------------------------------------
-- Each row is one violation recorded by OSA or Security on a registered vehicle.
-- first_warning / second_warning are recorded and emailed to the applicant.
-- gate_block denies entry at every campus gate (QR scan and manual plate lookup)
-- while NOW() < blocked_until. Rows are matched on registration_id OR vehicle_id.
-- The warning count never resets: after the first gate_block, any new violation is another gate_block.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blocklist_by_enum') THEN
    CREATE TYPE blocklist_by_enum AS ENUM ('osa_admin', 'security_admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'violation_level_enum') THEN
    CREATE TYPE violation_level_enum AS ENUM ('first_warning', 'second_warning', 'gate_block');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.blocklist (
  blocklist_id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id INTEGER REFERENCES public.registration (registration_id) ON DELETE CASCADE,
  vehicle_id      INTEGER REFERENCES public.vehicle_information (vehicle_information_id) ON DELETE CASCADE,
  violation_level violation_level_enum NOT NULL,
  reason          TEXT                 NOT NULL,
  evidence_image  TEXT,                                        -- optional photo URL
  block_by        blocklist_by_enum    NOT NULL,
  recorded_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),  -- when the violation was recorded
  blocked_until   TIMESTAMPTZ,                                  -- gate block ends (gate_block only, set by admin)
  CONSTRAINT blocklist_target_chk    CHECK (registration_id IS NOT NULL OR vehicle_id IS NOT NULL),
  CONSTRAINT blocklist_block_end_chk CHECK (
    (violation_level = 'gate_block' AND blocked_until IS NOT NULL AND blocked_until > recorded_at)
    OR (violation_level <> 'gate_block' AND blocked_until IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_blocklist_registration ON public.blocklist (registration_id);
CREATE INDEX IF NOT EXISTS idx_blocklist_vehicle      ON public.blocklist (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_blocklist_blocked_until ON public.blocklist (blocked_until DESC) WHERE violation_level = 'gate_block';

-- Fill in whichever id the admin left out so both match at the gate
CREATE OR REPLACE FUNCTION trg_blocklist_fill_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.vehicle_id IS NULL AND NEW.registration_id IS NOT NULL THEN
    SELECT vehicle_information_id INTO NEW.vehicle_id
    FROM registration WHERE registration_id = NEW.registration_id;
  ELSIF NEW.registration_id IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT registration_id INTO NEW.registration_id
    FROM registration WHERE vehicle_information_id = NEW.vehicle_id
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blocklist_fill_ids ON public.blocklist;
CREATE TRIGGER trg_blocklist_fill_ids
  BEFORE INSERT OR UPDATE ON public.blocklist
  FOR EACH ROW EXECUTE FUNCTION trg_blocklist_fill_ids();

-- Currently active gate blocks with time remaining
CREATE OR REPLACE VIEW public.active_blocklist
WITH (security_invoker = true) AS
SELECT
  b.*,
  GREATEST(0, EXTRACT(EPOCH FROM (b.blocked_until - NOW()))::BIGINT) AS seconds_remaining
FROM public.blocklist b
WHERE b.violation_level = 'gate_block'
  AND b.blocked_until > NOW();

ALTER TABLE public.blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "OSA and Security read blocklist" ON public.blocklist;
CREATE POLICY "OSA and Security read blocklist"
  ON public.blocklist FOR SELECT TO authenticated
  USING (
    is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
  );

DROP POLICY IF EXISTS "OSA and Security manage blocklist" ON public.blocklist;
CREATE POLICY "OSA and Security manage blocklist"
  ON public.blocklist FOR ALL TO authenticated
  USING (
    is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
  )
  WITH CHECK (
    is_osa_admin((SELECT auth.jwt() ->> 'email'))
    OR is_security_admin((SELECT auth.jwt() ->> 'email'))
  );

ALTER TABLE public.blocklist REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.blocklist; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ---------------------------------------------------------------------
-- 17. REALTIME DASHBOARD BROADCAST (idempotent)
-- ---------------------------------------------------------------------
-- The web app's browser client uses the anon key, so RLS (TO authenticated) hides
-- postgres_changes events from it. This trigger broadcasts only the table name and
-- operation (no row data) on the public 'gateqr-sync' topic; dashboards reload their
-- own data from the server when they receive it. Replaces client-side polling.
CREATE OR REPLACE FUNCTION public.gateqr_broadcast_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP),
      'db_change',
      'gateqr-sync',
      false
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block a write because realtime is unavailable
    NULL;
  END;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'registration', 'vehicle_log', 'incident_report', 'modification_request',
    'parking_capacity', 'campus_event', 'department', 'form_settings', 'blocklist'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_broadcast ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.gateqr_broadcast_change()',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 18. PARKING LIMITS PER VEHICLE TYPE + ADMIN LOGIN EMAIL CONFIRMATION (idempotent)
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
