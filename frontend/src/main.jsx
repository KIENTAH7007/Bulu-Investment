import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Entry from "./Entry.jsx";

// /add is the phone-friendly quick-entry page; everything else is the main app.
const isEntryPage = window.location.pathname.replace(/\/+$/, "") === "/add";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{isEntryPage ? <Entry /> : <App />}</React.StrictMode>
);
