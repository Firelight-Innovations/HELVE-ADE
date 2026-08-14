import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// See the note in `apps/home/ui/src/main.tsx`: root-relative so Vite resolves
// both against the project root, and so an app draws from the shell's palette
// rather than a copy of it.
import "/src/tokens.css";
import "/apps/shared/app.css";
// Files draws a tree, a splitter and an editor — none of which the shared
// sheet describes, and none of which the other app wants. `apps/shared/app.css`
// says an app that needs more adds a stylesheet of its own; this is that.
import "./files.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
