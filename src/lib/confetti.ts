import confetti from "canvas-confetti";

/**
 * Closed Won celebration. Fired wherever a deal's stage transitions to
 * closed_won (pipeline drag, detail-page stage bar, edit form). Two side
 * cannons plus a center burst, ~1.2s total. Purely cosmetic — never let
 * this affect the mutation flow.
 */
export function celebrateClosedWon() {
  const colors = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ffffff"];

  // Center burst
  confetti({
    particleCount: 120,
    spread: 75,
    startVelocity: 40,
    origin: { x: 0.5, y: 0.6 },
    colors,
    zIndex: 9999,
    disableForReducedMotion: true,
  });

  // Side cannons, slightly staggered
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 60,
      spread: 55,
      startVelocity: 55,
      origin: { x: 0, y: 0.8 },
      colors,
      zIndex: 9999,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 60,
      angle: 120,
      spread: 55,
      startVelocity: 55,
      origin: { x: 1, y: 0.8 },
      colors,
      zIndex: 9999,
      disableForReducedMotion: true,
    });
  }, 200);
}

/**
 * High-five celebration — confetti RAINS DOWN from the top across the whole
 * width (~1s), deliberately different from the Closed Won cannons. Fired for
 * the RECEIVER anywhere in the app when a teammate high-fives their win.
 */
export function celebrateHighFive() {
  const colors = ["#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#ffffff"];
  const end = Date.now() + 900;
  (function rain() {
    confetti({
      particleCount: 5,
      startVelocity: 0,
      gravity: 0.7,
      ticks: 200,
      spread: 100,
      scalar: 0.9,
      origin: { x: Math.random(), y: -0.1 },
      colors,
      zIndex: 9999,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(rain);
  })();
}
