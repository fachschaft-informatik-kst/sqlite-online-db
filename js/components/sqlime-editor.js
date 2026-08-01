// SQL editor component
const TAB_WIDTH = 2;
const KEYWORDS = [
    "SELECT",
    "FROM",
    "WHERE",
    "INNER",
    "JOIN",
    "LEFT",
    "RIGHT",
    "FULL",
    "ON",
    "GROUP",
    "BY",
    "ORDER",
    "LIMIT",
    "INSERT",
    "INTO",
    "VALUES",
    "UPDATE",
    "SET",
    "DELETE",
    "CREATE",
    "TABLE",
    "ALTER",
    "DROP",
    "PRIMARY",
    "KEY",
    "FOREIGN",
    "REFERENCES",
    "UNIQUE",
    "NOT",
    "NULL",
    "AND",
    "OR",
    "AS",
    "COUNT",
    "SUM",
    "AVG",
    "MAX",
    "MIN",
];

class SqlimeEditor extends HTMLElement {
    connectedCallback() {
        if (!this.rendered) {
            this.render();
            this.listen();
            this.rendered = true;
        }
    }

    render() {
        this.contentEditable = "true";
        this.spellcheck = false;
    }

    listen() {
        // shortcuts
        this.addEventListener("keydown", this.onKeydown.bind(this));
        // always paste as plain text
        this.addEventListener("paste", this.onPaste.bind(this));
        // first input event
        const onInput = (event) => {
            this.dispatchEvent(new Event("start"));
            this.removeEventListener("input", onInput);
        };
        this.addEventListener("input", onInput);
    }

    // focus sets cursor at the end of the editor
    focus() {
        super.focus();
        document.execCommand("selectAll", false, null);
        document.getSelection().collapseToEnd();
    }

    // clear clears editor contents
    clear() {
        this.value = "";
    }

    onKeydown(event) {
        if (handleExecute(this, event)) return;
        if (handleAutocomplete(this, event)) return;
        if (handleIndent(this, event)) return;
    }

    onPaste(event) {
        event.preventDefault();
        // get text representation of clipboard
        const text = (event.originalEvent || event).clipboardData.getData(
            "text/plain"
        );
        // insert text manually
        document.execCommand("insertHTML", false, text);
    }

    get value() {
        return this.textContent || "";
    }
    set value(newValue) {
        this.textContent = newValue || "";
    }

    get query() {
        const selectedQuery = window.getSelection().toString().trim();
        return selectedQuery || this.value;
    }
}

// handleIndent indents text with Tab
function handleIndent(elem, event) {
    if (event.key != "Tab") {
        return false;
    }
    event.preventDefault();
    document.execCommand("insertHTML", false, " ".repeat(TAB_WIDTH));
    return true;
}

function handleAutocomplete(elem, event) {
    const isTab =
        event.key === "Tab" ||
        event.code === "Tab" ||
        event.keyCode === 9;
    if (!isTab) {
        return false;
    }
    const selection = window.getSelection();
    const cursor = getCursorPosition(selection, elem.value.length);
    const token = getCurrentToken(elem.value, cursor);
    if (!token) {
        return false;
    }
    const completion = findCompletion(token, elem);
    if (!completion || completion == token.toUpperCase()) {
        return false;
    }
    event.preventDefault();
    const { text, newCursor } = replaceToken(elem.value, token, completion, cursor);
    elem.value = text;
    setCursorPosition(elem, newCursor);
    return true;
}

function getCurrentToken(text, cursor = text.length) {
    const before = text.slice(0, cursor);
    const match = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    return match ? match[1] : "";
}

function findCompletion(token, elem) {
    const normalized = token.toUpperCase();
    const options = [];
    const known = new Set(KEYWORDS);
    if (elem.schema) {
        for (const table of Object.keys(elem.schema)) {
            known.add(table.toUpperCase());
            for (const column of elem.schema[table] || []) {
                known.add(column.toUpperCase());
            }
        }
    }
    for (const word of known) {
        if (word.startsWith(normalized)) {
            options.push(word);
        }
    }
    if (!options.length) {
        return null;
    }
    options.sort();
    return options[0];
}

function replaceToken(text, token, completion, cursor) {
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const tokenStart = before.lastIndexOf(token);
    if (tokenStart < 0) {
        return { text, newCursor: cursor };
    }
    const newText = before.slice(0, tokenStart) + completion + after;
    const newCursor = tokenStart + completion.length;
    return { text: newText, newCursor };
}

function getCursorPosition(selection, fallback) {
    if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        if (Number.isFinite(range.startOffset)) {
            return range.startOffset;
        }
    }
    return fallback;
}

function setCursorPosition(elem, position) {
    const selection = window.getSelection();
    const range = document.createRange();
    const textNode = elem.firstChild || elem.ownerDocument.createTextNode("");
    if (!elem.firstChild) {
        elem.appendChild(textNode);
    }
    const offset = Math.min(position, textNode.textContent.length);
    range.setStart(textNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

// handleExecute triggers 'execute' event by Ctrl/Cmd+Enter
function handleExecute(elem, event) {
    // Ctrl+Enter or Cmd+Enter
    if (!event.ctrlKey && !event.metaKey) {
        return false;
    }
    // 10 and 13 are Enter codes
    if (event.keyCode != 10 && event.keyCode != 13) {
        return false;
    }

    event.preventDefault();
    elem.dispatchEvent(new CustomEvent("execute", { detail: elem.query }));
    return true;
}

if (!window.customElements.get("sqlime-editor")) {
    window.SqlimeEditor = SqlimeEditor;
    customElements.define("sqlime-editor", SqlimeEditor);
}
