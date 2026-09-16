// Fetches weekly download counts for Simple AutoPickup from Modrinth analytics
// and writes them as JSON for the site's downloads chart.
//
// Usage: MODRINTH_ANALYTICS_TOKEN=... node tools/fetch-modrinth-analytics.mjs data/modrinth-downloads.json
//
// The token needs the ANALYTICS scope. It is only ever sent to api.modrinth.com
// and is never written to the output file.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PROJECT = "simple-autopickup";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const API = "https://api.modrinth.com";
const USER_AGENT = "lukehinojosa/portfolio-analytics (github.com/lukehinojosa)";

const outPath = process.argv[2] ?? "data/modrinth-downloads.json";
const token = process.env.MODRINTH_ANALYTICS_TOKEN?.trim();
if (!token) {
  console.error("MODRINTH_ANALYTICS_TOKEN is not set.");
  process.exit(1);
}

async function request(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Buckets end on the most recent Monday 00:00 UTC, so every bucket is a full week
// and past buckets stay stable between runs.
function lastMondayUtc(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

const project = await request(`/v2/project/${PROJECT}`);
const published = new Date(project.published);
const end = lastMondayUtc(new Date());
const weeks = Math.ceil((end - published) / WEEK_MS);
if (weeks < 1) throw new Error("Project is younger than one full week.");
const start = new Date(end.getTime() - weeks * WEEK_MS);

const body = {
  time_range: { start: start.toISOString(), end: end.toISOString(), resolution: { minutes: 7 * 24 * 60 } },
  // Grouping by project_id is what makes Modrinth fill in source_project on each row.
  return_metrics: { project_downloads: { bucket_by: ["project_id"] } },
  project_ids: [project.id],
};
const analytics = await request("/v3/analytics", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify(body),
});

const series = analytics.metrics.map((slice, i) => ({
  start: new Date(start.getTime() + i * WEEK_MS).toISOString().slice(0, 10),
  downloads: slice
    .filter((row) => row.metric_kind === "downloads" && row.source_project === project.id)
    .reduce((sum, row) => sum + (row.downloads ?? 0), 0),
}));

const output = {
  project: PROJECT,
  project_id: project.id,
  bucket: "week",
  through: end.toISOString().slice(0, 10),
  weeks: series,
};

// Skip the write when nothing changed so the scheduled job doesn't commit noise.
let previous = null;
try { previous = await readFile(outPath, "utf8"); } catch {}
const next = JSON.stringify(output, null, 2) + "\n";
if (previous === next) {
  console.log(`No change: ${series.length} weeks through ${output.through}.`);
} else {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, next);
  const total = series.reduce((s, w) => s + w.downloads, 0);
  console.log(`Wrote ${series.length} weeks through ${output.through} (${total.toLocaleString("en-US")} downloads in range) to ${outPath}.`);
}
