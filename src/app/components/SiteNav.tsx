// Shared header nav across all pages. The GitHub link is external, so it opens
// in a new tab with rel="noreferrer".
import Link from "next/link";

export function SiteNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
        <Link
          href="/"
          className="bg-gradient-to-r from-signal-amber to-signal-red bg-clip-text text-lg font-semibold tracking-tight text-transparent"
        >
          Overhear
        </Link>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link href="/how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="/eval" className="transition-colors hover:text-foreground">
            Judge accuracy
          </Link>
          <a
            href="https://github.com/DevanshuNEU/retell"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}
