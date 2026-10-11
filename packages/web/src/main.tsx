import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sync } from "./sync";
import { startFonts } from "./fonts";
import { startTheme } from "./theme";
import "./styles.css";

startTheme();
startFonts(); // TEMPORARY font tester
sync.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
