// SPDX-License-Identifier: BUSL-1.1

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { bootPlugins } from "./plugin-host/boot.js";
import "./index.css";

// Register every external plugin's PluginUI before the shell renders.
// Failures are logged but non-fatal (the shell still boots without
// plugin contributions). IIFE'd to avoid top-level await for the
// esbuild target.
(async () => {
  await bootPlugins();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
})();
