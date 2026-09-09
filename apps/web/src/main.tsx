import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/dashboard.css";
import { requestSession } from "./auth-gate";

// Start identity lookup before React hydration and before campaign code is needed.
const sessionRequest = requestSession();
const fonts = document.getElementById("site-fonts") as HTMLLinkElement | null;
if (fonts) {
  if (fonts.sheet) fonts.media = "all";
  else fonts.addEventListener("load", () => { fonts.media = "all"; }, { once: true });
}

const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
hydrateRoot(root, <App sessionRequest={sessionRequest} />);
