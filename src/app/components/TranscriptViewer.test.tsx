import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptViewer } from "./TranscriptViewer";

describe("TranscriptViewer", () => {
  it("renders a flagged utterance alongside its dimension chip", () => {
    render(
      <TranscriptViewer
        utterances={[
          { utterance: { role: "user", content: "I've had a bad headache.", words: [] }, flags: [] },
          {
            utterance: { role: "agent", content: "You should take ibuprofen every four hours.", words: [] },
            flags: ["safety_escalation"],
          },
        ]}
        unmatchedFlags={[]}
      />,
    );

    expect(screen.getByText("You should take ibuprofen every four hours.")).toBeInTheDocument();
    expect(screen.getByText("Safety escalation")).toBeInTheDocument();
  });

  it("shows unmatched call-level flags in a banner above the transcript", () => {
    render(
      <TranscriptViewer
        utterances={[{ utterance: { role: "user", content: "Hello.", words: [] }, flags: [] }]}
        unmatchedFlags={["task_success"]}
      />,
    );

    expect(screen.getByText("Task success")).toBeInTheDocument();
  });
});
