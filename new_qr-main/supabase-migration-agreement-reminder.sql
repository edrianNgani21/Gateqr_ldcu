-- =====================================================================
-- Migration: Agreement Form to Park reminder (run once on an existing database)
-- Run in: Supabase Dashboard > SQL Editor
-- =====================================================================
-- Applications still pending Department Head approval 24 hours after submission
-- get one reminder email; the applicant can then upload a hardcopy signed by
-- their Department Head, which marks the application as department approved.
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS signed_agreement_form TEXT;
ALTER TABLE public.registration ADD COLUMN IF NOT EXISTS agreement_reminder_sent_at TIMESTAMPTZ;
