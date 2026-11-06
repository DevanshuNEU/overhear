import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyId } from "./CopyId";

describe("CopyId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  const click = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy call ID" }));
    });
  };

  it("copies the call id and says so", async () => {
    render(<CopyId value="call_abc" />);
    await click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("call_abc");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("says Copied for a moment, then stops", async () => {
    render(<CopyId value="call_abc" />);
    await click();
    await act(async () => void vi.advanceTimersByTime(1900));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("restarts the wait on each copy, so a second copy is not cut short by the first one's timer", async () => {
    render(<CopyId value="call_abc" />);
    await click();
    await act(async () => void vi.advanceTimersByTime(1000));
    await click();
    await act(async () => void vi.advanceTimersByTime(1000)); // 2000 since the first copy, 1000 since the second
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    await act(async () => void vi.advanceTimersByTime(900)); // 1900 since the second
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("leaves no timer running after it goes away", async () => {
    const { unmount } = render(<CopyId value="call_abc" />);
    await click();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
