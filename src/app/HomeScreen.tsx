"use client";

// What `/` shows in local mode: the connect screen when no key is saved, the call list when one is. It also moves
// between them without a reload: the list when Retell accepts a pasted key, the connect screen when the key is
// removed or Retell stops accepting it. Session report files opened on the connect screen go to /files.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectError } from "@/pull/labels";
import { CallListScreen } from "./CallListScreen";
import { ConnectScreen } from "./ConnectScreen";

type Screen = { kind: "connect"; notice?: Extract<ConnectError, "bad_key"> } | { kind: "list" };

type Props = {
  /** A key is already saved on this computer. */
  stored: boolean;
  /** The saved key file's path, as shown to the person (home folder written as ~). */
  location: string;
  /** The key store refused to open, so the answer to "is a key saved" is a refusal, not yes or no. */
  storeError?: ConnectError;
  /** Session report files are open on this computer, so the nav also links to them. */
  filesOpen?: boolean;
};

export function HomeScreen({ stored, location, storeError, filesOpen = false }: Props) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(stored ? { kind: "list" } : { kind: "connect" });
  const connected = useCallback(() => setScreen({ kind: "list" }), []);
  const disconnected = useCallback((notice?: Extract<ConnectError, "bad_key">) => setScreen({ kind: "connect", notice }), []);

  if (screen.kind === "list") return <CallListScreen location={location} onDisconnected={disconnected} filesOpen={filesOpen} />;
  return <ConnectScreen key={screen.notice ?? "plain"} location={location} storeError={storeError} notice={screen.notice} onConnected={connected} onFilesOpened={() => router.push("/files")} />;
}
