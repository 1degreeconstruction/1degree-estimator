-- ============================================================
-- 1 Degree Construction Estimator — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_reps (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimates (
  id                  SERIAL PRIMARY KEY,
  estimate_number     TEXT NOT NULL UNIQUE,
  client_name         TEXT NOT NULL,
  client_email        TEXT NOT NULL,
  client_phone        TEXT NOT NULL,
  project_address     TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT NOT NULL,
  zip                 TEXT NOT NULL,
  sales_rep_id        INTEGER NOT NULL REFERENCES sales_reps(id),
  status              TEXT NOT NULL DEFAULT 'draft',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at             TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  signature_name      TEXT,
  signature_timestamp TIMESTAMPTZ,
  notes_internal      TEXT,
  valid_until         TEXT NOT NULL,
  total_sub_cost      REAL NOT NULL DEFAULT 0,
  total_client_price  REAL NOT NULL DEFAULT 0,
  allowance_amount    REAL NOT NULL DEFAULT 0,
  deposit_amount      REAL NOT NULL DEFAULT 0,
  permit_required     BOOLEAN NOT NULL DEFAULT FALSE,
  unique_id           TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS line_items (
  id                 SERIAL PRIMARY KEY,
  estimate_id        INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,
  phase_group        TEXT NOT NULL,
  custom_phase_label TEXT,
  scope_description  TEXT NOT NULL,
  sub_cost           REAL NOT NULL,
  client_price       REAL NOT NULL,
  is_grouped         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS payment_milestones (
  id             SERIAL PRIMARY KEY,
  estimate_id    INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  milestone_name TEXT NOT NULL,
  amount         REAL NOT NULL,
  sort_order     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_events (
  id          SERIAL PRIMARY KEY,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    TEXT
);

-- ============================================================
-- PRODUCTION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  google_id      TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  avatar_url     TEXT,
  role           TEXT NOT NULL DEFAULT 'estimator', -- admin | estimator | viewer
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contacts (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  notes               TEXT,
  created_by_user_id  INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id               SERIAL PRIMARY KEY,
  estimate_id      INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  sent_by_user_id  INTEGER REFERENCES users(id),
  recipient_email  TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body_preview     TEXT,
  gmail_message_id TEXT,
  email_type       TEXT NOT NULL, -- estimate | follow_up_1 | follow_up_2 | confirmation
  status           TEXT NOT NULL DEFAULT 'sent', -- sent | failed | bounced
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  estimate_id INTEGER REFERENCES estimates(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL, -- created | edited | sent | viewed | signed | status_changed | note_added | email_sent
  details     TEXT,
  metadata    JSONB,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_versions (
  id                  SERIAL PRIMARY KEY,
  estimate_id         INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  snapshot_json       JSONB NOT NULL,
  changed_by_user_id  INTEGER REFERENCES users(id),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_summary      TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

-- estimates
CREATE INDEX IF NOT EXISTS idx_estimates_status      ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimates_unique_id   ON estimates(unique_id);
CREATE INDEX IF NOT EXISTS idx_estimates_sales_rep   ON estimates(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_estimates_created_at  ON estimates(created_at DESC);

-- line_items
CREATE INDEX IF NOT EXISTS idx_line_items_estimate   ON line_items(estimate_id);

-- payment_milestones
CREATE INDEX IF NOT EXISTS idx_milestones_estimate   ON payment_milestones(estimate_id);

-- estimate_events
CREATE INDEX IF NOT EXISTS idx_events_estimate       ON estimate_events(estimate_id);

-- users
CREATE INDEX IF NOT EXISTS idx_users_google_id       ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);

-- activity_log
CREATE INDEX IF NOT EXISTS idx_activity_estimate     ON activity_log(estimate_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp    ON activity_log(timestamp DESC);

-- email_logs
CREATE INDEX IF NOT EXISTS idx_email_logs_estimate   ON email_logs(estimate_id);

-- estimate_versions
CREATE INDEX IF NOT EXISTS idx_versions_estimate     ON estimate_versions(estimate_id);

-- ============================================================
-- SEED DATA — Sales Reps
-- Only inserts if table is empty to avoid duplicates on re-run
-- ============================================================

INSERT INTO sales_reps (name, title, email, phone)
SELECT * FROM (VALUES
  ('David Gaon',       'Co-Founder',      'david@1degreeconstruction.com',  '818-720-1753'),
  ('Thai Gaon',        'Co-Founder',      'thai@1degreeconstruction.com',   '818-674-3373'),
  ('Oliver Loshitzer', 'Project Manager', 'oliver@1degreeconstruction.com', '310-808-3118')
) AS v(name, title, email, phone)
WHERE NOT EXISTS (SELECT 1 FROM sales_reps LIMIT 1);
