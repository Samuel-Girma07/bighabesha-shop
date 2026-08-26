-- Migration 003: Persist Admin Sessions, 2FA OTPs, Bot Sessions, and Broadcast Drafts

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_otps (
  admin_id INTEGER PRIMARY KEY,
  otp TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  user_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS broadcast_drafts (
  admin_id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  photo_file_id TEXT,
  target_lang TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
