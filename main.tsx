import { createRoot } from "react-dom/client";

import "./app/source-compat.css";
import "./app/reader-system.css";
import ReaderPage from "./app/page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Reader root element is missing");
}

createRoot(root).render(<ReaderPage />);
