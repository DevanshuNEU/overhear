"use client";

// A link into a finding that sits in a closed row should show the finding. Chrome opens the row on its
// own, and only when the address changes; this does it in every browser and when the same link is
// clicked again after the row was closed. It renders nothing.
import { useEffect } from "react";

function openTarget(id: string) {
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

/** The id an address or link points at. A malformed escape names nothing rather than throwing. */
function idOf(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

export function OpenTarget() {
  useEffect(() => {
    const fromAddress = () => openTarget(idOf(window.location.hash));
    const fromClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
      if (link) openTarget(idOf(link.getAttribute("href") ?? ""));
    };
    fromAddress();
    window.addEventListener("hashchange", fromAddress);
    document.addEventListener("click", fromClick);
    return () => {
      window.removeEventListener("hashchange", fromAddress);
      document.removeEventListener("click", fromClick);
    };
  }, []);
  return null;
}
