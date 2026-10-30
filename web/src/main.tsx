import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { currentTheme, notifyHostTheme } from "./mode";
import "./brand/tokens.css";
import "./styles/app.css";

notifyHostTheme(currentTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
