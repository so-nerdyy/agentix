export type ScheduleKind = "interval" | "once" | "cron";

export interface ParsedSchedule {
  schedule: string;
  scheduleKind: ScheduleKind;
  scheduleDisplay: string;
  intervalMs: number;
  runAt?: number;
  nextRunAt: number | null;
}

const DURATION_RE = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i;
const FIVE_FIELD_CRON_RE = /^([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)$/;
const MAX_CRON_LOOKAHEAD_MS = 5 * 366 * 24 * 60 * 60 * 1000;

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCron {
  minutes: CronField;
  hours: CronField;
  daysOfMonth: CronField;
  months: CronField;
  daysOfWeek: CronField;
}

export function parseScheduleInput(
  input: { schedule?: string; intervalMs?: number },
  now = Date.now(),
): ParsedSchedule {
  const scheduleText = String(input.schedule ?? "").trim();
  if (!scheduleText) {
    const intervalMs = Math.max(1_000, Number(input.intervalMs ?? 60_000));
    return {
      schedule: `every ${formatDuration(intervalMs)}`,
      scheduleKind: "interval",
      scheduleDisplay: `every ${formatDuration(intervalMs)}`,
      intervalMs,
      nextRunAt: now + intervalMs,
    };
  }

  const lower = scheduleText.toLowerCase();
  if (lower.startsWith("every ")) {
    const intervalMs = parseDurationMs(scheduleText.slice(6).trim());
    return {
      schedule: scheduleText,
      scheduleKind: "interval",
      scheduleDisplay: `every ${formatDuration(intervalMs)}`,
      intervalMs,
      nextRunAt: now + intervalMs,
    };
  }

  if (FIVE_FIELD_CRON_RE.test(scheduleText)) {
    parseCronExpression(scheduleText);
    return {
      schedule: scheduleText,
      scheduleKind: "cron",
      scheduleDisplay: scheduleText,
      intervalMs: 60_000,
      nextRunAt: nextCronRun(scheduleText, now),
    };
  }

  const runAt = parseRunAt(scheduleText, now);
  return {
    schedule: scheduleText,
    scheduleKind: "once",
    scheduleDisplay: `once at ${new Date(runAt).toISOString()}`,
    intervalMs: Math.max(1_000, runAt - now),
    runAt,
    nextRunAt: runAt,
  };
}

export function computeNextRun(input: {
  schedule: string;
  scheduleKind: ScheduleKind;
  intervalMs: number;
  runAt?: number;
  lastRunAt?: number;
  now?: number;
}): number | null {
  const now = input.now ?? Date.now();
  if (input.scheduleKind === "once") {
    if (input.lastRunAt) return null;
    return input.runAt ?? now;
  }
  if (input.scheduleKind === "cron") {
    return nextCronRun(input.schedule, input.lastRunAt ?? now);
  }
  return (input.lastRunAt ?? now) + Math.max(1_000, input.intervalMs);
}

export function scheduleSummary(input: {
  schedule?: string;
  scheduleDisplay?: string;
  intervalMs?: number;
}): string {
  if (input.scheduleDisplay) return input.scheduleDisplay;
  if (input.schedule) return input.schedule;
  return `every ${formatDuration(Math.max(1_000, Number(input.intervalMs ?? 60_000)))}`;
}

function parseRunAt(scheduleText: string, now: number): number {
  const durationMs = tryParseDurationMs(scheduleText);
  if (durationMs !== null) return now + durationMs;

  const timestamp = Date.parse(scheduleText);
  if (Number.isFinite(timestamp)) return timestamp;

  throw new Error(
    `invalid schedule "${scheduleText}". Use "30m", "every 2h", "0 9 * * *", or an ISO timestamp.`,
  );
}

function parseDurationMs(value: string): number {
  const parsed = tryParseDurationMs(value);
  if (parsed === null) {
    throw new Error(`invalid duration "${value}". Use 30s, 30m, 2h, or 1d.`);
  }
  return parsed;
}

function tryParseDurationMs(value: string): number | null {
  const match = value.trim().match(DURATION_RE);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase()[0];
  const multiplier = unit === "s"
    ? 1_000
    : unit === "m"
      ? 60_000
      : unit === "h"
        ? 3_600_000
        : 86_400_000;
  return Math.max(1_000, amount * multiplier);
}

function formatDuration(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.ceil(ms / 1_000)}s`;
}

function nextCronRun(expression: string, afterMs: number): number {
  const cron = parseCronExpression(expression);
  const candidate = new Date(afterMs + 60_000);
  candidate.setSeconds(0, 0);
  const deadline = afterMs + MAX_CRON_LOOKAHEAD_MS;

  while (candidate.getTime() <= deadline) {
    if (matchesCron(cron, candidate)) return candidate.getTime();
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`cron expression "${expression}" has no next run within five years`);
}

function parseCronExpression(expression: string): ParsedCron {
  const match = expression.trim().match(FIVE_FIELD_CRON_RE);
  if (!match) {
    throw new Error(`invalid cron expression "${expression}". Expected five fields.`);
  }
  const [, minute, hour, dayOfMonth, month, dayOfWeek] = match;
  return {
    minutes: parseCronField(minute ?? "*", 0, 59),
    hours: parseCronField(hour ?? "*", 0, 23),
    daysOfMonth: parseCronField(dayOfMonth ?? "*", 1, 31),
    months: parseCronField(month ?? "*", 1, 12),
    daysOfWeek: parseCronField(dayOfWeek ?? "*", 0, 7, (value) => value === 7 ? 0 : value),
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): CronField {
  const values = new Set<number>();
  const wildcard = field === "*";

  for (const part of field.split(",")) {
    const [rangeText, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid cron step "${part}"`);
    }

    let start: number;
    let end: number;
    if (!rangeText || rangeText === "*") {
      start = min;
      end = max;
    } else if (rangeText.includes("-")) {
      const [rawStart, rawEnd] = rangeText.split("-");
      start = Number(rawStart);
      end = Number(rawEnd);
    } else {
      start = Number(rangeText);
      end = start;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`invalid cron field "${field}"`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(normalize(value));
    }
  }

  return { values, wildcard };
}

function matchesCron(cron: ParsedCron, date: Date): boolean {
  if (!cron.minutes.values.has(date.getMinutes())) return false;
  if (!cron.hours.values.has(date.getHours())) return false;
  if (!cron.months.values.has(date.getMonth() + 1)) return false;

  const dayOfMonthMatches = cron.daysOfMonth.values.has(date.getDate());
  const dayOfWeekMatches = cron.daysOfWeek.values.has(date.getDay());
  if (!cron.daysOfMonth.wildcard && !cron.daysOfWeek.wildcard) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  return dayOfMonthMatches && dayOfWeekMatches;
}
