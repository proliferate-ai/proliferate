import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { WebCloudProvider } from "./providers/WebCloudProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WebCloudProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </WebCloudProvider>
  </React.StrictMode>,
);
