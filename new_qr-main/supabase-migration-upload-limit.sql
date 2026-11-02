-- =====================================================================
-- Migration: limit uploaded files to 10 MB (run once on an existing database)
-- Run in: Supabase Dashboard > SQL Editor
-- =====================================================================
-- Applicants upload documents straight to storage, so the bucket itself enforces the limit.
UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'gateqr-uploads';
