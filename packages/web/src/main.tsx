import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sync } from "./sync";
import { startFonts } from "./fonts";
import { startTheme } from "./theme";
import { startPush } from "./push";
import "./styles.css";

startTheme();
startFonts(); // TEMPORARY font tester
sync.start();
startPush();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
