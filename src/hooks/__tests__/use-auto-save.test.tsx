import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoSave } from "../use-auto-save";

afterEach(() => vi.useRealTimers());

it("persists edits made while an earlier save is in flight", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const hook = renderHook(({ content }) => useAutoSave(content, onSave, 100), {
    initialProps: { content: "initial" },
  });
  hook.rerender({ content: "edit A" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  hook.rerender({ content: "edit B" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  await act(async () => {
    finish();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(onSave.mock.calls.map((call) => call[0])).toEqual(["edit A", "edit B"]);
});

it("flushes the latest edit when unmounted during an in-flight save", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const hook = renderHook(({ content }) => useAutoSave(content, onSave, 100), {
    initialProps: { content: "initial" },
  });
  hook.rerender({ content: "edit A" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  hook.rerender({ content: "edit B" });
  hook.unmount();
  await act(async () => {
    finish();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(onSave.mock.calls.map((call) => call[0])).toEqual(["edit A", "edit B"]);
});

it("does not save a freshly loaded document", async () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useAutoSave("Loaded content", onSave, 100));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  hook.unmount();
  expect(onSave).not.toHaveBeenCalled();
});

it("retains failed content and retries it explicitly", async () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const hook = renderHook(({ content }) => useAutoSave(content, onSave, 100), {
    initialProps: { content: "initial" },
  });
  hook.rerender({ content: "edit" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.result.current.error).toBe("Offline");
  expect(hook.result.current.status).toBe("unsaved");
  await act(async () => {
    await hook.result.current.flush();
  });
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(hook.result.current.status).toBe("saved");
  expect(hook.result.current.error).toBeNull();
});

it("saves a revert made during an in-flight request", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const hook = renderHook(({ content }) => useAutoSave(content, onSave, 100), {
    initialProps: { content: "initial" },
  });
  hook.rerender({ content: "edit" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  hook.rerender({ content: "initial" });
  await act(async () => {
    finish();
  });
  expect(onSave.mock.calls.map((call) => call[0])).toEqual(["edit", "initial"]);
});
