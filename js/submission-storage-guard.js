// A submitted link is a reproducible review snapshot, not the teacher's
// editable Gist workspace. Do not let opening it overwrite the Gist's tabs.
import storage from "./storage.js";

const originalSet = storage.set.bind(storage);
const originalSetTabs = storage.setTabs.bind(storage);

function reviewingSubmission() {
    return window.location.hash.startsWith("#submission=");
}

storage.set = (name, sql) => {
    if (!reviewingSubmission()) return originalSet(name, sql);
};

storage.setTabs = (name, tabs) => {
    if (!reviewingSubmission()) return originalSetTabs(name, tabs);
};
