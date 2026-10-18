-- When a failed attempt will be retried, so the UI can show "next try in 4 s".
ALTER TABLE jobs ADD COLUMN next_retry_at timestamptz;

-- Fast lookup for the dead-letter view (failed jobs, newest first).
CREATE INDEX jobs_failed_finished_at_idx ON jobs (finished_at DESC) WHERE status = 'failed';