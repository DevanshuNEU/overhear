// Shared header nav across all pages. The GitHub link is external, so it opens
// in a new tab with rel="noreferrer".
import Link from "next/link";

export function SiteNav() {
  return (
    <nav className="flex items-center justify-between border-b border-zinc-800/60 px-6 py-4">
      <Link
        href="/"
        className="bg-gradient-to-r from-signal-amber to-signal-red bg-clip-text text-lg font-semibold tracking-tight text-transparent"
      >
        Overhear
      </Link>
      <div className="flex items-center gap-5 text-sm text-zinc-400">
        <Link href="/how-it-works" className="transition-colors hover:text-zinc-100">
          How it works
        </Link>
        <Link href="/eval" className="transition-colors hover:text-zinc-100">
          Judge accuracy
        </Link>
        <a
          href="https://github.com/DevanshuNEU/retell"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-zinc-100"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
