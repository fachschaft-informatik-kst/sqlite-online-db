import { OpenAI } from "./cloud/openai.js?v=20260913-2";

function getStorageItem(storage, key) {
    try {
        return storage.getItem(key) || "";
    } catch (error) {
        return "";
    }
}

function getSavedApiKey() {
    return (
        getStorageItem(localStorage, "openai.apikey") ||
        getStorageItem(sessionStorage, "openai.apikey")
    ).trim();
}

async function handleAskAi(event) {
    const button = event.target.closest("button[data-action='askAi']");
    if (!button) {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const key = getSavedApiKey();
    if (!key) {
        window.location.assign("settings.html");
        return;
    }

    const app = window.app;
    if (!app || !app.ui) {
        return;
    }

    const ui = app.ui;
    const ai = new OpenAI(key);
    const question = ui.editor.query;

    button.disabled = true;
    ui.status.loading("Waiting for AI response...");

    const startedAt = performance.now();
    try {
        const answer = await ai.ask(question);
        const elapsed = (performance.now() - startedAt) / 1000;
        ui.status.success(`AI response, took ${elapsed.toFixed(1)} sec:`);
        ui.result.printMarkdown(answer);
    } catch (err) {
        ui.status.error(err instanceof Error ? err.message : String(err));
        ui.result.clear();
    } finally {
        button.disabled = false;
    }
}

document.addEventListener("click", handleAskAi, true);
