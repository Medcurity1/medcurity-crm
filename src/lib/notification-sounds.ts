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
  } else {
    // chime default
    tone(t, 880, 0.6, 0.3, "sine");
    tone(t + 0.7, 1100, 0.6, 0.3, "sine");
  }
}

function getSoundCycleMs(st: string): number {
  return (
    ({ bell: 1500, urgent: 700, soft: 1200, melody: 1200, pulse: 600, ringbell: 1500 } as Record<
      string,
      number
    >)[st] || 1500
  );
}
function getSoundDurationMs(dt: string): number {
  return ({ medium: 5000, long: 15000, persistent: 30000 } as Record<string, number>)[dt] || 0;
}

export function playScheduled(soundType: string, durationType: string, onFinish?: () => void) {
  // Try HTML5 Audio first (works better in background tabs)
  const audioPlayed = _playNotifAudio();
  if (!audioPlayed && document.hidden) {
    _soundQueue.push({ soundType, durationType });
  }
  // Also try AudioContext for richer sound (supplements Audio)
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
          setTimeout(() => _playNotifAudio(), elapsed);
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
      // AudioContext suspended (background tab): HTML5 Audio repeats only
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
  meddy_new_chat: "chime",
  meddy_human_requested: "urgent",
  meddy_buying_intent: "melody",
  meddy_missed_chat: "bell",
  meddy_contact_received: "soft",
};

/** Saved seconds value → repeat-duration bucket (Nexus index.html:12239). */
export function durationTypeFromSeconds(durVal: number): string {
  return durVal >= 30 ? "persistent" : durVal >= 10 ? "long" : durVal >= 5 ? "medium" : "short";
}
