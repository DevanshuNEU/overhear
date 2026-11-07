// npm run canary:live: the pasted Retell key, followed through a real running app.
//
// src/pull/canary.test.ts calls the route handlers directly. It never runs Next, so Next's own request log, its
// error overlay, its patched fetch and .next/ are not checked there. This script starts `next dev` in local mode on a
// free loopback port, points it at a fake Retell on another loopback port that echoes the Authorization header into
// every body and header, and drives the real flow over HTTP with a unique marker key: connect (good and refused
// keys), pulls, call screens, Retell's 401, 403, 404, 429 and 500 and a dropped connection, refetch, disconnect.
// Then it stops both servers and searches for the key (plain, hex, base64 at every alignment, Basic auth, any
// 8-character window) in:
//   - everything the dev server wrote to stdout and stderr,
//   - every HTTP response (status line, headers and body) the script received,
//   - what the fake Retell saw outside the Authorization header (URLs, cookies, other headers, bodies),
//   - every file under .next/, the cache included,
//   - every file under the temporary OVERHEAR_HOME, config.json only while connected, and config.json must be gone
//     after disconnect.
//
// Exit codes: 0 clean, 1 the key was found (each place is named), 2 the run itself failed (a step did not do what
// it should, so a clean search would prove nothing).
//
// CANARY_INJECT_LEAK=1 proves the search bites. It makes the run leak on purpose, from this script alone (nothing
// in the app changes): the fake lists a call whose id is the key, which the app shows in its pull answers and call
// screen, a request carries the key in its URL, which Next logs, and the script drops the key into a file under
// .next/ and one under OVERHEAR_HOME. The run must then exit 1, naming those places.
//
// Local only: both servers bind 127.0.0.1, the key is made up, and nothing here reaches the network.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type Finding, makeSearcher } from "./canary-live/scan";

const REPO = path.resolve(__dirname, "..");
const NEXT_DIR = path.join(REPO, ".next");
const INJECT = process.env.CANARY_INJECT_LEAK === "1";
const READY_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 180_000;

/** A run step did not do what it should. Exit code 2. */
class HarnessError extends Error {}

const log = (msg: string) => process.stdout.write(`canary:live ${msg}\n`);

// ---- the made-up key ---------------------------------------------------------------------------------------------

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomAlnum(n: number): string {
  return Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join("");
}
// No `key_` prefix, so redact()'s pattern for Retell keys cannot hide a leak: the run passes only if nothing leaks.
const KEY = `Zq7${randomAlnum(16)}W`;
const search = makeSearcher({ key: KEY, marker: KEY });

// ---- what was seen -----------------------------------------------------------------------------------------------

type Seen = { name: string; text: string };
const responses: Seen[] = [];
const retellSeen: Seen[] = [];
let bearerRequests = 0;

// ---- the fake Retell ---------------------------------------------------------------------------------------------

type Kind = "list" | "get";
type Answer = number | "network";
const queues: Record<Kind, Answer[]> = { list: [], get: [] };
/** The next `times` requests of this kind get this answer. */
const queue = (kind: Kind, answer: Answer, times = 1) => {
  for (let i = 0; i < times; i++) queues[kind].push(answer);
};

const drain = () => {
  queues.list.length = 0;
  queues.get.length = 0;
};

type SampleRecord = { call_id: string; start_timestamp: number; [field: string]: unknown };
function sampleRecords(): SampleRecord[] {
  const dir = path.join(REPO, "eval", "engine", "cases");
  // The samples under new ids: the app serves a call it holds as a sample under the sample's own id, which would
  // hide whether a call screen came from the pull.
  const records = ["sample-failed", "sample-needs-review", "sample-passed"].map((name, i) => ({
    ...(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).record as SampleRecord),
    call_id: `call_live_${i}`,
  }));
  if (INJECT) records.unshift({ ...records[2], call_id: KEY, start_timestamp: records[2].start_timestamp + 1 });
  return records;
}
const RECORDS = sampleRecords();

function fakeRetell(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    const auth = String(req.headers.authorization ?? "");
    if (auth === `Bearer ${KEY}`) bearerRequests++;
    // The key legitimately rides in Authorization. Anything else the fake saw that holds it is a leak.
    const rest = Object.entries(req.headers)
      .filter(([name]) => name !== "authorization")
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join("\n");
    retellSeen.push({ name: "what the fake Retell was sent (outside Authorization)", text: `${req.method} ${url}\n${rest}\n${Buffer.concat(chunks).toString("utf8")}` });

    const isGet = req.method === "GET" && url.startsWith("/v2/get-call/");
    const isList = req.method === "POST" && url.startsWith("/v3/list-calls");
    if (!isGet && !isList) {
      res.writeHead(404, { "content-type": "application/json", "x-echo": auth });
      res.end(JSON.stringify({ message: `no route, sent ${auth}` }));
      return;
    }
    const answer = queues[isGet ? "get" : "list"].shift() ?? 200;
    if (answer === "network") {
      req.socket.destroy();
      return;
    }
    // Every answer, good or bad, carries the key back in a header, a cookie and the body: the worst real server.
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-echo": auth,
      "set-cookie": `k=${KEY}`,
      ...(answer === 429 ? { "retry-after": "1" } : {}),
    };
    if (answer !== 200) {
      res.writeHead(answer, headers);
      res.end(JSON.stringify({ message: `rejected ${auth}`, key: KEY, hex: Buffer.from(KEY).toString("hex"), b64: Buffer.from(KEY).toString("base64") }));
      return;
    }
    if (isList) {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ items: RECORDS, has_more: false, note: auth }));
      return;
    }
    const id = decodeURIComponent(url.slice("/v2/get-call/".length).split("?")[0]);
    const record = RECORDS.find((r) => r.call_id === id);
    if (!record) {
      res.writeHead(404, headers);
      res.end(JSON.stringify({ message: `no call, sent ${auth}` }));
      return;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(record));
  });
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });
}

/** A free loopback port for the app. Next must be told its port up front, so ask the OS and release it. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

// ---- running and stopping the servers ----------------------------------------------------------------------------

let root = "";
let app: ChildProcess | null = null;
let fake: http.Server | null = null;
let cleaned = false;

function killAppGroup(signal: NodeJS.Signals) {
  if (!app?.pid) return;
  try {
    process.kill(-app.pid, signal);
  } catch {
    // Already gone.
  }
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopApp() {
  if (!app || exited(app)) return;
  const child = app;
  const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  killAppGroup("SIGTERM");
  const killed = await Promise.race([done.then(() => true), sleep(10_000).then(() => false)]);
  if (!killed) {
    killAppGroup("SIGKILL");
    await Promise.race([done, sleep(5_000)]);
  }
}

async function stopFake() {
  if (!fake) return;
  const server = fake;
  fake = null;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Stops everything and removes the temporary folder. Safe to call twice, and from a signal. */
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await stopApp();
  killAppGroup("SIGKILL"); // anything Next left in its group
  await stopFake();
  if (root) fs.rmSync(root, { recursive: true, force: true });
}

// Last-resort, synchronous: runs when the process is leaving whatever happened above.
process.on("exit", () => {
  killAppGroup("SIGKILL");
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    log(`got ${signal}, stopping`);
    void cleanup().finally(() => process.exit(130));
  });
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) n++;
  }
  return n;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns a value, or throws a HarnessError at the deadline. */
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = STEP_TIMEOUT_MS, everyMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (app && exited(app)) throw new HarnessError(`the dev server stopped while waiting for ${what}`);
    if (Date.now() > deadline) throw new HarnessError(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

// ---- the app's HTTP, with the headers the proxy expects ----------------------------------------------------------

let port = 0;
const HOST = () => `127.0.0.1:${port}`;

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

/** One request to the app. Everything it answers is kept for the search. */
function call(method: string, urlPath: string, opts: { body?: string; json?: boolean; tag?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: HOST(), accept: "*/*" };
    if (method !== "GET" && method !== "HEAD") headers.origin = `http://${HOST()}`;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(opts.body));
    }
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, agent: false, timeout: STEP_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const lines = res.rawHeaders.reduce<string[]>((acc, v, i) => (i % 2 === 0 ? [...acc, `${v}: ${res.rawHeaders[i + 1]}`] : acc), []);
        responses.push({ name: `the response to ${method} ${opts.tag ?? urlPath.replace(KEY, "[probe]")}`, text: `${res.statusCode}\n${lines.join("\n")}\n${body}` });
        // A request that waits on Retell is over, so an answer it did not use must not reach the next step. Pulls
        // keep asking Retell after they answer; settledPull drains for them.
        if (!urlPath.startsWith("/api/pulls")) drain();
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${method} ${urlPath} timed out`)));
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const expectStatus = (reply: Reply, status: number, what: string) => {
  if (reply.status !== status) throw new HarnessError(`${what}: expected ${status}, got ${reply.status}`);
};
const json = (reply: Reply): Record<string, unknown> => JSON.parse(reply.body) as Record<string, unknown>;

type Progress = { phase: string; rows: { callId: string; state: string }[]; error?: { code: string } };

async function settledPull(id: string): Promise<Progress> {
  return until(`pull ${id.slice(0, 8)} to settle`, async () => {
    const reply = await call("GET", `/api/pulls/${id}`, { tag: "/api/pulls/[id]" });
    expectStatus(reply, 200, "reading a pull");
    const progress = json(reply) as unknown as Progress;
    if (!["done", "failed", "cancelled"].includes(progress.phase)) return null;
    drain();
    return progress;
  });
}

async function startPull(n: number): Promise<string> {
  const reply = await call("POST", "/api/pulls", { body: JSON.stringify({ n }) });
  expectStatus(reply, 202, "starting a pull");
  return String(json(reply).id);
}

// ---- the flow ----------------------------------------------------------------------------------------------------

const configFile = () => path.join(root, "store", "config.json");
const isConfig = (file: string) => file === configFile();
const connectBody = (key: string) => JSON.stringify({ key });

async function drive(appPort: number) {
  port = appPort;
  const summary: string[] = [];

  expectStatus(await call("GET", "/api/connect"), 200, "reading the connection");

  // A key Retell refuses or cannot check: nothing is stored.
  for (const [answer, want] of [[401, 422], [403, 422], [429, 502], [500, 502], [503, 502], ["network", 502]] as [Answer, number][]) {
    queue("list", answer);
    expectStatus(await call("POST", "/api/connect", { body: connectBody(KEY), tag: `/api/connect (Retell ${answer})` }), want, `connect when Retell answers ${answer}`);
  }
  // Text that cannot be a key, and JSON that does not parse, with the key inside it.
  expectStatus(await call("POST", "/api/connect", { body: `{"key": ${KEY}`, tag: "/api/connect (bad JSON)" }), 400, "connect with bad JSON");
  expectStatus(await call("POST", "/api/connect", { body: connectBody(`${KEY}\nmore`), tag: "/api/connect (newline key)" }), 422, "connect with a newline in the key");
  if (fs.existsSync(configFile())) throw new HarnessError("a refused key was stored");
  summary.push("connect: refused keys (401, 403, 429, 500, 503, dropped connection, bad JSON), nothing stored");

  // The good key.
  expectStatus(await call("POST", "/api/connect", { body: connectBody(KEY) }), 200, "connect with a good key");
  if (!fs.existsSync(configFile())) throw new HarnessError("the key was not stored after a good connect");
  if (!fs.readFileSync(configFile(), "utf8").includes(KEY)) throw new HarnessError("config.json does not hold the key it should");
  if ((fs.statSync(configFile()).mode & 0o077) !== 0) throw new HarnessError("config.json is open to other users");
  expectStatus(await call("GET", "/api/connect"), 200, "reading the connection");

  // While connected, nothing but config.json under OVERHEAR_HOME may hold the key.
  const midHome = search.inTree(path.join(root, "store"), "OVERHEAR_HOME while connected", isConfig);
  summary.push(`home while connected: ${midHome.length === 0 ? "only config.json holds the key" : "found elsewhere"}`);
  pending.push(...midHome);

  // A pull, polled, and each call's screen.
  const pulled = await settledPull(await startPull(3));
  if (pulled.phase !== "done") throw new HarnessError(`the first pull ended as ${pulled.phase}`);
  const ids = pulled.rows.filter((r) => r.state === "report").map((r) => r.callId);
  if (ids.length < 3) throw new HarnessError(`the first pull produced ${ids.length} reports, expected at least 3`);
  for (const id of ids) {
    const page = await call("GET", `/reports/${encodeURIComponent(id)}`, { tag: "/reports/[callId]" });
    expectStatus(page, 200, "a call screen");
  }
  summary.push(`pull: ${ids.length} calls reported, ${ids.length} call screens opened`);

  // Pull errors: the list fails (401, 403, 429, 500, dropped), then the fetches fail.
  const listFailures: Answer[] = [401, 403, 429, 500, "network"];
  for (const answer of listFailures) {
    // Three in a row, so a retry meets the same failure.
    queue("list", answer, 3);
    const progress = await settledPull(await startPull(3));
    // A refused key must fail the pull. The others the pull may wait out and retry, so only the end is checked.
    if ((answer === 401 || answer === 403) && progress.phase !== "failed") throw new HarnessError(`a pull whose list was ${answer} ended as ${progress.phase}, not failed`);
  }
  for (const answer of [401, 429, 500, "network"] as Answer[]) {
    queue("get", answer, 3);
    await settledPull(await startPull(3));
  }
  summary.push("pull errors: list and fetch failing with 401, 403, 429, 500 and a dropped connection");

  // Refetch: once failing, once good. And a call screen for ids Retell does not have, or cannot answer for.
  const first = ids.find((id) => id !== KEY) ?? ids[0];
  queue("get", 500);
  await call("POST", `/api/calls/${encodeURIComponent(first)}/refetch`, { tag: "/api/calls/[id]/refetch (Retell 500)" });
  queue("get", "network");
  await call("POST", `/api/calls/${encodeURIComponent(first)}/refetch`, { tag: "/api/calls/[id]/refetch (dropped)" });
  expectStatus(await call("POST", `/api/calls/${encodeURIComponent(first)}/refetch`, { tag: "/api/calls/[id]/refetch" }), 200, "a good refetch");
  for (const answer of [404, 401, 429, 500, "network"] as Answer[]) {
    queue("get", answer);
    await call("GET", `/reports/missing-${randomAlnum(8)}`, { tag: `/reports/[callId] (Retell ${answer})` });
  }
  summary.push("refetch and unknown call screens: Retell 404, 401, 429, 500 and a dropped connection");

  if (INJECT) {
    // The key in a URL: Next writes every request path to its output.
    await call("GET", `/probe/${KEY}`, { tag: "/probe/[key]" });
    // And the key in files, where the search looks: .next/ and OVERHEAR_HOME.
    fs.writeFileSync(path.join(NEXT_DIR, "canary-injected-leak.txt"), `debug dump ${Buffer.from(KEY).toString("base64")}\n`);
    fs.writeFileSync(path.join(root, "store", "injected-leak.log"), `retry with ${KEY}\n`);
    summary.push("CANARY_INJECT_LEAK=1: a call listed under the key's name, the key in a URL, a file under .next/ and one under OVERHEAR_HOME");
  }

  // Disconnect.
  expectStatus(await call("DELETE", "/api/connect"), 200, "disconnect");
  if (fs.existsSync(configFile())) throw new HarnessError("config.json is still there after disconnect");
  expectStatus(await call("GET", "/api/connect"), 200, "reading the connection after disconnect");
  expectStatus(await call("POST", "/api/pulls", { body: "{}" }), 409, "a pull after disconnect");
  expectStatus(await call("GET", `/reports/${encodeURIComponent(first)}`, { tag: "/reports/[callId] (after disconnect)" }), 404, "a call screen after disconnect");
  summary.push("disconnect: config.json gone, a pull is refused, the call screen no longer shows the call");

  if (bearerRequests < 10) throw new HarnessError(`the fake Retell saw the key in only ${bearerRequests} requests, so the app did not use it as expected`);
  summary.push(`the fake Retell was sent the key as a Bearer header ${bearerRequests} times, and every answer echoed it back`);
  return summary;
}

/** Findings from before the server stopped. */
const pending: Finding[] = [];

// ---- main --------------------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-canary-live-"));
  const outputFile = path.join(root, "server-output.log");
  const out = fs.openSync(outputFile, "w");

  fake = http.createServer(fakeRetell);
  const retellPort = await listen(fake);
  const appPort = await freePort();

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DASHBOARD_PASSWORD;
  delete env.__NEXT_PRIVATE_ORIGIN;
  Object.assign(env, {
    OVERHEAR_LOCAL: "1",
    OVERHEAR_HOME: path.join(root, "store"),
    OVERHEAR_RETELL_BASE_URL: `http://127.0.0.1:${retellPort}`,
    NEXT_TELEMETRY_DISABLED: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  });
  log(`starting next dev on 127.0.0.1:${appPort}, fake Retell on 127.0.0.1:${retellPort}${INJECT ? " (leak injection on)" : ""}`);
  app = spawn(path.join(REPO, "node_modules", ".bin", "next"), ["dev", "-H", "127.0.0.1", "-p", String(appPort)], {
    cwd: REPO,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  app.on("error", () => {}); // a failed spawn leaves no pid, which is checked next
  if (!app.pid) throw new HarnessError("could not start next dev (is node_modules installed?)");

  try {
    await until("the dev server to answer", async () => {
      try {
        port = appPort;
        return (await call("GET", "/api/health", { tag: "/api/health" })).status > 0 ? true : null;
      } catch {
        return null;
      }
    }, READY_TIMEOUT_MS, 500);
    // The readiness probe's answers are not part of the search: the key does not exist yet, and they are noise.
    responses.length = 0;
  } catch (err) {
    log(`server output so far (the key had not been sent yet):\n${fs.readFileSync(outputFile, "utf8").split("\n").slice(-40).join("\n")}`);
    throw err;
  }

  const summary = await drive(appPort);

  // Stop the servers, then search.
  await stopApp();
  await stopFake();
  fs.closeSync(out);

  // A search of an empty capture proves nothing: the output must hold what the app is known to have logged, and
  // .next/ must hold files.
  const output = fs.readFileSync(outputFile);
  if (!output.includes("connect.check_failed")) throw new HarnessError("the captured server output does not hold the app's own log lines");
  const nextFiles = countFiles(NEXT_DIR);
  if (nextFiles === 0) throw new HarnessError(".next/ is empty, so there is nothing to search");

  const findings: Finding[] = [...pending];
  const serverHit = search.inText(output);
  if (serverHit) findings.push({ place: "the dev server's stdout and stderr", found: serverHit });
  for (const r of responses) {
    const hit = search.inText(r.text);
    if (hit) findings.push({ place: r.name, found: hit });
  }
  for (const r of retellSeen) {
    const hit = search.inText(r.text);
    if (hit) findings.push({ place: r.name, found: hit });
  }
  findings.push(...search.inTree(NEXT_DIR, ".next"));
  findings.push(...search.inTree(path.join(root, "store"), "OVERHEAR_HOME"));
  if (fs.existsSync(configFile())) findings.push({ place: "OVERHEAR_HOME/config.json (still there after disconnect)", found: "the file itself" });

  const places = new Map<string, string>();
  for (const f of findings) if (!places.has(f.place)) places.set(f.place, f.found);

  for (const line of summary) log(line);
  log(
    `searched: ${responses.length} responses, ${retellSeen.length} requests the fake Retell saw, ${output.length} bytes of server output, ${nextFiles} files under .next/, OVERHEAR_HOME`,
  );
  if (places.size === 0) {
    log("CLEAN: the key was not found anywhere.");
    return 0;
  }
  log(`LEAK: the key was found in ${places.size} place${places.size === 1 ? "" : "s"}:`);
  for (const [place, found] of places) log(`  - ${place}: ${found}`);
  return 1;
}

main()
  .then(async (code) => {
    await cleanup();
    process.exit(code);
  })
  .catch(async (err) => {
    // An error message here never holds the key: HarnessError messages are built from fixed text and status codes.
    log(`FAILED: ${err instanceof Error ? err.message : "unknown error"}`);
    await cleanup();
    process.exit(2);
  });
