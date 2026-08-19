/**
 * Bookkeeping for the background-tab HTMLAudio fallback.
 * Oscillators are cancelled via stopActiveSound(); cloned WAV elements and
 * their repeat timeouts were previously fire-and-forget, so a newer alert
 * could not stop a medium/long/persistent ringtone already in flight.
 */

export type TrackedClone = {
  pause: () => void;
  currentTime?: number;
};

export type QueuedSound = { soundType: string; durationType: string };

export function createHtmlAudioSession() {
  let generation = 0;
  const clones: TrackedClone[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const queue: QueuedSound[] = [];

  function stop() {
    generation += 1;
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
    queue.length = 0;
    for (const clone of clones) {
      try {
        clone.pause();
        if (typeof clone.currentTime === "number") clone.currentTime = 0;
      } catch {
        // already stopped
      }
    }
    clones.length = 0;
  }

  function beginPlay(): number {
    return generation;
  }

  function isCurrent(startedGeneration: number): boolean {
    return startedGeneration === generation;
  }

  /** Keep a live clone so stop() can pause it. Stale generations are paused immediately. */
  function adoptClone(clone: TrackedClone, startedGeneration: number): boolean {
    if (startedGeneration !== generation) {
      try {
        clone.pause();
        if (typeof clone.currentTime === "number") clone.currentTime = 0;
      } catch {
        // already stopped
      }
      return false;
    }
    clones.push(clone);
    return true;
  }

  function schedule(fn: () => void, ms: number): void {
    const startedGeneration = generation;
    const id = setTimeout(() => {
      if (startedGeneration !== generation) return;
      fn();
    }, ms);
    timers.push(id);
  }

  /** Autoplay-failed alerts wait here until the tab is visible again. */
  function enqueue(item: QueuedSound, startedGeneration: number): boolean {
    if (startedGeneration !== generation) return false;
    queue.push(item);
    return true;
  }

  function takeQueue(): QueuedSound[] {
    return queue.splice(0, queue.length);
  }

  function hasQueued(): boolean {
    return queue.length > 0;
  }

  function snapshot() {
    return { generation, clones: clones.length, timers: timers.length, queued: queue.length };
  }

  return { stop, beginPlay, isCurrent, adoptClone, schedule, enqueue, takeQueue, hasQueued, snapshot };
}

export type HtmlAudioSession = ReturnType<typeof createHtmlAudioSession>;
