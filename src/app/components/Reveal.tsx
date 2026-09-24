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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(true);
      return;
    }
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
