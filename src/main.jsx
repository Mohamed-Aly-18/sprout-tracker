import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// Explicit service-worker registration (auto-injection is disabled in
// vite.config.js) so an already-open session always reloads onto the latest
// deployed version instead of silently continuing to run stale JS after an
// update lands — this is what was letting an old and new version of the app
// run at once and appear as duplicated UI.
if ("serviceWorker" in navigator) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          window.location.reload();
        },
      });
    })
    .catch(() => {
      // PWA plugin not available in this environment (e.g. local `vite dev`
      // without a build) — safe to ignore.
    });
}
