-- Migration 002: Add phone number and registration status to users table
ALTER TABLE users ADD COLUMN phone_number TEXT;
ALTER TABLE users ADD COLUMN is_registered INTEGER DEFAULT 0;
