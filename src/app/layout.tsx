import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import "./globals.css";

// Every font is self-hosted, so `next build` needs no network. Geist and Geist Mono come from the `geist` package
// (variables --font-geist-sans and --font-geist-mono). The display face is a committed file, the Latin subset Google
// Fonts serves for Bricolage Grotesque at weights 500 to 800, with its license next to it.

// Display face for headlines: constructed, with a voice, not the default UI sans.
const bricolage = localFont({
  src: "./fonts/bricolage-grotesque/BricolageGrotesque-Latin.woff2",
  variable: "--font-display",
  weight: "500 800",
});

export const metadata: Metadata = {
  title: "Overhear",
  description: "An AI QA analyst for voice agents: it scores every call and measures how accurate that scoring is.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
