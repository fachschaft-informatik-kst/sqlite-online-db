// Helper for working with window.location.

import { DatabasePath } from "./db-path.js";

// path creates a database path from the window location.
function path() {
    const rawHash = window.location.hash.slice(1);
    const decodedHash = decodeURIComponent(rawHash);
    return new DatabasePath(decodedHash);
}

const locator = { path };
export default locator;
