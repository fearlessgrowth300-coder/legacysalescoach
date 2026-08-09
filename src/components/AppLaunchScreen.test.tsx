import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppLaunchScreen, { shouldShowAppLaunch } from "@/components/AppLaunchScreen";

afterEach(() => {
  vi.useRealTimers();
});

describe("AppLaunchScreen", () => {
  it("only enables the branded transition in an installed app", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(display-mode: standalone)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(shouldShowAppLaunch()).toBe(true);
    window.matchMedia = originalMatchMedia;
  });

  it("finishes the animated transition and opens the app", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<AppLaunchScreen onComplete={onComplete} />);

    expect(screen.getByLabelText("Opening Legacy Sales Coach")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1420);
    });

    expect(onComplete).toHaveBeenCalledOnce();
  });
});
