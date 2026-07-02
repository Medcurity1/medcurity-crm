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

// ── Base64 chime WAV (two-tone 880→1100 Hz, 0.5s, 22050Hz mono 16-bit) ─
const _notifWavB64 = (function () {
  const sr = 22050,
    dur = 0.5,
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
    const freq = t < 0.25 ? 880 : 1100;
    const env = Math.min(1, (dur - t) * 8) * Math.min(1, t * 40) * 0.4;
    const val = Math.sin(2 * Math.PI * freq * t) * env;
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
  notifAudio
    .play()
    .then(() => {
      notifAudio.pause();
      notifAudio.currentTime = 0;
      _audioUnlocked = true;
    })
    .catch(() => {});
}
document.addEventListener("click", _unlockAudio, { once: false });
document.addEventListener("keydown", _unlockAudio, { once: false });
document.addEventListener("touchstart", _unlockAudio, { once: false });

function _playNotifAudio(): boolean {
  try {
    const sound = notifAudio.cloneNode() as HTMLAudioElement;
    sound.volume = 0.5;
    sound.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Sound queue for background-tab failures, drained when visible again.
type QueuedSound = { soundType: string; durationType: string };
let _soundQueue: QueuedSound[] = [];
export function drainSoundQueue() {
  while (_soundQueue.length > 0) {
    _soundQueue.shift();
    _playNotifAudio();
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

function playSoundOnce(ctx: AudioContext, soundType: string, offsetTime?: number) {
  const t = offsetTime || ctx.currentTime;
  function tone(start: number, freq: number, dur: number, vol?: number, type?: OscillatorType) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol || 0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start);
    osc.stop(start + dur + 0.05);
    activeOscillators.push(osc);
  }
  if (soundType === "bell") {
    tone(t, 1200, 0.4, 0.25, "sine");
    tone(t + 0.5, 1200, 0.4, 0.25, "sine");
    tone(t + 1.0, 1200, 0.4, 0.25, "sine");
  } else if (soundType === "urgent") {
    tone(t, 1400, 0.15, 0.35, "square");
    tone(t + 0.2, 1400, 0.15, 0.35, "square");
    tone(t + 0.4, 1400, 0.15, 0.35, "square");
  } else if (soundType === "soft") {
    tone(t, 440, 0.8, 0.15, "sine");
  } else if (soundType === "melody") {
    tone(t, 523, 0.18, 0.3, "sine");
    tone(t + 0.22, 659, 0.18, 0.3, "sine");
    tone(t + 0.44, 784, 0.18, 0.3, "sine");
    tone(t + 0.66, 1047, 0.3, 0.3, "sine");
  } else if (soundType === "pulse") {
    tone(t, 600, 0.15, 0.25, "sine");
    tone(t + 0.25, 600, 0.15, 0.25, "sine");
  } else if (soundType === "ringbell") {
    tone(t, 800, 1.2, 0.3, "sine");
    tone(t, 1600, 0.8, 0.1, "sine");
    // ── 2026-06-12 candidates (Nathan auditioning a new top 5) ────────
  } else if (soundType === "bubble") {
    // quick rising blip, playful
    tone(t, 520, 0.08, 0.25, "sine");
    tone(t + 0.07, 780, 0.1, 0.28, "sine");
    tone(t + 0.16, 1040, 0.16, 0.22, "sine");
  } else if (soundType === "marimba") {
    // two warm wooden notes
    tone(t, 440, 0.25, 0.32, "triangle");
    tone(t + 0.18, 660, 0.35, 0.26, "triangle");
  } else if (soundType === "ding") {
    // single clean strike with a shimmering overtone
    tone(t, 1000, 0.7, 0.28, "sine");
    tone(t, 2000, 0.35, 0.08, "sine");
  } else if (soundType === "doorbell") {
    // classic ding-dong
    tone(t, 880, 0.45, 0.3, "sine");
    tone(t + 0.4, 660, 0.6, 0.28, "sine");
  } else if (soundType === "glass") {
    // high glassy shimmer
    tone(t, 1480, 0.5, 0.18, "sine");
    tone(t, 2220, 0.4, 0.08, "sine");
    tone(t + 0.06, 1976, 0.45, 0.1, "sine");
  } else if (soundType === "drop") {
    // gentle descending water drop
    tone(t, 880, 0.12, 0.25, "sine");
    tone(t + 0.12, 660, 0.12, 0.25, "sine");
    tone(t + 0.24, 440, 0.25, 0.25, "sine");
  } else if (soundType === "knock") {
    // two low knocks, subtle and unintrusive
    tone(t, 180, 0.09, 0.42, "triangle");
    tone(t + 0.16, 180, 0.09, 0.42, "triangle");
  } else if (soundType === "twinkle") {
    // fast sparkly up-arpeggio
    tone(t, 1319, 0.12, 0.2, "sine");
    tone(t + 0.09, 1568, 0.12, 0.2, "sine");
    tone(t + 0.18, 1976, 0.2, 0.2, "sine");
  } else if (soundType === "horn") {
    // soft two-note swell, calm and full
    tone(t, 523, 0.5, 0.18, "triangle");
    tone(t, 784, 0.5, 0.14, "triangle");
  } else if (soundType === "echo") {
    // one ping and its quieter echo
    tone(t, 990, 0.25, 0.3, "sine");
    tone(t + 0.35, 990, 0.25, 0.12, "sine");
  } else {
    // chime default
    tone(t, 880, 0.6, 0.3, "sine");
    tone(t + 0.7, 1100, 0.6, 0.3, "sine");
  }
}

function getSoundCycleMs(st: string): number {
  return (
    (
      {
        bell: 1500,
        urgent: 700,
        soft: 1200,
        melody: 1200,
        pulse: 600,
        ringbell: 1500,
        bubble: 900,
        marimba: 1300,
        ding: 1200,
        doorbell: 1600,
        glass: 1100,
        drop: 1000,
        knock: 800,
        twinkle: 900,
        horn: 1200,
        echo: 1300,
      } as Record<string, number>
    )[st] || 1500
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
      const audioPlayed = _playNotifAudio();
      if (!audioPlayed && document.hidden) {
        _soundQueue.push({ soundType, durationType });
      }
      const totalMs = getSoundDurationMs(durationType);
      if (totalMs > 0) {
        const cycleMs = getSoundCycleMs(soundType);
        for (let elapsed = cycleMs; elapsed < totalMs; elapsed += cycleMs) {
          setTimeout(() => _playNotifAudio(), elapsed);
        }
      }
      if (onFinish) setTimeout(() => onFinish(), Math.max(totalMs, 500));
    }
  } catch {
    // audio unavailable — silent no-op
  }
}

export function playNotifSoundByType(type?: string) {
  playScheduled(type || "chime", "short");
}
export function previewSound(soundType?: string, durationType?: string, onFinish?: () => void) {
  stopActiveSound();
  playScheduled(soundType || "chime", durationType || "short", onFinish);
}

/** Runtime fallback sound per type when the user never chose one
 * (Nexus MEDDY_NOTIF_SOUNDS, index.html:11309-11317). */
export const NOTIF_TYPE_FALLBACK_SOUNDS: Record<string, string> = {
  meddy_new_chat: "bubble",
  meddy_human_requested: "doorbell",
  meddy_buying_intent: "glass",
  meddy_missed_chat: "knock",
  meddy_contact_received: "drop",
  task_due: "marimba",
  renewal_upcoming: "horn",
  // Platform (Meddy Support) escalations — same doorbell urgency as website.
  support_human_requested: "doorbell",
  support_new_chat: "bubble",
  // A teammate high-fived your closed deal — happy little clink.
  deal_high_five: "glass",
};

/** Saved seconds value → repeat-duration bucket (Nexus index.html:12239). */
export function durationTypeFromSeconds(durVal: number): string {
  return durVal >= 30 ? "persistent" : durVal >= 10 ? "long" : durVal >= 5 ? "medium" : "short";
}

/** The audition keepers (2026-06-12). Saved prefs pointing at retired
 * sounds resolve to the per-type fallback so the engine plays the same
 * thing the settings picker displays. */
export const KEPT_SOUNDS = new Set([
  "bubble",
  "marimba",
  "doorbell",
  "glass",
  "drop",
  "knock",
  "horn",
]);

export function resolveNotifSound(typeKey: string, savedSound: string | undefined): string {
  if (savedSound && KEPT_SOUNDS.has(savedSound)) return savedSound;
  return NOTIF_TYPE_FALLBACK_SOUNDS[typeKey] || "marimba";
}
