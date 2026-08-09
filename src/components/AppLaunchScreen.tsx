import { useEffect, useState } from "react";

interface AppLaunchScreenProps {
  onComplete: () => void;
}

export function shouldShowAppLaunch() {
  if (typeof window === "undefined") return false;
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true;
}

export default function AppLaunchScreen({ onComplete }: AppLaunchScreenProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const exitTimer = window.setTimeout(() => setExiting(true), reducedMotion ? 150 : 1850);
    const completeTimer = window.setTimeout(onComplete, reducedMotion ? 250 : 2050);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div className={`app-launch-screen ${exiting ? "app-launch-screen--exit" : ""}`} aria-label="Opening Legacy Sales Coach">
      <video
        className="app-launch-video"
        src="/launch-animation.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = 2.15;
          void event.currentTarget.play().catch(() => undefined);
        }}
      />
    </div>
  );
}
