import { JOB_STATUSES } from "@audio-jobs/shared";
import { db } from "./clients.js";
import { audioQueue } from "./queue.js";

// Metrics in the Prometheus text format, so any monitoring tool can read them.
// They are computed from the database on every request instead of kept in memory:
// the numbers stay correct with several API and worker processes and after a restart.

type Sample = { labels?: Record<string, string>; value: number };
type Metric = { name: string; help: string; type: "gauge" | "counter"; samples: Sample[] };

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function render(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`);
    for (const { labels, value } of metric.samples) {
      const labelText = labels
        ? `{${Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}`
        : "";
      lines.push(`${metric.name}${labelText} ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function jobMetrics(): Promise<Metric[]> {
  const [byStatus, oldest, attempts, failures, durations] = await Promise.all([
    db.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM jobs GROUP BY status"),
    db.query<{ seconds: number | null }>(
      "SELECT extract(epoch FROM now() - min(created_at))::float8 AS seconds FROM jobs WHERE status = 'queued'",
    ),
    db.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM job_attempts WHERE status <> 'running' GROUP BY status",
    ),
    db.query<{ error_code: string; n: number }>(
      "SELECT error_code, count(*)::int AS n FROM job_attempts WHERE status = 'failed' GROUP BY error_code ORDER BY error_code",
    ),
    db.query<{ p50: number | null; p95: number | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY s) AS p95
       FROM (SELECT extract(epoch FROM finished_at - started_at)::float8 AS s
             FROM job_attempts
             WHERE status = 'succeeded' AND finished_at > now() - interval '1 hour') recent`,
    ),
  ]);

  const statusCount = new Map(byStatus.rows.map((r) => [r.status, r.n]));
  const attemptCount = new Map(attempts.rows.map((r) => [r.status, r.n]));
  const round = (n: number | null) => Math.round((n ?? 0) * 1000) / 1000;

  return [
    {
      name: "audio_jobs",
      help: "Number of jobs per status.",
      type: "gauge",
      samples: JOB_STATUSES.map((status) => ({ labels: { status }, value: statusCount.get(status) ?? 0 })),
    },
    {
      name: "audio_jobs_oldest_queued_seconds",
      help: "Age of the oldest job that is still waiting. Keeps growing when no worker is running.",
      type: "gauge",
      samples: [{ value: round(oldest.rows[0]?.seconds ?? 0) }],
    },
    {
      name: "audio_job_attempts_total",
      help: "Finished processing attempts per outcome.",
      type: "counter",
      samples: ["succeeded", "failed"].map((outcome) => ({
        labels: { outcome },
        value: attemptCount.get(outcome) ?? 0,
      })),
    },
    {
      name: "audio_job_attempt_failures_total",
      help: "Failed attempts per error code.",
      type: "counter",
      samples: failures.rows.map((r) => ({ labels: { code: r.error_code }, value: r.n })),
    },
    {
      name: "audio_job_attempt_duration_seconds",
      help: "Duration of successful attempts in the last hour (median and 95th percentile).",
      type: "gauge",
      samples: [
        { labels: { quantile: "0.5" }, value: round(durations.rows[0]?.p50 ?? null) },
        { labels: { quantile: "0.95" }, value: round(durations.rows[0]?.p95 ?? null) },
      ],
    },
  ];
}

async function queueMetrics(): Promise<Metric[]> {
  const states = ["waiting", "active", "delayed", "failed"] as const;
  let counts: Record<string, number> | null = null;
  try {
    counts = await audioQueue.getJobCounts(...states);
  } catch {
    // Redis is down: report that instead of failing the whole page.
  }

  return [
    {
      name: "audio_queue_up",
      help: "1 when the queue (Redis) could be read, 0 otherwise.",
      type: "gauge",
      samples: [{ value: counts ? 1 : 0 }],
    },
    {
      name: "audio_queue_messages",
      help: "Messages in the queue per state. 'failed' is the dead-letter list.",
      type: "gauge",
      samples: counts ? states.map((state) => ({ labels: { state }, value: counts[state] ?? 0 })) : [],
    },
  ];
}

export async function getMetrics(): Promise<string> {
  const [jobs, queue] = await Promise.all([jobMetrics(), queueMetrics()]);
  return render([...jobs, ...queue]);
}