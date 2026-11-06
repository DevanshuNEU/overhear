"use client";

// A link into a finding that sits in a closed row should show the finding. Chrome opens the row on its
// own; this does it for every browser. It renders nothing.
import { useEffect } from "react";

function openTarget() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  let opened = false;
  for (let el = target.closest("details"); el; el = el.parentElement?.closest("details") ?? null) {
    if (!el.open) {
      el.open = true;
      opened = true;
    }
  }
  // jsdom has no scrollIntoView, so the call is optional.
  if (opened) target.scrollIntoView?.();
}

export function OpenTarget() {
  useEffect(() => {
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);
  return null;
}
