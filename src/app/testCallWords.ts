// Every word the test call screen says that does not come from the server. The server words the refusals (TEST_CALL_MESSAGE,
// TEST_CALL_TIMEOUT_MESSAGE and TEST_CALL_DID_NOT_CONNECT_MESSAGE in src/pull/labels.ts) and the screen shows them as they
// arrive. Verdict words come from src/report/labels.ts. Real apostrophes, no dashes.

export type MicState = "idle" | "asking" | "allowed" | "on" | "off" | "blocked";
export type ConnectionState = "idle" | "connecting" | "connected" | "ended" | "failed";

export const TEST_WORDS = {
  // The headline, by where the call is.
  idleLead: "Talk to your agent.",
  idleNext: "Read the transcript as you speak, then see the verdict after you hang up.",
  connectingLead: "Connecting to your agent.",
  connectingNext: "Allow the microphone if your browser asks.",
  liveLead: "You are on a test call.",
  liveNext: "Each turn shows below as it is heard.",
  processingLead: "Retell is still processing this call.",
  processingNext: "The report appears here when it is ready. Your transcript stays on screen.",
  couldntConnectLead: "Couldn’t connect to your agent.",
  couldntConnectNext: "There is nothing to check. Start another test call when you are ready.",
  cancelledLead: "You ended the call before it connected.",
  cancelledNext: "There is nothing to check. Start another test call when you are ready.",
  noReportLead: "No report for this call.",
  timeoutLead: "Retell is taking longer than usual.",
  noContentLead: "Nothing to check in this call.",
  errorLead: "Overhear couldn’t check this call.",
  finished: "Test call finished.",

  // The agent picker.
  agentLabel: "Agent",
  agentPlaceholder: "Choose an agent",
  agentsLoading: "Finding your agents.",
  agentsEmpty: "No voice agents on this Retell account.",
  agentsEmptyNext: "Test calls need a voice agent. Create one in Retell, then check again.",
  agentsFailed: "Couldn’t list your agents.",
  checkAgain: "Check again",
  tryAgain: "Try again",
  cost: "Each test call uses Retell minutes on your account.",
  micNote: "Your browser will ask for the microphone when you start.",

  // Controls.
  start: "Start test call",
  starting: "Starting",
  end: "End call",
  another: "Start another test call",
  allCalls: "All calls",

  // The facts under the headline.
  factAgent: "Agent",
  factMic: "Microphone",
  factConnection: "Connection",
  mic: {
    idle: "Not asked yet",
    asking: "Waiting for you to allow it",
    allowed: "Allowed",
    on: "On",
    off: "Off",
    blocked: "Blocked",
  } satisfies Record<MicState, string>,
  connection: {
    idle: "Not connected",
    connecting: "Connecting",
    connected: "Connected",
    ended: "Ended",
    failed: "Failed",
  } satisfies Record<ConnectionState, string>,

  // The transcript.
  transcriptLive: "Live transcript",
  transcriptSaw: "Transcript you saw",
  transcriptWaiting: "Nothing said yet. Say hello to the agent.",
  transcriptNone: "No words came through.",
  transcriptFinalRecord: "The report uses Retell’s final record, which can differ slightly from this live transcript.",
  agentTurn: "Agent",
  callerTurn: "Caller",

  // What went wrong, in Overhear’s own words.
  micBlocked: "Overhear can’t use your microphone. Allow it in your browser’s site settings, then start again.",
  micMissing: "This browser can’t share a microphone with Overhear. Open Overhear on localhost in a recent browser, then start again.",
  connectionFailed: "The connection to your agent failed.",
  unreachable: "Couldn’t reach Overhear on this computer. Check that it is still running, then try again.",
  stillTrying: "Overhear is still trying.",
} as const;
