-- Admin tables for the Bucksy administration dashboard
-- This migration creates tables for admin actions and audit logging

-- Create admin_actions table for tracking administrative actions
CREATE TABLE IF NOT EXISTS admin_actions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT,  -- JSON data for the action
    created_at INTEGER NOT NULL
);

-- Create index for admin_actions for faster queries
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions(action);