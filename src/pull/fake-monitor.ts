// A stand-in for Retell's monitor socket (wss://api.retellai.com/v2/monitor-call/{call_id}), for tests only: a local WebSocket
// server on node:http, with just enough of RFC 6455 to accept a handshake, answer with the first subprotocol, send text frames
// and a close code, and notice that the client went away. Not imported by the app.
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type FakeConnection = {
  /** The request path, such as /v2/monitor-call/call_web_1. */
  path: string;
  /** The subprotocols the client offered, in order. */
  protocols: string[];
  /** Sends one JSON text frame. */
  send(frame: unknown): void;
  /** Sends a text frame as it is. */
  sendRaw(text: string): void;
  /** Sends a close frame with this code, as Retell does at the end of a call. */
  close(code: number): void;
  /** True once the client has closed the socket or the socket is gone. */
  isClosed(): boolean;
  /** Resolves when the socket is gone. */
  closed: Promise<void>;
};

export type FakeMonitor = {
  /** http://127.0.0.1:port, for OVERHEAR_RETELL_BASE_URL. */
  origin: string;
  connections: FakeConnection[];
  stop(): Promise<void>;
};

function textFrame(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
  return Buffer.concat([head, body]);
}

const closeFrame = (code: number): Buffer => Buffer.from([0x88, 2, code >> 8, code & 255]);

/** Starts the fake. `onConnect` runs for each accepted connection, after its handshake. */
export async function startFakeMonitor(
  onConnect: (conn: FakeConnection, index: number) => void = () => {},
  /** Answers the plain HTTP requests (a fake of Retell's REST side, for a run of the real app). Default: 426. */
  rest: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => void res.writeHead(426).end(),
): Promise<FakeMonitor> {
  const connections: FakeConnection[] = [];
  const sockets = new Set<Duplex>();
  const server = http.createServer(rest);
  server.on("upgrade", (req, socket: Duplex) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const offered = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    const lines = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`];
    if (offered.length > 0) lines.push(`Sec-WebSocket-Protocol: ${offered[0]}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    let gone = false;
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
    const mark = () => {
      gone = true;
      sockets.delete(socket);
      resolveClosed();
    };
    socket.on("close", mark);
    socket.on("error", mark);
    // A close frame from the client (opcode 8) is answered, then the socket ends.
    socket.on("data", (chunk: Buffer) => {
      if ((chunk[0] & 0x0f) === 0x8) {
        if (!gone) socket.write(closeFrame(1000));
        socket.end();
      }
    });
    const conn: FakeConnection = {
      path: req.url ?? "",
      protocols: offered,
      send: (frame) => conn.sendRaw(JSON.stringify(frame)),
      sendRaw: (text) => {
        if (!gone) socket.write(textFrame(text));
      },
      close: (code) => {
        if (!gone) socket.write(closeFrame(code));
      },
      isClosed: () => gone,
      closed,
    };
    connections.push(conn);
    onConnect(conn, connections.length - 1);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    connections,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
