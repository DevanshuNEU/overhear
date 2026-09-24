"use client";

// Fades and rises its children into view when scrolled to. Children are always
// rendered (SSR and no-JS show content); only the entrance animation class is
// added once the element intersects. Under reduced motion it is a no-op.
import { useEffect, useRef, useState } from "react";

export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    // Children are always rendered; `shown` only adds the entrance-animation
    // class. Under reduced motion (or with no IntersectionObserver) we skip the
    // animation entirely and leave content visible, without setting state
    // synchronously in the effect.
    if (reduce || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${shown ? "animate-reveal" : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}
