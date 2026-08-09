import { act, fireEvent, render, screen } from "@testing-library/react";
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
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<AppLaunchScreen onComplete={onComplete} />);

    expect(screen.getByLabelText("Opening Legacy Sales Coach")).toBeInTheDocument();
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/launch-animation.mp4");
    expect(video).toHaveProperty("muted", true);
    expect(document.querySelector(".app-launch-screen img")).not.toBeInTheDocument();
    fireEvent.loadedMetadata(video!);
    expect(video).toHaveProperty("playbackRate", 2.15);
    expect(playSpy).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(2050);
    });

    expect(onComplete).toHaveBeenCalledOnce();
    playSpy.mockRestore();
  });
});
