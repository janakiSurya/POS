-- End-of-day shift close summaries (PDF source data)
CREATE TABLE IF NOT EXISTS day_close_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_day_close_reports_business_date
  ON day_close_reports (business_date DESC);

ALTER TABLE day_close_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY day_close_reports_all ON day_close_reports FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
