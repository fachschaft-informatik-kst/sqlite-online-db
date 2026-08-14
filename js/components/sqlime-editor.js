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
        this.highlight = document.createElement("pre");
        this.highlight.className = "sqlime-editor__highlight";
        this.highlight.setAttribute("aria-hidden", "true");
        this.input = document.createElement("textarea");
        this.input.className = "sqlime-editor__input";
        this.input.placeholder = "select * from ...";
        this.input.setAttribute("aria-label", "SQL query editor");
        this.input.spellcheck = false;
        this.append(this.highlight, this.input);
        this.updateHighlight();
    }

    listen() {
        // shortcuts
        this.addEventListener("keydown", this.onKeydown.bind(this));
        // first input event
        const onInput = (event) => {
            this.dispatchEvent(new Event("start"));
            this.removeEventListener("input", onInput);
        };
        this.addEventListener("input", onInput);
        this.input.addEventListener("input", () => this.updateHighlight());
        this.input.addEventListener("scroll", () => this.syncScroll());
    }

    // focus sets cursor at the end of the editor
    focus() {
        this.input.focus();
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
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

    get value() {
        return this.input.value;
    }
    set value(newValue) {
        this.input.value = newValue || "";
        this.updateHighlight();
    }

    get query() {
        const selectedQuery = this.input.value.slice(
            this.input.selectionStart,
            this.input.selectionEnd
        );
        return (selectedQuery || this.value).replace(/\r\n?/g, "\n").trim();
    }

    updateHighlight() {
        this.highlight.innerHTML = highlightSql(this.input.value) || " ";
        this.syncScroll();
    }

    syncScroll() {
        this.highlight.scrollTop = this.input.scrollTop;
        this.highlight.scrollLeft = this.input.scrollLeft;
    }
}

function highlightSql(sql) {
    let html = "";
    let index = 0;
    while (index < sql.length) {
        if (sql.startsWith("--", index)) {
            const end = sql.indexOf("\n", index);
            const comment = sql.slice(index, end < 0 ? sql.length : end);
            html += `<span class="sqlime-editor__comment">${escapeHtml(comment)}</span>`;
            index += comment.length;
        } else if (sql[index] == "'" || sql[index] == '"') {
            const quote = sql[index];
            let end = index + 1;
            while (end < sql.length) {
                if (sql[end] == quote && sql[end + 1] == quote) {
                    end += 2;
                } else if (sql[end++] == quote) {
                    break;
                }
            }
            html += `<span class="sqlime-editor__string">${escapeHtml(sql.slice(index, end))}</span>`;
            index = end;
        } else {
            const nextToken = sql.slice(index).search(/--|['"]/);
            const end = nextToken < 0 ? sql.length : index + nextToken;
            html += highlightSqlCode(sql.slice(index, end));
            index = end;
        }
    }
    return html;
}

function highlightSqlCode(code) {
    return escapeHtml(code).replace(
        /\b(SELECT|FROM|WHERE|INNER|JOIN|LEFT|RIGHT|FULL|ON|GROUP|BY|ORDER|LIMIT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|NOT|NULL|AND|OR|AS|COUNT|SUM|AVG|MAX|MIN)\b|\b\d+(?:\.\d+)?\b/gi,
        (token) => {
            const kind = /^\d/.test(token) ? "number" : "keyword";
            return `<span class="sqlime-editor__${kind}">${token}</span>`;
        }
    );
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// handleIndent indents text with Tab
function handleIndent(elem, event) {
    if (event.key != "Tab") {
        return false;
    }
    event.preventDefault();
    const input = elem.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText(" ".repeat(TAB_WIDTH), start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
    const cursor = elem.input.selectionStart;
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

function setCursorPosition(elem, position) {
    const offset = Math.min(position, elem.value.length);
    elem.input.focus();
    elem.input.setSelectionRange(offset, offset);
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
