-- ============================================================
-- GATEQR DATABASE
-- COMPLETE DATABASE SCHEMA
-- ============================================================
--
-- SYSTEM:
-- QR CODE-BASED VEHICLE REGISTRATION AND
-- AUTOMATED GATE BARRIER SYSTEM
--
-- DATABASE:
-- Supabase / PostgreSQL
--
-- ROLES:
--   Applicants
--   Safety Security
--   Osa
--   dean
--
-- IMPORTANT:
--   1. RUN THIS SCHEMA FIRST.
--   2. RUN THE RLS POLICIES SECOND.
--   3. The table "user" MUST ALWAYS be written with quotes.
--   4. device_tokens IS NOT INCLUDED.
--   5. registration and vehicle_information are separate.
--   6. Documents are stored as VARCHAR (file paths) not BYTEA
--   7. Status is stored directly in registration table
-- ============================================================




-- ============================================================
-- 1. REMOVE OLD TABLES
-- ============================================================
-- This is a development/reset schema.
-- Existing data in these GATEQR tables will be deleted.
-- ============================================================


DROP TABLE IF EXISTS application_form_settings CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS change_vehicle_requests CASCADE;
DROP TABLE IF EXISTS otp_codes CASCADE;
DROP TABLE IF EXISTS guest_log CASCADE;
DROP TABLE IF EXISTS vip_log CASCADE;
DROP TABLE IF EXISTS complaint CASCADE;
DROP TABLE IF EXISTS parking_availability CASCADE;
DROP TABLE IF EXISTS vehicle_log CASCADE;
DROP TABLE IF EXISTS registration CASCADE;
DROP TABLE IF EXISTS vehicle_information CASCADE;
DROP TABLE IF EXISTS user_log CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS department CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;
DROP TABLE IF EXISTS campus_events CASCADE;




-- ============================================================
-- 2. REMOVE OLD FUNCTIONS
-- ============================================================


DROP FUNCTION IF EXISTS create_user_if_not_exists(
    TEXT,
    VARCHAR,
    VARCHAR
) CASCADE;


DROP FUNCTION IF EXISTS is_osa_admin(VARCHAR) CASCADE;


DROP FUNCTION IF EXISTS is_security_admin(VARCHAR) CASCADE;


DROP FUNCTION IF EXISTS is_dean(VARCHAR) CASCADE;


DROP FUNCTION IF EXISTS get_user_role(VARCHAR) CASCADE;


DROP FUNCTION IF EXISTS get_current_user_id() CASCADE;


DROP FUNCTION IF EXISTS get_current_user_department() CASCADE;


DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;




-- ============================================================
-- 3. REMOVE OLD ENUM TYPES
-- ============================================================


DROP TYPE IF EXISTS vehicle_change_status_enum CASCADE;
DROP TYPE IF EXISTS complaint_status_enum CASCADE;
DROP TYPE IF EXISTS registration_status_enum CASCADE;
DROP TYPE IF EXISTS vehicle_type_enum CASCADE;
DROP TYPE IF EXISTS identification_enum CASCADE;
DROP TYPE IF EXISTS user_type_enum CASCADE;




-- ============================================================
-- 4. EXTENSION
-- ============================================================


CREATE EXTENSION IF NOT EXISTS pgcrypto;




-- ============================================================
-- 5. ENUM: USER TYPE
-- ============================================================


CREATE TYPE user_type_enum AS ENUM (
    'Applicants',
    'Safety Security',
    'Osa',
    'dean'
);




-- ============================================================
-- 6. ENUM: IDENTIFICATION
-- ============================================================


CREATE TYPE identification_enum AS ENUM (
    'Admin',
    'Staff',
    'Faculty',
    'Student',
    'Visitor',
    'Guard'
);




-- ============================================================
-- 7. ENUM: VEHICLE TYPE
-- ============================================================


CREATE TYPE vehicle_type_enum AS ENUM (
    '2-Wheeler / Motorcycle',
    '4-Wheeler / Car',
    'Truck',
    'Van',
    'Other'
);




-- ============================================================
-- 8. ENUM: REGISTRATION STATUS
-- ============================================================


CREATE TYPE registration_status_enum AS ENUM (
    'dept_val',      -- Pending Dean Validation
    'osa_val',       -- Pending OSA Validation  
    'scheduled',     -- Scheduled for Distribution
    'distributed',   -- Sticker Distributed
    'completed',     -- Process Completed
    'rejected',      -- Rejected
    'revoked',       -- Revoked
    'expired'        -- Expired
);




-- ============================================================
-- 9. ENUM: COMPLAINT STATUS
-- ============================================================


CREATE TYPE complaint_status_enum AS ENUM (
    'Pending',
    'Resolved'
);




-- ============================================================
-- 10. ENUM: VEHICLE CHANGE REQUEST STATUS
-- ============================================================


CREATE TYPE vehicle_change_status_enum AS ENUM (
    'Pending',
    'pending',
    'Approved',
    'approved',
    'Rejected',
    'rejected',
    'completed',
    'Completed',
    'in_progress',
    'scheduled'
);




-- ============================================================
-- 11. DEPARTMENT TABLE
-- ============================================================
--
-- Data Dictionary:
--   Department_ID
--   User_ID
--   Department
--   Timestamp
--
-- user_id is added after the "user" table is created because
-- USER and DEPARTMENT have a two-way relationship.
-- ============================================================


CREATE TABLE department (
    department_id SERIAL PRIMARY KEY,


    user_id INTEGER,


    department VARCHAR(100)
        NOT NULL
        UNIQUE,


    email VARCHAR(255)
        UNIQUE,


    is_active BOOLEAN
        NOT NULL
        DEFAULT TRUE,


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);




-- ============================================================
-- 12. USER TABLE
-- ============================================================
--
-- IMPORTANT:
--
-- PostgreSQL reserves the word USER.
--
-- Therefore the table MUST be:
--
--     "user"
--
-- NOT:
--
--     user
-- ============================================================


CREATE TABLE "user" (
    user_id SERIAL PRIMARY KEY,


    email VARCHAR(255)
        NOT NULL
        UNIQUE,


    user_type user_type_enum
        NOT NULL
        DEFAULT 'Applicants',


    identification identification_enum
        NOT NULL
        DEFAULT 'Visitor',


    department_id INTEGER,


    is_active BOOLEAN
        NOT NULL
        DEFAULT TRUE,


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_user_department
        FOREIGN KEY (department_id)
        REFERENCES department(department_id)
        ON DELETE SET NULL
);




-- ============================================================
-- 13. DEPARTMENT -> USER FOREIGN KEY
-- ============================================================
--
-- Added after USER exists.
-- ============================================================


ALTER TABLE department
ADD CONSTRAINT fk_department_user
FOREIGN KEY (user_id)
REFERENCES "user"(user_id)
ON DELETE SET NULL;




-- ============================================================
-- 14. VEHICLE_INFORMATION TABLE
-- ============================================================
--
-- Stores the actual vehicle details and documents.
-- ============================================================


CREATE TABLE vehicle_information (
    vehicle_information_id SERIAL PRIMARY KEY,


    or_document VARCHAR(255),


    cr_document VARCHAR(255),


    plate_number VARCHAR(20)
        NOT NULL
        UNIQUE,


    color VARCHAR(20)
        NOT NULL,


    brand VARCHAR(50)
        NOT NULL,


    type vehicle_type_enum
        NOT NULL,


    qr_code VARCHAR(255),


    drivers_license VARCHAR(255),


    school_id VARCHAR(255),


    authorization_letter VARCHAR(255)
        NOT NULL,


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW()
);




-- ============================================================
-- 15. REGISTRATION TABLE
-- ============================================================
--
-- Stores the applicant's registration/application.
-- ============================================================


CREATE TABLE registration (
    registration_id SERIAL PRIMARY KEY,


    vehicle_information_id INTEGER
        NOT NULL,


    status registration_status_enum
        NOT NULL
        DEFAULT 'dept_val',


    user_id INTEGER
        NOT NULL,


    department_id INTEGER
        NOT NULL,


    agreement_form VARCHAR(255),


    first_name VARCHAR(100)
        NOT NULL,


    last_name VARCHAR(100)
        NOT NULL,


    mobile VARCHAR(30)
        NOT NULL,





    role VARCHAR(50)
        NOT NULL,


    campus VARCHAR(50),


    year_level VARCHAR(50),

    facebook VARCHAR(255),


    student_id VARCHAR(255),


    enrollment_form VARCHAR(255),


    dept_val_at TIMESTAMPTZ,


    osa_val_at TIMESTAMPTZ,


    osa_dist_at TIMESTAMPTZ,


    dist_sched TIMESTAMPTZ,


    security_checked_at TIMESTAMPTZ,


    sticker_released_at TIMESTAMPTZ,


    sticker_installed_at TIMESTAMPTZ,


    expires_at TIMESTAMPTZ,


    revoked_at TIMESTAMPTZ,


    rejected_at TIMESTAMPTZ,


    invalid_reason TEXT,


    qr_code VARCHAR(255),

    qr_unique_code VARCHAR(50),


    is_owner BOOLEAN
        NOT NULL
        DEFAULT TRUE,


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_registration_vehicle
        FOREIGN KEY (vehicle_information_id)
        REFERENCES vehicle_information(vehicle_information_id)
        ON DELETE RESTRICT,


    CONSTRAINT fk_registration_user
        FOREIGN KEY (user_id)
        REFERENCES "user"(user_id)
        ON DELETE CASCADE,


    CONSTRAINT fk_registration_department
        FOREIGN KEY (department_id)
        REFERENCES department(department_id)
        ON DELETE CASCADE
);




-- ============================================================
-- 16. STATUS TABLE REMOVED
-- ============================================================
--
-- Status is now stored directly in the registration table as a status column
-- instead of using a separate status table for better performance and simplicity
-- ============================================================




-- ============================================================
-- 17. REGISTRATION -> STATUS FOREIGN KEY
-- ============================================================
--
-- No foreign key constraint needed for status since it's now a direct column
-- ============================================================




-- ============================================================
-- 18. USER_LOG TABLE (REMOVED)
-- ============================================================
-- This table has been removed from the schema.
-- Notifications table is used instead.




-- ============================================================
-- 19. VEHICLE_LOG TABLE
-- ============================================================
--
-- Records vehicle entry and exit.
-- ============================================================


CREATE TABLE vehicle_log (
    vehicle_log_id SERIAL PRIMARY KEY,


    vehicle_information_id INTEGER
        NOT NULL,


    registration_id INTEGER
        NOT NULL,


    check_in TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    check_out TIMESTAMPTZ,


    logged_status VARCHAR(30)
        NOT NULL
        DEFAULT 'Inside',


    campus VARCHAR(50)
        NOT NULL
        DEFAULT 'Main',


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_vehicle_log_vehicle
        FOREIGN KEY (vehicle_information_id)
        REFERENCES vehicle_information(vehicle_information_id)
        ON DELETE RESTRICT,


    CONSTRAINT fk_vehicle_log_registration
        FOREIGN KEY (registration_id)
        REFERENCES registration(registration_id)
        ON DELETE RESTRICT
);




-- ============================================================
-- 20. PARKING_AVAILABILITY TABLE
-- ============================================================


CREATE TABLE parking_availability (
    parking_availability_id SERIAL PRIMARY KEY,


    vehicle_log_id INTEGER,


    parking_capacity INTEGER
        NOT NULL
        DEFAULT 0,


    slot_occupied INTEGER
        NOT NULL
        DEFAULT 0,


    slot_unoccupied INTEGER
        NOT NULL
        DEFAULT 0,


    date_time TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_parking_vehicle_log
        FOREIGN KEY (vehicle_log_id)
        REFERENCES vehicle_log(vehicle_log_id)
        ON DELETE CASCADE,


    CONSTRAINT chk_parking_capacity
        CHECK (parking_capacity >= 0),


    CONSTRAINT chk_slot_occupied
        CHECK (slot_occupied >= 0),


    CONSTRAINT chk_slot_unoccupied
        CHECK (slot_unoccupied >= 0)
);




-- ============================================================
-- 21. COMPLAINT TABLE
-- ============================================================


CREATE TABLE complaint (
    complaint_id SERIAL PRIMARY KEY,


    user_id INTEGER
        NOT NULL,


    message TEXT
        NOT NULL,


    schedule TIMESTAMPTZ,


    status complaint_status_enum
        NOT NULL
        DEFAULT 'Pending',


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    resolved_at TIMESTAMPTZ,


    resolved_by INTEGER,


    CONSTRAINT fk_complaint_user
        FOREIGN KEY (user_id)
        REFERENCES "user"(user_id)
        ON DELETE CASCADE,


    CONSTRAINT fk_complaint_resolved_by
        FOREIGN KEY (resolved_by)
        REFERENCES "user"(user_id)
        ON DELETE SET NULL
);




-- ============================================================
-- 22. VIP_LOG TABLE
-- ============================================================


CREATE TABLE vip_log (
    vip_log_id SERIAL PRIMARY KEY,


    vehicle_log_id INTEGER
        NOT NULL,


    name VARCHAR(150)
        NOT NULL,


    vehicle_plate VARCHAR(20),


    vip_type VARCHAR(50),


    timestamp TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_vip_vehicle_log
        FOREIGN KEY (vehicle_log_id)
        REFERENCES vehicle_log(vehicle_log_id)
        ON DELETE CASCADE
);




-- ============================================================
-- 23. GUEST_LOG TABLE
-- ============================================================


CREATE TABLE guest_log (
    guest_log_id SERIAL PRIMARY KEY,


    vehicle_log_id INTEGER
        NOT NULL,


    plate_number VARCHAR(20)
        NOT NULL,


    id_number VARCHAR(50)
        NOT NULL,


    purpose TEXT,


    timestamp TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    CONSTRAINT fk_guest_vehicle_log
        FOREIGN KEY (vehicle_log_id)
        REFERENCES vehicle_log(vehicle_log_id)
        ON DELETE CASCADE
);




-- ============================================================
-- 24. OTP_CODES TABLE
-- ============================================================
--
-- NOTE:
-- device_tokens IS NOT CREATED.
-- ============================================================


CREATE TABLE otp_codes (
    otp_id SERIAL PRIMARY KEY,


    user_id INTEGER
        NOT NULL,


    email VARCHAR(255)
        NOT NULL,


    otp VARCHAR(10)
        NOT NULL,


    expires_at TIMESTAMPTZ
        NOT NULL,


    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    used_at TIMESTAMPTZ,


    CONSTRAINT fk_otp_user
        FOREIGN KEY (user_id)
        REFERENCES "user"(user_id)
        ON DELETE CASCADE
);




-- ============================================================
-- 25. CHANGE_VEHICLE_REQUESTS TABLE
-- ============================================================


CREATE TABLE change_vehicle_requests (
    request_id SERIAL PRIMARY KEY,


    user_id INTEGER
        NOT NULL,


    registration_id INTEGER
        NOT NULL,


    original_vehicle_id INTEGER
        NOT NULL,


    new_vehicle_id INTEGER,


    status vehicle_change_status_enum
        NOT NULL
        DEFAULT 'Pending',


    reason TEXT
        NOT NULL,


    requested_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),


    processed_at TIMESTAMPTZ,


    processed_by INTEGER,


    CONSTRAINT fk_change_vehicle_user
        FOREIGN KEY (user_id)
        REFERENCES "user"(user_id)
        ON DELETE CASCADE,


    CONSTRAINT fk_change_vehicle_registration
        FOREIGN KEY (registration_id)
        REFERENCES registration(registration_id)
        ON DELETE CASCADE,


    CONSTRAINT fk_change_vehicle_original
        FOREIGN KEY (original_vehicle_id)
        REFERENCES vehicle_information(vehicle_information_id)
        ON DELETE RESTRICT,


    CONSTRAINT fk_change_vehicle_new
        FOREIGN KEY (new_vehicle_id)
        REFERENCES vehicle_information(vehicle_information_id)
        ON DELETE SET NULL,


    CONSTRAINT fk_change_vehicle_processed_by
        FOREIGN KEY (processed_by)
        REFERENCES "user"(user_id)
        ON DELETE SET NULL
);




-- ============================================================
-- 26. NOTIFICATIONS TABLE
-- ============================================================
--
-- Supports application notifications and activity tracking
-- for all dashboard users including OSA, Dean, Security, etc.
-- ============================================================


CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,
    
    user_id INTEGER
        NOT NULL,
    
    notification_type VARCHAR(50)
        NOT NULL,
    
    message TEXT
        NOT NULL,
    
    -- For activity tracking
    actor_id INTEGER,
    action_type VARCHAR(50),
    target_entity_type VARCHAR(50),
    target_entity_id INTEGER,
    
    -- For application-specific notifications
    reference_id INTEGER,
    
    metadata JSONB,
    
    is_read BOOLEAN
        NOT NULL
        DEFAULT FALSE,
    
    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT NOW(),
    
    read_at TIMESTAMPTZ,
    
    CONSTRAINT fk_notification_user
        FOREIGN KEY (user_id)
        REFERENCES "user"(user_id)
        ON DELETE CASCADE
);

-- Indexes for notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_actor_id ON notifications(actor_id);
CREATE INDEX idx_notifications_target_entity ON notifications(target_entity_type, target_entity_id);


-- ============================================================
-- 27. SYSTEM_SETTINGS TABLE (REMOVED)
-- ============================================================
-- This table has been removed from the schema.
-- Settings are now stored in the parking_availability table.




-- ============================================================
-- 28. INDEXES
-- ============================================================


CREATE INDEX idx_user_email
ON "user"(email);


CREATE INDEX idx_user_department
ON "user"(department_id);


CREATE INDEX idx_department_user
ON department(user_id);

CREATE INDEX idx_department_department
ON department(department);


CREATE INDEX idx_registration_user
ON registration(user_id);


CREATE INDEX idx_registration_department
ON registration(department_id);


CREATE INDEX idx_registration_vehicle
ON registration(vehicle_information_id);


CREATE INDEX idx_registration_status
ON registration(status);


CREATE INDEX idx_vehicle_plate
ON vehicle_information(plate_number);


CREATE INDEX idx_vehicle_log_vehicle
ON vehicle_log(vehicle_information_id);


CREATE INDEX idx_vehicle_log_registration
ON vehicle_log(registration_id);


CREATE INDEX idx_vehicle_log_check_in
ON vehicle_log(check_in);


CREATE INDEX idx_parking_vehicle_log
ON parking_availability(vehicle_log_id);


CREATE INDEX idx_complaint_user
ON complaint(user_id);


CREATE INDEX idx_complaint_status
ON complaint(status);


CREATE INDEX idx_vip_vehicle_log
ON vip_log(vehicle_log_id);


CREATE INDEX idx_guest_vehicle_log
ON guest_log(vehicle_log_id);


CREATE INDEX idx_otp_email
ON otp_codes(email);


CREATE INDEX idx_otp_user
ON otp_codes(user_id);


CREATE INDEX idx_change_vehicle_user
ON change_vehicle_requests(user_id);


CREATE INDEX idx_change_vehicle_registration
ON change_vehicle_requests(registration_id);


CREATE INDEX idx_change_vehicle_original
ON change_vehicle_requests(original_vehicle_id);


CREATE INDEX idx_change_vehicle_new
ON change_vehicle_requests(new_vehicle_id);




-- ============================================================
-- 29. UPDATED_AT FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;




-- ============================================================
-- 30. UPDATED_AT TRIGGERS
-- ============================================================


CREATE TRIGGER update_vehicle_information_updated_at
BEFORE UPDATE ON vehicle_information
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();




CREATE TRIGGER update_registration_updated_at
BEFORE UPDATE ON registration
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();




-- REMOVED: system_settings trigger (table removed)
-- CREATE TRIGGER update_system_settings_updated_at
-- BEFORE UPDATE ON system_settings
-- FOR EACH ROW
-- EXECUTE FUNCTION update_updated_at_column();




-- ============================================================
-- 31. CREATE USER IF NOT EXISTS FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION create_user_if_not_exists(
    p_email TEXT,
    p_user_type VARCHAR DEFAULT 'Applicants',
    p_identification VARCHAR DEFAULT 'Visitor'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id INTEGER;
BEGIN


    SELECT user_id
    INTO v_user_id
    FROM "user"
    WHERE LOWER(email) = LOWER(p_email)
    LIMIT 1;


    IF v_user_id IS NOT NULL THEN
        RETURN v_user_id;
    END IF;


    INSERT INTO "user" (
        email,
        user_type,
        identification
    )
    VALUES (
        LOWER(p_email),
        p_user_type::user_type_enum,
        p_identification::identification_enum
    )
    RETURNING user_id
    INTO v_user_id;


    RETURN v_user_id;


END;
$$;




-- ============================================================
-- 32. OSA ADMIN FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION is_osa_admin(
    p_email VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN


    RETURN EXISTS (
        SELECT 1
        FROM "user"
        WHERE LOWER(email) = LOWER(p_email)
        AND user_type = 'Osa'
    );


END;
$$;




-- ============================================================
-- 33. SAFETY SECURITY ADMIN FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION is_security_admin(
    p_email VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN


    RETURN EXISTS (
        SELECT 1
        FROM "user"
        WHERE LOWER(email) = LOWER(p_email)
        AND user_type = 'Safety Security'
    );


END;
$$;




-- ============================================================
-- 34. DEAN FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION is_dean(
    p_email VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN


    RETURN EXISTS (
        SELECT 1
        FROM "user"
        WHERE LOWER(email) = LOWER(p_email)
        AND user_type = 'dean'
    );


END;
$$;




-- ============================================================
-- 35. GET USER ROLE FUNCTION
-- ============================================================


CREATE OR REPLACE FUNCTION get_user_role(
    p_email VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role VARCHAR;
BEGIN


    SELECT
        CASE
            WHEN user_type = 'Osa'
                THEN 'osa'


            WHEN user_type = 'Safety Security'
                THEN 'security'


            WHEN user_type = 'dean'
                THEN 'dean'


            ELSE 'applicant'
        END
    INTO v_role


    FROM "user"


    WHERE LOWER(email) = LOWER(p_email)


    LIMIT 1;


    RETURN COALESCE(v_role, 'applicant');


END;
$$;




-- ============================================================
-- 36. GET CURRENT USER ID
-- ============================================================


CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT user_id
    FROM "user"
    WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    LIMIT 1;
$$;




-- ============================================================
-- 37. GET CURRENT USER DEPARTMENT
-- ============================================================


CREATE OR REPLACE FUNCTION get_current_user_department()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT department_id
    FROM "user"
    WHERE LOWER(email) = LOWER(auth.jwt() ->> 'email')
    LIMIT 1;
$$;




-- ============================================================
-- 38. DEFAULT OSA ADMIN
-- ============================================================


INSERT INTO "user" (
    email,
    user_type,
    identification
)
VALUES (
    'aluban98304@liceo.edu.ph',
    'Osa',
    'Faculty'
)
ON CONFLICT (email)
DO UPDATE SET
    user_type = 'Osa',
    identification = 'Faculty';




-- ============================================================
-- 39. APPLICATION FORM SETTINGS TABLE
-- ============================================================
-- Stores configuration for the application form (e.g. open/closed status)
-- and references the admin user who last modified it.
-- ============================================================


CREATE TABLE application_form_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by INTEGER REFERENCES "user"(user_id) ON DELETE SET NULL,
    updated_by_email VARCHAR(255) REFERENCES "user"(email) ON DELETE SET NULL
);

INSERT INTO application_form_settings (key, value)
VALUES ('application_form_open', 'true')
ON CONFLICT (key) DO NOTHING;




-- ============================================================
-- CAMPUS CAPACITY & PARKING UPDATE
-- ============================================================
-- Note: Assuming `parking_availability` table exists.
ALTER TABLE parking_availability
ALTER COLUMN vehicle_log_id DROP NOT NULL,
ADD COLUMN campus VARCHAR(255) DEFAULT 'Main Campus',
ADD COLUMN event_name VARCHAR(255);

CREATE TABLE campus_events (
    event_id SERIAL PRIMARY KEY,
    campus VARCHAR(255) NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 40. SUPABASE REALTIME REPLICATION CONFIGURATION
-- ============================================================
-- Enables Realtime websocket broadcasts for instant UI updates
-- without requiring manual page refresh.
-- ============================================================

ALTER TABLE public.registration REPLICA IDENTITY FULL;
ALTER TABLE public.vehicle_log REPLICA IDENTITY FULL;
ALTER TABLE public.complaint REPLICA IDENTITY FULL;
ALTER TABLE public.change_vehicle_requests REPLICA IDENTITY FULL;
ALTER TABLE public.parking_availability REPLICA IDENTITY FULL;
ALTER TABLE public.campus_events REPLICA IDENTITY FULL;
ALTER TABLE public.department REPLICA IDENTITY FULL;
ALTER TABLE public."user" REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.application_form_settings REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.registration;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_log;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.complaint;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.change_vehicle_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.parking_availability;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.campus_events;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.department;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public."user";
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.application_form_settings;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ============================================================
-- END OF COMPLETE GATEQR DATABASE SCHEMA
-- ============================================================

