"use client";

// The first screen in local mode: paste a Retell API key, and see where it lives. One job, so one field and one
// button. The key is read from the field when the form is sent and goes straight to /api/connect. It is never in
// state, never in the URL (the field has no name, so even a form sent without this script sends nothing), and
// the field is emptied once Retell accepts it. Words that the server also says come from src/pull/labels.ts.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { CONNECT_MESSAGE, LOCAL_REFUSAL, type ConnectError } from "@/pull/labels";

export const CONNECT_WORDS = {
  product: "Overhear",
  headline: "Paste your Retell API key.",
  promise: "It stays on this computer and is sent only to Retell.",
  fieldLabel: "Retell API key",
  fieldHint: "Copy it from the API keys page in your Retell dashboard.",
  connect: "Connect Retell",
  checking: "Checking key",
  checkingStatus: "Checking your key with Retell.",
  badKeyNext: "Copy it again from the API keys page in your Retell dashboard and paste it here.",
  serverDown: "Couldn’t reach Overhear on this computer. Check that it is still running, then try again.",
  connectedHeadline: "Connected to Retell.",
  connectedPromise: "Your key is saved on this computer.",
  connectedNext: "Next, this page will list your latest calls and check each one.",
  factsLabel: "Where your key goes",
  savedIn: "Saved in",
  sentTo: "Sent to",
  sentToValue: "Retell only, to check the key and read your calls",
  remove: "Remove",
  removeValue: "Delete that file",
} as const;

const KNOWN_ERRORS = new Set<string>(Object.keys(CONNECT_MESSAGE));
const REFUSALS = new Set<string>(Object.values(LOCAL_REFUSAL));

type Failure = { tone: "critical" | "warning"; message: string; next?: string };

type Phase = { kind: "ready" } | { kind: "checking" } | { kind: "failed"; failure: Failure } | { kind: "connected" };

function failureFor(error: ConnectError, location: string): Failure {
  const message = CONNECT_MESSAGE[error];
  if (error === "bad_key") return { tone: "critical", message, next: CONNECT_WORDS.badKeyNext };
  if (error === "unreachable") return { tone: "warning", message };
  if (error === "store_failed") return { tone: "critical", message, next: `Check that you can write to ${location}, then try again.` };
  return { tone: "critical", message };
}

/** What the person sees for one answer from /api/connect. Only fixed words reach the screen, never the body. */
async function readAnswer(res: Response, location: string): Promise<{ connected: true } | { connected: false; failure: Failure }> {
  const text = await res.text().catch(() => "");
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null) {
      const { connected, error } = body as { connected?: unknown; error?: unknown };
      if (res.ok && connected === true) return { connected: true };
      if (typeof error === "string" && KNOWN_ERRORS.has(error)) return { connected: false, failure: failureFor(error as ConnectError, location) };
    }
  } catch {
    // Not JSON: the local check answers in plain text.
  }
  if (REFUSALS.has(text)) return { connected: false, failure: { tone: "critical", message: text } };
  return { connected: false, failure: { tone: "warning", message: CONNECT_WORDS.serverDown } };
}

function Facts({ location }: { location: string }) {
  const rows = [
    { label: CONNECT_WORDS.savedIn, value: location, mono: true },
    { label: CONNECT_WORDS.sentTo, value: CONNECT_WORDS.sentToValue, mono: false },
    { label: CONNECT_WORDS.remove, value: CONNECT_WORDS.removeValue, mono: false },
  ];
  return (
    <dl aria-label={CONNECT_WORDS.factsLabel} className="mt-12 grid gap-x-8 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-x-8 sm:col-span-2 sm:grid-cols-subgrid">
          <dt className="text-[13px] text-report-muted sm:pt-px">{row.label}</dt>
          <dd className={row.mono ? "break-all font-mono text-[13px] leading-6 tabular-nums" : "text-sm"}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Props = {
  /** A key is already saved on this computer. */
  stored: boolean;
  /** The saved key file's path, as shown to the person (home folder written as ~). */
  location: string;
  /** The key store refused to open, so the answer to "is a key saved" is a refusal, not yes or no. */
  storeError?: ConnectError;
};

export function ConnectScreen({ stored, location, storeError }: Props) {
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>(() => {
    if (stored) return { kind: "connected" };
    if (storeError) return { kind: "failed", failure: failureFor(storeError, location) };
    return { kind: "ready" };
  });
  const checking = phase.kind === "checking";
  const failure = phase.kind === "failed" ? phase.failure : null;

  // After a send, hand the person back to what changed: the field when it needs another try, the headline
  // when it worked. A change the person did not ask for (the first render) moves nothing.
  const sent = useRef(false);
  useEffect(() => {
    if (!sent.current) return;
    if (phase.kind === "failed") field.current?.focus();
    if (phase.kind === "connected") headline.current?.focus();
  }, [phase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking) return;
    const pasted = field.current?.value.trim() ?? "";
    sent.current = true;
    if (pasted === "") {
      setPhase({ kind: "failed", failure: failureFor("bad_request", location) });
      return;
    }
    setPhase({ kind: "checking" });
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: pasted }),
        cache: "no-store",
      });
      const answer = await readAnswer(res, location);
      if (answer.connected) {
        if (field.current) field.current.value = "";
        setPhase({ kind: "connected" });
        router.refresh();
      } else {
        setPhase({ kind: "failed", failure: answer.failure });
      }
    } catch {
      setPhase({ kind: "failed", failure: { tone: "warning", message: CONNECT_WORDS.serverDown } });
    }
  }

  const connected = phase.kind === "connected";
  const FailureIcon = failure?.tone === "warning" ? TriangleAlert : CircleAlert;

  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        <p className="mb-10 text-sm font-semibold tracking-[-0.01em] text-report-ink-2 sm:mb-14">{CONNECT_WORDS.product}</p>
        <main className="max-w-[640px]">
          <h1
            ref={headline}
            tabIndex={-1}
            className="font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] outline-none sm:text-[32px] sm:tracking-[-0.02em]"
          >
            {connected ? CONNECT_WORDS.connectedHeadline : CONNECT_WORDS.headline}{" "}
            <span className="text-report-muted">{connected ? CONNECT_WORDS.connectedPromise : CONNECT_WORDS.promise}</span>
          </h1>

          {connected ? (
            <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-report-ink-2">{CONNECT_WORDS.connectedNext}</p>
          ) : (
            <form method="post" onSubmit={submit} noValidate className="mt-10">
              <label htmlFor="retell-key" className="block text-sm font-semibold">
                {CONNECT_WORDS.fieldLabel}
              </label>
              <p id="retell-key-hint" className="mt-1 text-[13px] text-report-muted">
                {CONNECT_WORDS.fieldHint}
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  ref={field}
                  id="retell-key"
                  type="password"
                  readOnly={checking}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  aria-invalid={failure?.tone === "critical" ? true : undefined}
                  aria-describedby={failure ? "retell-key-hint retell-key-problem" : "retell-key-hint"}
                  className={`min-h-11 min-w-0 flex-1 rounded-md border bg-report-surface px-3 font-mono text-sm outline-none read-only:text-report-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent ${
                    failure?.tone === "critical" ? "border-report-critical" : "border-report-line-strong"
                  }`}
                />
                <button
                  type="submit"
                  disabled={checking}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-report-accent px-4 text-sm font-semibold text-white enabled:hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default"
                >
                  {checking ? (
                    <>
                      <span aria-hidden className="report-delayed inline-flex">
                        <Loader2 className="size-4 motion-safe:animate-spin" />
                      </span>
                      {CONNECT_WORDS.checking}
                    </>
                  ) : (
                    CONNECT_WORDS.connect
                  )}
                </button>
              </div>
              <div role="status" className="mt-3 min-h-6 text-sm">
                {checking ? <span className="text-report-ink-2">{CONNECT_WORDS.checkingStatus}</span> : null}
                {failure ? (
                  <p
                    id="retell-key-problem"
                    className={`flex gap-2 ${failure.tone === "critical" ? "text-report-critical" : "text-report-warning"}`}
                  >
                    <FailureIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <strong className="font-semibold">{failure.message}</strong>
                      {failure.next ? <> {failure.next}</> : null}
                    </span>
                  </p>
                ) : null}
              </div>
            </form>
          )}

          <Facts location={location} />
        </main>
      </div>
    </div>
  );
}
