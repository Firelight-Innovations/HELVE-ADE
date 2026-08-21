import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDiagnostics } from "./shell/diagnostics";
import "./styles.css";

// Before the render call, not after. An error thrown while React is mounting is
// exactly the kind this exists to catch, and a listener added afterwards would
// miss it.
installDiagnostics();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
