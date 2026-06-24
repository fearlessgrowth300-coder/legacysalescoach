import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js?v=clear-stale-app-cache-20260624")
      .catch((error) => console.warn("Service worker cleanup failed", error));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
