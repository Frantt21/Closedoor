-- Migration 006: Add media support to comments
-- Adds image_url and video_url columns to the comments table

ALTER TABLE comments
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS video_url TEXT;
