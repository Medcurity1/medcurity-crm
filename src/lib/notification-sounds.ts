// Notification sound engine — VERBATIM port of the Nexus synthesis code
// (Nexus public/index.html:11340-11506; captured in
// PULSE-GAME-PLAN/meddy-port/09-supplements.md §8). No audio files exist
// anywhere: the chime WAV is generated programmatically at load and the
// sound-type variety comes from WebAudio oscillators.
//
// Dual-engine design (the combination that finally worked in Nexus):
//   Primary:  HTML5 Audio element — reliable in background tabs after the
//             first user interaction.
//   Fallback: AudioContext oscillators — richer per-type sounds, may not
//             run in background tabs (the Audio element covers those).

import { canonicalSound, DEFAULT_SOUND } from "./notification-sound-choice";

// ── Background-tab fallback WAV (22050Hz mono 16-bit) ────────────────
// Generated at load; there are no audio files in the repo. A backgrounded
// tab suspends the AudioContext, so the oscillator recipes can't run and
// this single sound stands in for whichever one the user chose.
// 2026-08-18: was the old two-tone 880→1100 Hz chime; rebuilt as a warm
// F4+C5 pair with a soft attack so a notification that arrives while
// you're in another tab belongs to the same family as the new sounds.
const _notifWavB64 = (function () {
  const sr = 22050,
    dur = 1.0,
    samples = Math.floor(sr * dur);
  const buf = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sr;
    // Two notes a fifth apart, the second entering slightly later, each
    // with a quiet octave partial — the shape the new sounds share.
    const attack = Math.min(1, t / 0.045); // ~45ms fade-in, no click
    const decay = Math.exp(-t * 3.1);
    const lower = Math.sin(2 * Math.PI * 349.2 * t) + 0.18 * Math.sin(2 * Math.PI * 698.4 * t);
    const upperOn = t >= 0.03 ? Math.min(1, (t - 0.03) / 0.05) : 0;
    const upper = upperOn * Math.sin(2 * Math.PI * 523.3 * t);
    const val = (lower * 0.26 + upper * 0.18) * attack * decay;
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, val * 32767)), true);
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(bin);
})();

const notifAudio = new Audio(_notifWavB64);
notifAudio.volume = 0.5;
notifAudio.preload = "auto";
let _audioUnlocked = false;

// Unlock audio on first user interaction so notification sounds work.
function _unlockAudio() {
  if (_audioUnlocked) return;
  const prev = notifAudio.volume;
  notifAudio.volume = 0;
  notifAudio
    .play()
    .then(() => {
      notifAudio.pause();
      notifAudio.currentTime = 0;
      notifAudio.volume = prev || 0.5;
      _audioUnlocked = true;
    })
    .catch(() => {
      notifAudio.volume = prev || 0.5;
    });
}
document.addEventListener("click", _unlockAudio, { once: false });
document.addEventListener("keydown", _unlockAudio, { once: false });
document.addEventListener("touchstart", _unlockAudio, { once: false });

function _playNotifAudio(): Promise<boolean> {
  try {
    const sound = notifAudio.cloneNode() as HTMLAudioElement;
    sound.volume = 0.5;
    return sound.play().then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

// Sound queue for background-tab failures, drained when visible again.
type QueuedSound = { soundType: string; durationType: string };
let _soundQueue: QueuedSound[] = [];
export function drainSoundQueue() {
  const queued = _soundQueue.splice(0, _soundQueue.length);
  for (const item of queued) {
    playScheduled(item.soundType, item.durationType);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && _soundQueue.length > 0) drainSoundQueue();
});

// ── AudioContext layer ────────────────────────────────────────────────
type AnyWindow = Window & { webkitAudioContext?: typeof AudioContext };
let sharedAudioCtx: AudioContext | null = null;
let activeOscillators: OscillatorNode[] = [];
let activeSoundTimer: ReturnType<typeof setTimeout> | null = null;
let soundPlayingCallback: (() => void) | null = null;
document.addEventListener("click", function initAudioCtx() {
  getAudioCtx();
  document.removeEventListener("click", initAudioCtx);
});

function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    const Ctor = window.AudioContext || (window as AnyWindow).webkitAudioContext!;
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  return sharedAudioCtx;
}

export function stopActiveSound() {
  if (activeSoundTimer) {
    clearTimeout(activeSoundTimer);
    activeSoundTimer = null;
  }
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
  });
  activeOscillators = [];
  if (soundPlayingCallback) {
    soundPlayingCallback();
    soundPlayingCallback = null;
  }
}

/** Peak-level cap for one voice. The recipes below stack a fundamental
 * with two or three quiet partials; without this a dense chord could
 * clip on a laptop speaker. */
const MAX_VOICE_GAIN = 0.4;

function playSoundOnce(ctx: AudioContext, soundType: string, offsetTime?: number) {
  const t = offsetTime || ctx.currentTime;

  /** One voice. Unlike the old `tone()` this fades in over `attack`
   * rather than snapping to full volume, optionally runs through a
   * lowpass, and can stack inharmonic partials — the three things that
   * make a sound read as "struck instrument" instead of "beep".
   * (2026-08-18: replaces the seven bare-oscillator recipes.) */
  function voice(
    start: number,
    freq: number,
    dur: number,
    vol: number,
    opts?: {
      wave?: OscillatorType;
      attack?: number;
      lowpass?: number;
      /** [frequency ratio, gain as a fraction of `vol`, decay seconds] */
      partials?: Array<[number, number, number]>;
    },
  ) {
    const o = opts || {};
    const attack = o.attack || 0;
    const emit = (f: number, d: number, v: number) => {
      const peak = Math.min(Math.max(v, 0.0005), MAX_VOICE_GAIN);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      if (o.lowpass) {
        const filt = ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.setValueAtTime(o.lowpass, start);
        gain.connect(filt);
        filt.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }
      osc.type = o.wave || "sine";
      osc.frequency.setValueAtTime(f, start);
      if (attack > 0.002) {
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + attack);
      } else {
        gain.gain.setValueAtTime(peak, start);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + d);
      osc.start(start);
      osc.stop(start + attack + d + 0.05);
      activeOscillators.push(osc);
    };
    emit(freq, dur, vol);
    (o.partials || []).forEach(([ratio, gainFrac, pDur]) => {
      emit(freq * ratio, pDur, vol * gainFrac * 4);
    });
  }

  switch (canonicalSound(soundType)) {
    // ── Lantern — task reminders (was Marimba) ──────────────────────
    // Four notes of an open chord rolled out one at a time.
    case "lantern":
      voice(t, 349.2, 0.9, 0.17, { wave: "triangle", attack: 0.02, partials: [[2, 0.05, 0.6]] });
      voice(t + 0.13, 440, 0.9, 0.14, { wave: "triangle", attack: 0.02, partials: [[2, 0.04, 0.6]] });
      voice(t + 0.26, 523.3, 0.9, 0.12, { wave: "triangle", attack: 0.02, partials: [[2, 0.04, 0.6]] });
      voice(t + 0.39, 659.3, 1.1, 0.11, { wave: "triangle", attack: 0.02, partials: [[2, 0.03, 0.6]] });
      break;

    // ── Bloom — new website chat (was Bubble) ───────────────────────
    // A chord that opens one note at a time, then holds.
    case "bloom":
      voice(t, 392, 1.2, 0.15, { attack: 0.05, lowpass: 2000, partials: [[2, 0.05, 0.8]] });
      voice(t + 0.14, 523.3, 1.1, 0.13, { attack: 0.05, lowpass: 2200, partials: [[2, 0.04, 0.7]] });
      voice(t + 0.28, 659.3, 1.0, 0.12, { attack: 0.05, lowpass: 2400, partials: [[2, 0.04, 0.6]] });
      break;

    // ── Quill — records assigned / contact form (was Drop) ──────────
    // Two soft notes stepping down. Asks rather than demands.
    case "quill":
      voice(t, 880, 0.42, 0.15, { attack: 0.02, lowpass: 2600, partials: [[2, 0.05, 0.3]] });
      voice(t + 0.2, 659.3, 0.62, 0.14, { attack: 0.02, lowpass: 2400, partials: [[2, 0.04, 0.4]] });
      break;

    // ── Felt — renewal reminders / task handoffs (was Horn) ─────────
    // A muffled piano chord with the soft pedal down.
    case "felt":
      voice(t, 349.2, 1.3, 0.19, { attack: 0.045, lowpass: 1500, partials: [[2, 0.07, 0.9], [3, 0.03, 0.6]] });
      voice(t + 0.03, 523.3, 1.2, 0.13, { attack: 0.05, lowpass: 1600, partials: [[2, 0.05, 0.8]] });
      break;

    // ── Beacon — someone needs a human (was Doorbell) ───────────────
    // Two firm notes, twice over. The one alert that must carry.
    case "beacon":
      voice(t, 659.3, 0.2, 0.22, { wave: "triangle", attack: 0.008, partials: [[2, 0.06, 0.15]] });
      voice(t + 0.14, 987.8, 0.28, 0.2, { wave: "triangle", attack: 0.008, partials: [[2, 0.05, 0.2]] });
      voice(t + 0.46, 659.3, 0.2, 0.2, { wave: "triangle", attack: 0.008, partials: [[2, 0.06, 0.15]] });
      voice(t + 0.6, 987.8, 0.4, 0.19, { wave: "triangle", attack: 0.008, partials: [[2, 0.05, 0.25]] });
      break;

    // ── Music Box — buying intent / high fives (was Glass) ──────────
    // Three high notes with a wind-up sparkle, with body under them.
    case "musicbox":
      voice(t, 1046.5, 0.55, 0.14, { attack: 0.003, partials: [[2.9, 0.05, 0.35], [5.2, 0.02, 0.2]] });
      voice(t + 0.15, 1318.5, 0.55, 0.13, { attack: 0.003, partials: [[2.9, 0.04, 0.35]] });
      voice(t + 0.3, 1568, 0.85, 0.12, { attack: 0.003, partials: [[2.9, 0.04, 0.45]] });
      break;

    // Unreachable in practice — canonicalSound() maps every legacy and
    // unknown name onto one of the six above. Kept so a future sound id
    // added in one place and forgotten in another still makes a noise.
    default:
      voice(t, 523.3, 0.9, 0.16, { attack: 0.03, lowpass: 2000, partials: [[2, 0.05, 0.6]] });
      break;
  }
}

/** Gap between repeats when a notification is set to Medium / Long /
 * Persistent. Each value leaves a beat of silence after the sound's own
 * tail so a repeat never overlaps the one before it. */
function getSoundCycleMs(st: string): number {
  return (
    (
      {
        felt: 1700,
        quill: 1300,
        lantern: 1900,
        musicbox: 1600,
        bloom: 1800,
        beacon: 1400,
      } as Record<string, number>
    )[canonicalSound(st)] || 1500
  );
}

function getSoundDurationMs(dt: string): number {
  return ({ medium: 5000, long: 15000, persistent: 30000 } as Record<string, number>)[dt] || 0;
}

export function playScheduled(soundType: string, durationType: string, onFinish?: () => void) {
  // Departure from Nexus (Nathan, 2026-06-12): the fixed WAV chime no
  // longer layers UNDER every chosen sound in the foreground — it made
  // all sound types feel samey. The oscillator plays clean when the
  // AudioContext is running; the WAV chime is the background-tab
  // fallback only (where oscillators can't run).
  stopActiveSound();
  try {
    const ctx = getAudioCtx();
    if (ctx.state !== "suspended") {
      playSoundOnce(ctx, soundType);
      const totalMs = getSoundDurationMs(durationType);
      if (totalMs > 0) {
        const cycleMs = getSoundCycleMs(soundType);
        const now = ctx.currentTime;
        for (let elapsed = cycleMs; elapsed < totalMs; elapsed += cycleMs) {
          playSoundOnce(ctx, soundType, now + elapsed / 1000);
        }
        if (onFinish) soundPlayingCallback = onFinish;
        activeSoundTimer = setTimeout(() => {
          activeSoundTimer = null;
          activeOscillators = [];
          if (soundPlayingCallback) {
            soundPlayingCallback();
            soundPlayingCallback = null;
          }
        }, totalMs + 500);
      } else {
        const finishMs = getSoundCycleMs(soundType) + 200;
        if (onFinish) soundPlayingCallback = onFinish;
        activeSoundTimer = setTimeout(() => {
          activeSoundTimer = null;
          activeOscillators = [];
          if (soundPlayingCallback) {
            soundPlayingCallback();
            soundPlayingCallback = null;
          }
        }, finishMs);
      }
    } else {
      // AudioContext suspended (background tab): fall back to the WAV
      // chime via HTML5 Audio, queueing if even that can't play yet.
      void _playNotifAudio().then((audioPlayed) => {
        if (!audioPlayed && document.hidden) {
          _soundQueue.push({ soundType, durationType });
        }
      });
      const totalMs = getSoundDurationMs(durationType);
      if (totalMs > 0) {
        const cycleMs = getSoundCycleMs(soundType);
        for (let elapsed = cycleMs; elapsed < totalMs; elapsed += cycleMs) {
          setTimeout(() => { void _playNotifAudio(); }, elapsed);
        }
      }
      if (onFinish) setTimeout(() => onFinish(), Math.max(totalMs, 500));
    }
  } catch {
    // audio unavailable — silent no-op
  }
}

export function playNotifSoundByType(type?: string) {
  playScheduled(type || DEFAULT_SOUND, "short");
}
export function previewSound(soundType?: string, durationType?: string, onFinish?: () => void) {
  playScheduled(soundType || DEFAULT_SOUND, durationType || "short", onFinish);
}

// ── Which sound plays for which notification ──────────────────────────
// The decision layer lives in notification-sound-choice.ts (no browser
// APIs, unit-tested). Re-exported here so every existing import of
// "@/lib/notification-sounds" keeps working unchanged.
export {
  KEPT_SOUNDS,
  DEFAULT_SOUND,
  SOUND_ALIASES,
  canonicalSound,
  NOTIF_TYPE_FALLBACK_SOUNDS,
  durationTypeFromSeconds,
  resolveNotifSound,
} from "./notification-sound-choice";
