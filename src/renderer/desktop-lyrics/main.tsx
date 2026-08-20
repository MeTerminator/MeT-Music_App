import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared-fonts/fonts.css";
import "./style.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) {
    throw new Error("找不到 #root 挂载点");
}

createRoot(rootEl).render(
    <StrictMode>
        <App />
    </StrictMode>
);
