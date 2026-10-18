CREATE TABLE audio_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key   text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type     text NOT NULL CHECK (mime_type IN ('audio/mpeg', 'audio/wav', 'audio/mp4')),
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_file_id   uuid NOT NULL REFERENCES audio_files (id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result_count    integer NOT NULL CHECK (result_count BETWEEN 1 AND 100),
  idempotency_key text UNIQUE,
  progress        integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt_count   integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  -- 1 first try + 3 retries, as required by the retry policy.
  max_attempts    integer NOT NULL DEFAULT 4 CHECK (max_attempts >= 1),
  error_code      text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,

  CONSTRAINT failed_jobs_have_error
    CHECK (status <> 'failed' OR error_code IS NOT NULL),
  CONSTRAINT finished_jobs_have_timestamp
    CHECK (status NOT IN ('completed', 'failed') OR finished_at IS NOT NULL),
  CONSTRAINT completed_jobs_are_at_100
    CHECK (status <> 'completed' OR progress = 100)
);

CREATE INDEX jobs_status_created_at_idx ON jobs (status, created_at DESC);
CREATE INDEX jobs_audio_file_id_idx ON jobs (audio_file_id);

CREATE TABLE job_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  status         text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code     text,
  error_message  text,
  retryable      boolean,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,

  UNIQUE (job_id, attempt_number),
  CONSTRAINT failed_attempts_have_error
    CHECK (status <> 'failed' OR (error_code IS NOT NULL AND retryable IS NOT NULL))
);

CREATE TABLE results (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  position   integer NOT NULL CHECK (position >= 1),
  label      text NOT NULL,
  text       text,
  value      numeric,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  start_ms   integer CHECK (start_ms >= 0),
  end_ms     integer,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per position makes "exactly N results" enforceable, even if a retry writes twice.
  UNIQUE (job_id, position),
  CONSTRAINT result_has_content CHECK (text IS NOT NULL OR value IS NOT NULL),
  CONSTRAINT result_time_range CHECK (end_ms IS NULL OR (start_ms IS NOT NULL AND end_ms >= start_ms))
);

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();