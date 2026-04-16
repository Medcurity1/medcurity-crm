import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";
import { initTheme } from "./hooks/useTheme";

// Apply saved light/dark theme before first paint to avoid flash.
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
