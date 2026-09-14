// Rate limiter sliding-window di memori — pola yang sama dengan bot Thor:
// maksimum 5 kegagalan / 10 menit per user; keberhasilan me-reset hitungan.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, number[]>();

export function noteFailure(bucket: string): void {
  const now = Date.now();
  const list = (failures.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  failures.set(bucket, list);
}

export function noteSuccess(bucket: string): void {
  failures.delete(bucket);
}

export function isRateLimited(bucket: string): boolean {
  const now = Date.now();
  const list = (failures.get(bucket) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(bucket, list);
  return list.length >= MAX_FAILURES;
}

// Pembersihan periodik agar Map tidak tumbuh tanpa batas
if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, list] of failures) {
      const alive = list.filter((t) => now - t < WINDOW_MS);
      if (alive.length === 0) failures.delete(k);
      else failures.set(k, alive);
    }
  }, 60 * 1000);
  // Jangan menahan proses Node keluar
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
