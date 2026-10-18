// Builds the environment for the tests from the normal .env values,
// but with a separate database, bucket and queue prefix so tests never touch dev data.
export function testEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is missing. Create .env from .env.example first.`);
    return value;
  };

  const databaseUrl = new URL(required("DATABASE_URL"));
  databaseUrl.pathname = `${databaseUrl.pathname}_test`;

  return {
    DATABASE_URL: databaseUrl.toString(),
    REDIS_URL: required("REDIS_URL"),
    S3_ENDPOINT: required("S3_ENDPOINT"),
    S3_REGION: required("S3_REGION"),
    S3_ACCESS_KEY: required("S3_ACCESS_KEY"),
    S3_SECRET_KEY: required("S3_SECRET_KEY"),
    S3_BUCKET: `${required("S3_BUCKET")}-test`,
    QUEUE_PREFIX: "test",
    LOG_LEVEL: "silent",
    // Small limit so the "too large" test doesn't need a 50 MB file.
    MAX_UPLOAD_MB: "1",
    DEFAULT_RESULT_COUNT: "5",
    MAX_RESULT_COUNT: "20",
    MOCK_PROCESSING_MS: "0",
    FAILURE_INJECTION: "false",
  };
}