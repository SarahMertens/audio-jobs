-- Manual sanity check for the schema constraints. Everything is rolled back at the end.
\o /dev/null
BEGIN;

CREATE FUNCTION pg_temp.expect_error(description text, statement text, expected_state text)
RETURNS void AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'FAIL: % (statement was accepted)', description;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN
      RAISE NOTICE 'ok   %', description;
    ELSIF SQLSTATE = 'P0001' THEN
      RAISE;
    ELSE
      RAISE EXCEPTION 'FAIL: % (got % instead of %: %)', description, SQLSTATE, expected_state, SQLERRM;
    END IF;
END;
$$ LANGUAGE plpgsql;

INSERT INTO audio_files (id, storage_key, original_name, mime_type, size_bytes)
VALUES ('00000000-0000-0000-0000-00000000a001', 'uploads/test.mp3', 'test.mp3', 'audio/mpeg', 1024);

INSERT INTO jobs (id, audio_file_id, result_count, idempotency_key)
VALUES ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 3, 'key-1');

-- 23514 = check_violation, 23505 = unique_violation, 23503 = foreign_key_violation
SELECT pg_temp.expect_error('unsupported audio format is rejected',
  $q$INSERT INTO audio_files (storage_key, original_name, mime_type, size_bytes)
     VALUES ('uploads/x.ogg', 'x.ogg', 'audio/ogg', 10)$q$, '23514');

SELECT pg_temp.expect_error('job for unknown audio file is rejected',
  $q$INSERT INTO jobs (audio_file_id, result_count)
     VALUES (gen_random_uuid(), 3)$q$, '23503');

SELECT pg_temp.expect_error('result_count of 0 is rejected',
  $q$INSERT INTO jobs (audio_file_id, result_count)
     VALUES ('00000000-0000-0000-0000-00000000a001', 0)$q$, '23514');

SELECT pg_temp.expect_error('same idempotency key twice is rejected',
  $q$INSERT INTO jobs (audio_file_id, result_count, idempotency_key)
     VALUES ('00000000-0000-0000-0000-00000000a001', 3, 'key-1')$q$, '23505');

SELECT pg_temp.expect_error('unknown status is rejected',
  $q$UPDATE jobs SET status = 'done' WHERE id = '00000000-0000-0000-0000-00000000b001'$q$, '23514');

SELECT pg_temp.expect_error('failed job without error code is rejected',
  $q$UPDATE jobs SET status = 'failed', finished_at = now()
     WHERE id = '00000000-0000-0000-0000-00000000b001'$q$, '23514');

SELECT pg_temp.expect_error('completed job below 100% is rejected',
  $q$UPDATE jobs SET status = 'completed', finished_at = now(), progress = 50
     WHERE id = '00000000-0000-0000-0000-00000000b001'$q$, '23514');

SELECT pg_temp.expect_error('failed attempt without error code is rejected',
  $q$INSERT INTO job_attempts (job_id, attempt_number, status)
     VALUES ('00000000-0000-0000-0000-00000000b001', 1, 'failed')$q$, '23514');

INSERT INTO results (job_id, position, label, text, confidence)
VALUES ('00000000-0000-0000-0000-00000000b001', 1, 'segment', 'hello', 0.9);

SELECT pg_temp.expect_error('two results on the same position are rejected',
  $q$INSERT INTO results (job_id, position, label, text, confidence)
     VALUES ('00000000-0000-0000-0000-00000000b001', 1, 'segment', 'again', 0.9)$q$, '23505');

SELECT pg_temp.expect_error('result without text or value is rejected',
  $q$INSERT INTO results (job_id, position, label, confidence)
     VALUES ('00000000-0000-0000-0000-00000000b001', 2, 'segment', 0.9)$q$, '23514');

SELECT pg_temp.expect_error('confidence above 1 is rejected',
  $q$INSERT INTO results (job_id, position, label, text, confidence)
     VALUES ('00000000-0000-0000-0000-00000000b001', 2, 'segment', 'x', 1.5)$q$, '23514');

SELECT pg_temp.expect_error('end before start is rejected',
  $q$INSERT INTO results (job_id, position, label, text, confidence, start_ms, end_ms)
     VALUES ('00000000-0000-0000-0000-00000000b001', 2, 'segment', 'x', 0.5, 2000, 1000)$q$, '23514');

SELECT pg_temp.expect_error('deleting audio that still has jobs is rejected',
  $q$DELETE FROM audio_files WHERE id = '00000000-0000-0000-0000-00000000a001'$q$, '23503');

-- A valid lifecycle must be accepted, and updated_at must move.
UPDATE jobs SET status = 'running', started_at = now(), attempt_count = 1
WHERE id = '00000000-0000-0000-0000-00000000b001';

UPDATE jobs SET status = 'completed', progress = 100, finished_at = now()
WHERE id = '00000000-0000-0000-0000-00000000b001';

DO $$
BEGIN
  IF (SELECT status FROM jobs WHERE id = '00000000-0000-0000-0000-00000000b001') <> 'completed' THEN
    RAISE EXCEPTION 'FAIL: valid lifecycle was not stored';
  END IF;
  RAISE NOTICE 'ok   valid lifecycle queued -> running -> completed is accepted';
  RAISE NOTICE 'ALL CHECKS PASSED';
END;
$$;

ROLLBACK;