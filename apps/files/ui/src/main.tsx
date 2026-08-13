import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// See the note in `apps/home/ui/src/main.tsx`: root-relative so Vite resolves
// both against the project root, and so an app draws from the shell's palette
// rather than a copy of it.
import "/src/tokens.css";
import "/apps/shared/app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
