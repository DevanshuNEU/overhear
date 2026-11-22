import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FILES_MESSAGE, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, PROBLEM_REASON } from "@/files/labels";
import { LOCAL_REFUSAL } from "@/pull/labels";
import { ConnectScreen } from "./ConnectScreen";
import { FILES_WORDS } from "./filesWords";

const fetchMock = vi.fn<typeof fetch>();
const onFilesOpened = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  onFilesOpened.mockReset();
  vi.unstubAllGlobals();
});

const screenWith = () => render(<ConnectScreen location="~/.overhear/config.json" onConnected={vi.fn()} onFilesOpened={onFilesOpened} />);
const section = () => screen.getByRole("region", { name: FILES_WORDS.lead });
const picker = () => section().querySelector('input[type="file"]') as HTMLInputElement;

/** A file the browser would hand over: text() answers its content, size is what the check reads. */
function fileOf(name: string, text: string, size = text.length): File {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperties(file, { text: { value: async () => text, writable: true }, size: { value: size } });
  return file;
}

const row = { callId: "AJ_1", startedAt: 1, durationMs: 1, state: "report", verdict: "failed", headline: "h", platform: "livekit" };
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function choose(files: File[]) {
  fireEvent.change(picker(), { target: { files } });
}

describe("the connect screen's LiveKit section", () => {
  it("asks first, then says what to open and that it stays on this computer", () => {
    screenWith();
    expect(within(section()).getByRole("heading", { name: "On LiveKit Agents?" })).toBeInTheDocument();
    expect(section()).toHaveTextContent("Open the session reports your agent saves, one JSON file per call. They stay on this computer.");
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("LiveKit");
  });

  it("sits below the Retell key form, after a hairline, and is not a card", () => {
    screenWith();
    const form = screen.getByRole("button", { name: "Connect Retell" });
    expect(form.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section()).toHaveClass("border-t");
    expect(section()).not.toHaveClass("rounded-md");
    expect(section()).not.toHaveClass("bg-report-surface");
  });

  it("has a secondary button that opens a file input for many JSON files", () => {
    screenWith();
    const button = screen.getByRole("button", { name: "Open session reports" });
    expect(button).not.toHaveClass("bg-report-accent");
    expect(button).toHaveClass("border");
    const input = picker();
    expect(input).toHaveAttribute("accept", ".json,application/json");
    expect(input).toHaveAttribute("multiple");
    const click = vi.spyOn(input, "click");
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
  });

  it("explains how to save the reports in a details element, closed until asked, with the real API names", () => {
    screenWith();
    const details = section().querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText("How to save them")).toBeInTheDocument();
    fireEvent.click(within(details).getByText("How to save them"));
    expect(details).toHaveTextContent("In your agent, save the report when each session ends:");
    const code = details.querySelector("pre")!.textContent!;
    expect(code).toContain("async def on_session_end(ctx):");
    expect(code).toContain("ctx.make_session_report()");
    expect(code).toContain('Path(f"reports/{report.job_id}.json").write_text(json.dumps(report.to_dict()))');
    expect(details.textContent).toContain("@server.rtc_session(on_session_end=on_session_end)");
  });

  it("sends each chosen file's name and text to /api/files, then hands over once a call was read", async () => {
    fetchMock.mockResolvedValue(answer({ rows: [row], problems: [] }));
    screenWith();
    choose([fileOf("a.json", '{"job_id":"AJ_1"}'), fileOf("b.json", "{}")]);
    await waitFor(() => expect(onFilesOpened).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/files");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ files: [{ name: "a.json", text: '{"job_id":"AJ_1"}' }, { name: "b.json", text: "{}" }] });
  });

  it("takes files dropped on the section the same way, and marks it while a drag is over", async () => {
    fetchMock.mockResolvedValue(answer({ rows: [row], problems: [] }));
    screenWith();
    fireEvent.dragOver(section());
    expect(section()).toHaveAttribute("data-dragging");
    fireEvent.drop(section(), { dataTransfer: { files: [fileOf("dropped.json", "{}")] } });
    expect(section()).not.toHaveAttribute("data-dragging");
    await waitFor(() => expect(onFilesOpened).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).files[0].name).toBe("dropped.json");
  });

  it("stays here when no call could be read, and lists each file with its reason, never its content", async () => {
    fetchMock.mockResolvedValue(
      answer({
        rows: [],
        problems: [
          { file: "notes.json", reason: "not_json" },
          { file: "other.json", reason: "not_a_report" },
        ],
      }),
    );
    screenWith();
    choose([fileOf("notes.json", "SECRETTEXT"), fileOf("other.json", "{}")]);
    expect(await screen.findByText(FILES_WORDS.noneRead)).toBeInTheDocument();
    expect(onFilesOpened).not.toHaveBeenCalled();
    expect(screen.getByText(`notes.json: ${PROBLEM_REASON.not_json}`)).toBeInTheDocument();
    expect(screen.getByText(`other.json: ${PROBLEM_REASON.not_a_report}`)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SECRETTEXT");
  });

  it("says a fixed sentence when the server refuses, and when it cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: "too_large_total", message: "ignored" }, 413));
    screenWith();
    choose([fileOf("a.json", "{}")]);
    expect(await screen.findByText(FILES_MESSAGE.too_large_total)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(new Response(LOCAL_REFUSAL.forbidden, { status: 403 }));
    choose([fileOf("a.json", "{}")]);
    expect(await screen.findByText(LOCAL_REFUSAL.forbidden)).toBeInTheDocument();
    fetchMock.mockRejectedValueOnce(new Error("down SECRETTEXT"));
    choose([fileOf("a.json", "{}")]);
    expect(await screen.findByText(FILES_WORDS.serverDown)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SECRETTEXT");
    expect(onFilesOpened).not.toHaveBeenCalled();
  });

  it("refuses more than 200 files, or more than 50 MB in all, before sending anything", async () => {
    screenWith();
    choose(Array.from({ length: MAX_FILES + 1 }, (_, i) => fileOf(`f${i}.json`, "{}")));
    expect(await screen.findByText(FILES_MESSAGE.too_many_files)).toBeInTheDocument();
    choose(Array.from({ length: Math.ceil(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1 }, (_, i) => fileOf(`g${i}.json`, "{}", MAX_FILE_BYTES)));
    expect(await screen.findByText(FILES_MESSAGE.too_large_total)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a file over 5 MB by name only, so it is listed as too large and never read", async () => {
    fetchMock.mockResolvedValue(answer({ rows: [row], problems: [{ file: "big.json", reason: "too_large" }] }));
    screenWith();
    const big = fileOf("big.json", "{}", MAX_FILE_BYTES + 1);
    const read = vi.fn(async () => "{}");
    big.text = read;
    choose([big, fileOf("ok.json", "{}")]);
    await waitFor(() => expect(onFilesOpened).toHaveBeenCalled());
    expect(read).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).files[0]).toEqual({ name: "big.json", tooLarge: true });
  });

  it("uses real apostrophes, no dashes of any kind and no exclamation marks", () => {
    const words = JSON.stringify(FILES_WORDS) + Object.values(PROBLEM_REASON).join(" ") + Object.values(FILES_MESSAGE).join(" ");
    expect(words).not.toMatch(/[–—!]/);
    expect(words).not.toContain("'");
    expect(Object.values(FILES_MESSAGE).join(" ") + Object.values(PROBLEM_REASON).join(" ")).not.toMatch(/ - /);
  });
});
