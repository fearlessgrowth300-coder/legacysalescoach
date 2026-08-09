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
    const exitTimer = window.setTimeout(() => setExiting(true), reducedMotion ? 150 : 1050);
    const completeTimer = window.setTimeout(onComplete, reducedMotion ? 250 : 1420);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div className={`app-launch-screen ${exiting ? "app-launch-screen--exit" : ""}`} aria-label="Opening Legacy Sales Coach">
      <div className="app-launch-glow" aria-hidden="true" />
      <div className="app-launch-mark" aria-hidden="true">
        <span className="app-launch-orbit app-launch-orbit--one" />
        <span className="app-launch-orbit app-launch-orbit--two" />
        <img src="/legacy-coach-512.png" alt="" />
      </div>
      <div className="app-launch-copy">
        <p>LEGACY SALES COACH</p>
        <span>Turn every conversation into confident growth</span>
      </div>
      <div className="app-launch-progress" aria-hidden="true"><span /></div>
    </div>
  );
}
