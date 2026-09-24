"use client";

// Counts from 0 up to `value` on mount. Renders the final value on first paint
// (so SSR and no-JS show the real number, never a stuck 0), then animates only
// if the client allows motion.
import { useEffect, useState } from "react";

export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    setDisplay(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className}>
      {display}
      {suffix}
    </span>
  );
}
