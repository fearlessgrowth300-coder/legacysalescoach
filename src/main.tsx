import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

if ("serviceWorker" in navigator) {
  let reloadingForFreshBundle = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForFreshBundle) return;
    reloadingForFreshBundle = true;
    window.location.reload();
  });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_swUrl, registration) {
      void registration?.update();
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
