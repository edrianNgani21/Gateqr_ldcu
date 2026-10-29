-- =====================================================================
-- Migration: make the gateqr-uploads storage bucket private
-- =====================================================================
-- Run this ONLY AFTER the app version with the /files/ route is deployed.
-- Older deployments link straight to public storage URLs and would stop
-- showing documents, receipts and photos once the bucket is private.
--
-- The app's server uses the service-role key, which can still upload and
-- create signed links; no storage policies are needed for that.
UPDATE storage.buckets
SET public = false
WHERE id = 'gateqr-uploads';

-- To undo:
-- UPDATE storage.buckets SET public = true WHERE id = 'gateqr-uploads';
