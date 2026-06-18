/**
 * Lightweight confetti burst — reuses the global `confetti-pop` keyframe defined
 * in src/index.css. Shared so every "win" moment (lesson done, homework done,
 * payment received, day closed) celebrates the same way.
 */
export function burstConfetti(opts?: { count?: number; originY?: number }): void {
  if (typeof document === "undefined") return;
  const colors = ["#2BBFAA", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7"];
  const count = opts?.count ?? 18;
  const top = `${opts?.originY ?? 45}%`;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    const dx = (Math.random() - 0.5) * 220;
    const dy = -(80 + Math.random() * 120);
    const rot = Math.random() * 540;
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      `top:${top}`,
      "width:8px",
      "height:8px",
      "border-radius:2px",
      `background:${colors[i % colors.length]}`,
      "z-index:9999",
      "pointer-events:none",
      `--dx:${dx}px`,
      `--dy:${dy}px`,
      `--rot:${rot}deg`,
      `animation:confetti-pop ${0.7 + Math.random() * 0.4}s ease-out forwards`,
      `animation-delay:${i * 25}ms`,
    ].join(";");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}
