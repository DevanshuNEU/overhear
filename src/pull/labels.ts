// Every word the local server says to a person: the connect answers and the refusals from the local check.
// The connect screen shows these strings as they are. Pure data, so the proxy can import it.

export type ConnectError = "bad_request" | "bad_key" | "unreachable" | "store_failed" | "home_unsafe" | "file_unsafe";

export const CONNECT_MESSAGE: Record<ConnectError, string> = {
  bad_request: "Paste a Retell API key.",
  bad_key: "Retell didn't accept this key.",
  unreachable: "Couldn't reach Retell. Check your connection and try again.",
  store_failed: "Couldn't save the key on this computer.",
  home_unsafe: "The folder for your key is open to other users or isn't yours, so Overhear won't use it. Run chmod 700 on it, or set OVERHEAR_HOME to a new folder.",
  file_unsafe: "The saved key file can be read by other users or isn't a plain file, so Overhear won't read it. Disconnect and paste the key again.",
};

export const LOCAL_REFUSAL = {
  /** A hosted copy has no product routes. */
  notFound: "Not found.",
  /** A request whose Host is not this computer, or a change sent from another site. */
  forbidden: "Overhear only answers requests from this computer.",
  /** Local mode on a server that listens on more than this computer. */
  wrongBind: "Overhear holds your Retell key, so it only runs on 127.0.0.1. Start it with npm run local.",
  /** A body that is not JSON. */
  unsupported: "Send the key as JSON.",
  /** A body over the size limit. */
  tooLarge: "That is too long to be a Retell API key.",
} as const;
