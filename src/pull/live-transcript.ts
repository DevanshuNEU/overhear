// The live transcript relay of a test call: what the person says and what the agent says, while the call is going, as
// Server-Sent Events for the test call screen.
//
// Why a relay: Retell's SDK (v3) no longer carries the transcript on the call's data channel. It comes from Retell's monitor
// socket, wss://api.retellai.com/v2/monitor-call/{call_id}, which wants the secret key (as WebSocket subprotocols, the way the
// SDK sends it). The key never reaches the browser, so this server opens that socket and passes on the words.
//
// What passes on, and nothing else: for each utterance whose role is agent or user (Retell's caller is the user), its id,
// role, content and time_sec. Tool calls and results, node transitions, DTMF, SMS, injected text, the pre-session history, the
// word timings and every other field are dropped. An utterance that holds the key is dropped too. Retell sends the snapshot of
// the call so far and then updates, often the same utterance again: only a new or changed one is passed on, and the screen
// merges them by id.
//
// The stream says:
//   event: utterance   data: {"id","role","content","time_sec"}
//   event: end         data: {}                   (the call ended, or its 15 minutes are up; the screen closes the stream)
//   event: problem     data: {"error","message"}  (a fixed code and its fixed sentence, never a word Retell said)
// A comment line goes out every 15 seconds so nothing in between closes an idle stream.
//
// When the upstream socket closes: the call ended (Retell's call_ended, or a normal close), the page went away (the request's
// abort, or the response cancelled), the key was disconnected or replaced (Disconnect closes every relay, and a changed epoch is
// noticed within WATCH_MS as well), or the call's 15 minutes since it started are up (ACTIVE_TEST_CALL_MS, the slot's own cap).
// A call has one stream at a time. A call not yet live (Retell closes with 4004) and a lost connection are tried again, at most
// MAX_ATTEMPTS times with a growing wait, as the SDK does.
//
// The transport is undici's WebSocket: Node 20 has no global one, undici's client takes subprotocols, and the same version
// already ships in this install. Never kept or logged: the key, the socket address, a frame, or an error Retell sent.
import { WebSocket } from "undici";
import { TEST_CALL_MESSAGE, type TestCallErrorCode } from "./labels";
import { currentEpoch } from "./pull";
import { ACTIVE_TEST_CALL_MS, claimLiveStream, type LiveClaim } from "./test-call";
import { KeyStoreError } from "./key-store";
import { localRetellBase, readStoredKey, RETELL_API_BASE, RETELL_ID } from "./retell-source";

/** How often the stream checks for a Disconnect and for its cap. */
export const WATCH_MS = 1000;
/** The longest quiet stretch before a comment line goes out. */
const HEARTBEAT_MS = 15_000;
/** How many times a closed socket is opened again before the stream gives up. */
const MAX_ATTEMPTS = 8;
/** A frame longer than this is not read. */
const MAX_FRAME_CHARS = 1_000_000;
/** The most utterances read from one frame, and the most kept for one call. */
const MAX_PER_FRAME = 500;
const MAX_PER_CALL = 2000;
/** The longest text of one utterance that passes on. */
const MAX_CONTENT_CHARS = 8000;

export type LiveUtterance = { id: string; role: "agent" | "user"; content: string; time_sec: number };

export type LiveDeps = {
  /** The wait before the next try, given how many tries have failed. Tests make it short. */
  retryDelayMs?: (failures: number) => number;
  /** How long the stream may run, counted from now. Defaults to what is left of the call's 15 minutes. */
  capMs?: number;
  watchMs?: number;
  now?: () => number;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const defaultDelay = (failures: number): number => Math.min(15_000, 500 * 2 ** failures) + Math.random() * 250;

/** The monitor address for a call: Retell's host (or the local fake the canary points at), with the socket scheme. */
function monitorUrl(callId: string): string {
  const base = localRetellBase() ?? RETELL_API_BASE;
  return `${base.replace(/^http/, "ws")}/v2/monitor-call/${encodeURIComponent(callId)}`;
}

/** True when the text holds the key, as it is or as JSON writes it. */
const holds = (text: string, key: string): boolean => text.includes(key) || text.includes(JSON.stringify(key).slice(1, -1));

/**
 * The utterances of a transcript array that may pass on. Only the four fields leave. Anything unreadable, any other role and any
 * utterance that holds the key is left out.
 */
export function utterancesOf(list: unknown, key: string): LiveUtterance[] {
  if (!Array.isArray(list)) return [];
  const out: LiveUtterance[] = [];
  for (const u of list.slice(0, MAX_PER_FRAME)) {
    if (!isRec(u)) continue;
    const role = u.role === "agent" ? "agent" : u.role === "user" || u.role === "caller" ? "user" : null;
    if (role === null || typeof u.id !== "string" || !RETELL_ID.test(u.id)) continue;
    if (typeof u.content !== "string" || typeof u.time_sec !== "number" || !Number.isFinite(u.time_sec)) continue;
    if (holds(u.id, key) || holds(u.content, key)) continue;
    out.push({ id: u.id, role, content: u.content.slice(0, MAX_CONTENT_CHARS), time_sec: u.time_sec });
  }
  return out;
}

/**
 * Opens the live transcript of a test call this server started. The answer is a refusal (a code, before any stream) or the
 * body of a text/event-stream response. `signal` is the request's: when it aborts, everything closes.
 */
export async function openLiveTranscript(
  callId: string,
  signal: AbortSignal,
  deps: LiveDeps = {},
): Promise<{ ok: true; body: ReadableStream<Uint8Array> } | { ok: false; code: TestCallErrorCode }> {
  const claimed = claimLiveStream(callId);
  if (!claimed.ok) return claimed;
  const { claim } = claimed;
  try {
    const epoch = currentEpoch();
    const key = await readStoredKey();
    if (key === null || currentEpoch() !== epoch) {
      claim.release();
      return { ok: false, code: "not_connected" };
    }
    const url = monitorUrl(callId);
    return { ok: true, body: relay({ url, key, epoch, signal, claim, deps }) };
  } catch (err) {
    claim.release();
    return { ok: false, code: err instanceof KeyStoreError ? "not_connected" : "failed" };
  }
}

type RelayInput = {
  url: string;
  key: string;
  epoch: number;
  signal: AbortSignal;
  claim: LiveClaim;
  deps: LiveDeps;
};

function relay({ url, key, epoch, signal, claim, deps }: RelayInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const now = deps.now ?? Date.now;
  const delayFor = deps.retryDelayMs ?? defaultDelay;
  const capMs = deps.capMs ?? Math.max(0, claim.startedAt + ACTIVE_TEST_CALL_MS - now());
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let socket: WebSocket | undefined;
  /** Takes the current socket's listeners off. */
  let detach: () => void = noop;
  let done = false;
  let failures = 0;
  let notLive = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let lastWrite = now();
  /** What was passed on for each id, so a snapshot that repeats an utterance is not sent again. */
  const sent = new Map<string, string>();

  const write = (text: string) => {
    if (done || !controller) return;
    try {
      controller.enqueue(encoder.encode(text));
      lastWrite = now();
    } catch {
      stop();
    }
  };
  const event = (name: "utterance" | "end" | "problem", data: unknown) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const problem = (code: TestCallErrorCode) => {
    event("problem", { error: code, message: TEST_CALL_MESSAGE[code] });
    stop();
  };

  function dropSocket() {
    const s = socket;
    socket = undefined;
    detach();
    detach = noop;
    if (!s) return;
    // A socket still connecting fails its handshake when closed; nothing listens for it, so nothing is raised.
    s.addEventListener("error", noop);
    try {
      s.close();
    } catch {
      // Already closing.
    }
  }

  /** Closes everything and ends the response. Safe to call more than once. */
  function stop() {
    if (done) return;
    done = true;
    clearTimeout(retry);
    clearTimeout(capTimer);
    clearInterval(watch);
    signal.removeEventListener("abort", stop);
    dropSocket();
    claim.release();
    try {
      controller?.close();
    } catch {
      // Already closed by the reader.
    }
  }

  function finish() {
    event("end", {});
    stop();
  }

  function onMessage(ev: { data: unknown }) {
    if (done) return;
    const data = ev.data;
    if (typeof data !== "string" || data.length > MAX_FRAME_CHARS) return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRec(frame)) return;
    failures = 0;
    notLive = 0;
    if (frame.type === "call_ended") return finish();
    if (frame.type !== "transcript_snapshot" && frame.type !== "transcript_updated") return;
    for (const u of utterancesOf(frame.transcripts, key)) {
      const fingerprint = `${u.role}\n${u.time_sec}\n${u.content}`;
      if (sent.get(u.id) === fingerprint) continue;
      if (!sent.has(u.id) && sent.size >= MAX_PER_CALL) continue;
      sent.set(u.id, fingerprint);
      event("utterance", u);
    }
  }

  /** The socket closed with this code, or failed before it opened (code 1006: Retell was not reached). */
  function onGone(code: number) {
    if (done) return;
    detach();
    detach = noop;
    socket = undefined;
    if (code === 1000) return finish();
    if (code === 4004) {
      notLive += 1;
      return notLive >= MAX_ATTEMPTS ? problem("network") : again(notLive - 1);
    }
    if (code >= 4000 && code <= 4999) return problem("failed");
    failures += 1;
    return failures > MAX_ATTEMPTS ? problem("network") : again(failures - 1);
  }

  function again(failed: number) {
    clearTimeout(retry);
    retry = setTimeout(open, delayFor(failed));
  }

  function open() {
    if (done) return;
    try {
      const s = new WebSocket(url, ["bearer", key]);
      socket = s;
      // Whichever of close and error comes first decides; the other is ignored. Nothing of an error is kept.
      const onClose = (ev: { code: number }) => onGone(ev.code);
      const onError = () => onGone(1006);
      s.addEventListener("message", onMessage);
      s.addEventListener("close", onClose);
      s.addEventListener("error", onError);
      detach = () => {
        s.removeEventListener("message", onMessage);
        s.removeEventListener("close", onClose);
        s.removeEventListener("error", onError);
      };
    } catch {
      problem("failed");
    }
  }

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      claim.attach({
        close: () => {
          if (!done) {
            event("problem", { error: "not_connected", message: TEST_CALL_MESSAGE.not_connected });
            stop();
          }
        },
      });
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
      write(": open\n\n");
      capTimer = setTimeout(finish, capMs);
      watch = setInterval(() => {
        if (currentEpoch() !== epoch) {
          event("problem", { error: "not_connected", message: TEST_CALL_MESSAGE.not_connected });
          stop();
        } else if (now() - lastWrite >= HEARTBEAT_MS) {
          write(": keepalive\n\n");
        }
      }, deps.watchMs ?? WATCH_MS);
      open();
    },
    cancel() {
      stop();
    },
  });
}

const noop = () => {};
