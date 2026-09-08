import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/dashboard.css";

const root = document.getElementById("app");
if (!root) throw new Error("The application root is missing.");
hydrateRoot(root, <App />);
