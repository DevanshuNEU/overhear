import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONNECT_MESSAGE, LOCAL_REFUSAL } from "@/pull/labels";
import { CONNECT_WORDS, ConnectScreen } from "./ConnectScreen";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const KEY = "key_0123456789abcdef0123456789ab";
const LOCATION = "~/.overhear/config.json";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function failure(error: keyof typeof CONNECT_MESSAGE, status: number): Response {
  return answer({ connected: false, error, message: CONNECT_MESSAGE[error] }, status);
}

const field = () => screen.getByLabelText(CONNECT_WORDS.fieldLabel) as HTMLInputElement;
const send = () => fireEvent.click(screen.getByRole("button", { name: CONNECT_WORDS.connect }));

function paste(value = KEY) {
  fireEvent.change(field(), { target: { value } });
}

describe("the connect screen, empty", () => {
  it("asks for one thing and says the key stays on this computer and goes only to Retell", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(CONNECT_WORDS.headline);
    expect(h1).toHaveTextContent(CONNECT_WORDS.promise);
    expect(CONNECT_WORDS.promise).toMatch(/stays on this computer/);
    expect(CONNECT_WORDS.promise).toMatch(/sent only to Retell/);
    expect(field()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CONNECT_WORDS.connect })).toBeEnabled();
  });

  it("says where the key is saved and how to remove it", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    const facts = screen.getByLabelText(CONNECT_WORDS.factsLabel);
    expect(facts).toHaveTextContent(LOCATION);
    expect(facts).toHaveTextContent(CONNECT_WORDS.sentToValue);
    expect(facts).toHaveTextContent(CONNECT_WORDS.removeValue);
  });

  it("masks the field and keeps it out of password managers and spell check", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("autocomplete", "off");
    expect(field()).toHaveAttribute("spellcheck", "false");
  });

  it("gives the field no name, so a form sent without the script puts nothing in the URL", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    expect(field()).not.toHaveAttribute("name");
    expect(field().closest("form")).toHaveAttribute("method", "post");
  });

  it("asks for a key when sent empty, without calling the server", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    send();
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.bad_request);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });

  it("treats spaces as empty", () => {
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste("   ");
    send();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checking", () => {
  it("posts the trimmed key as JSON to /api/connect, and only there", async () => {
    let release: (res: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste(`  ${KEY}\n`);
    send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/connect");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ key: KEY });

    // While Retell is asked: the button says so, cannot be used twice, and the field cannot be edited.
    const button = screen.getByRole("button", { name: CONNECT_WORDS.checking });
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.checkingStatus);
    expect(field()).toHaveAttribute("readonly");
    fireEvent.submit(field().closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => release(answer({ connected: true })));
  });
});

describe("a key Retell does not accept", () => {
  it("says so, says what to do, and puts the person back in the field", async () => {
    fetchMock.mockResolvedValue(failure("bad_key", 422));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.bad_key));
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.badKeyNext);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveFocus();
    expect(screen.getByRole("button", { name: CONNECT_WORDS.connect })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the message with a typographic apostrophe", () => {
    expect(CONNECT_MESSAGE.bad_key).toBe("Retell didn’t accept this key.");
  });
});

describe("Retell cannot be reached", () => {
  it("says so in the server's words and keeps the pasted key so a retry needs no second paste", async () => {
    fetchMock.mockResolvedValue(failure("unreachable", 502));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.unreachable));
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field().value).toBe(KEY);
  });
});

describe("other answers", () => {
  it("shows the key store's own words when it cannot save", async () => {
    fetchMock.mockResolvedValue(failure("store_failed", 500));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.store_failed));
    expect(screen.getByRole("status")).toHaveTextContent(LOCATION);
  });

  it("shows the local check's refusal when it is plain text", async () => {
    fetchMock.mockResolvedValue(answer(LOCAL_REFUSAL.forbidden, 403));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(LOCAL_REFUSAL.forbidden));
  });

  it("never shows text it does not know, whatever the answer says", async () => {
    fetchMock.mockResolvedValue(answer({ connected: false, error: "x", message: `echoed ${KEY}` }, 500));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.serverDown));
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("says Overhear itself cannot be reached when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.serverDown));
  });

  it("shows why the key store would not open, before anything is pasted", () => {
    render(<ConnectScreen stored={false} location={LOCATION} storeError="home_unsafe" />);
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.home_unsafe);
  });
});

describe("connected", () => {
  it("says it worked, empties the field, asks the page to refresh and says what comes next", async () => {
    fetchMock.mockResolvedValue(answer({ connected: true }));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    const h1 = await screen.findByRole("heading", { level: 1, name: new RegExp(CONNECT_WORDS.connectedHeadline) });
    expect(h1).toHaveTextContent(CONNECT_WORDS.connectedPromise);
    expect(h1).toHaveFocus();
    expect(screen.getByText(CONNECT_WORDS.connectedNext)).toBeInTheDocument();
    expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    // The facts about where the key lives stay on screen.
    expect(screen.getByLabelText(CONNECT_WORDS.factsLabel)).toHaveTextContent(LOCATION);
  });

  it("opens connected when a key is already saved", () => {
    render(<ConnectScreen stored location={LOCATION} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CONNECT_WORDS.connectedHeadline);
    expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the key never leaves the field", () => {
  it("is not in the page, the URL or any text on screen at any step", async () => {
    window.history.replaceState(null, "", "/");
    fetchMock.mockResolvedValueOnce(failure("bad_key", 422)).mockResolvedValueOnce(answer({ connected: true }));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    expect(document.body.textContent).not.toContain(KEY);
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.bad_key));
    expect(document.body.textContent).not.toContain(KEY);
    expect(window.location.href).not.toContain(KEY);
    send();
    await screen.findByText(CONNECT_WORDS.connectedNext);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(window.location.href).not.toContain(KEY);
    expect(window.location.search).toBe("");
  });

  it("is never logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    fetchMock.mockResolvedValue(failure("bad_key", 422));
    render(<ConnectScreen stored={false} location={LOCATION} />);
    paste();
    send();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.bad_key));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
      spy.mockRestore();
    }
  });
});

describe("the words", () => {
  it("has no em dash, en dash or straight quote in any string on screen", () => {
    const strings = [...Object.values(CONNECT_WORDS), ...Object.values(CONNECT_MESSAGE), ...Object.values(LOCAL_REFUSAL)];
    for (const s of strings) {
      expect(s, s).not.toMatch(/[\u2013\u2014"']/);
    }
  });
});
