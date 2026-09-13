// Minimal async job queue abstraction. In-process with retries.
// Swap with a durable queue (BullMQ/Redis) in production if needed.

import { logger } from "@/lib/logging/logger";

type Job = () => Promise<void>;

const queue: { job: Job; attempts: number; maxAttempts: number; label: string }[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      try {
        await item.job();
      } catch (err) {
        item.attempts += 1;
        logger.warn("background job failed", { label: item.label, attempts: item.attempts, err: String(err) });
        if (item.attempts < item.maxAttempts) {
          queue.push(item);
        } else {
          logger.error("background job exhausted", { label: item.label });
        }
      }
    }
  } finally {
    running = false;
  }
}

export function enqueue(label: string, job: Job, maxAttempts = 3) {
  queue.push({ job, attempts: 0, maxAttempts, label });
  void pump();
}
