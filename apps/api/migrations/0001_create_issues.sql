CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved_open', 'resolved', 'rejected')),
  interactions_json TEXT NOT NULL DEFAULT '[]',
  meta_json TEXT NOT NULL DEFAULT '{}',
  has_screenshot INTEGER NOT NULL DEFAULT 0,
  screenshot_name TEXT,
  screenshot_key TEXT,
  screenshot_content_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_issues_project_status_created
  ON issues(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS issue_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_events_issue_created
  ON issue_status_events(issue_id, created_at DESC);
