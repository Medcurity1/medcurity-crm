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
