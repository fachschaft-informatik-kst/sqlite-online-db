import { assert, log, mock, unmock, summary, wait } from "./tester.js";

const LONG_DELAY = 1000;
const MEDIUM_DELAY = 500;
const SMALL_DELAY = 100;

const EMPTY_SCHEMA = `BEGIN TRANSACTION;
PRAGMA writable_schema=ON;
CREATE TABLE IF NOT EXISTS sqlean_define(name text primary key, type text, body text);
PRAGMA writable_schema=OFF;
COMMIT;`;

async function testNewDatabase() {
    log("New database...");
    const app = await loadApp();
    const h1 = app.document.querySelector(".header h1");
    assert(
        "shows header",
        h1.innerText.trim() == "SQLite Playground  // new.db"
    );
    assert("editor is empty", app.ui.editor.value == "");
    assert(
        "command bar is disabled",
        app.ui.commandbar.classList.contains("sqlime-disabled")
    );
    assert("shows welcome text", app.ui.status.value.includes("demo database"));
    assert("result is empty", app.ui.result.innerText == "");
}

async function testExecuteQuery() {
    log("Execute query...");
    const app = await loadApp();
    const sql = "select 'hello' as message";
    // activate buttons
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = sql;
    app.ui.buttons.execute.click();
    await wait(MEDIUM_DELAY);
    assert("shows result", app.ui.result.innerText.includes("hello"));
    assert("shows query in editor", app.ui.editor.value == sql);
    assert(
        "caches query in local storage",
        localStorage.getItem("sqlime.query.new.db") == sql
    );
}

async function testExecuteSelection() {
    log("Execute selection...");
    const app = await loadApp();
    const sql = "select 54321, 17423";
    // activate buttons
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = sql;
    selectText(app, app.ui.editor, 0, 12);
    app.ui.buttons.execute.click();
    await wait(MEDIUM_DELAY);
    assert("executes selected part", app.ui.result.innerText.includes("54321"));
    assert("ignores other parts", !app.ui.result.innerText.includes("17423"));
    assert(
        "caches query in local storage",
        localStorage.getItem("sqlime.query.new.db") == sql.substring(0, 12)
    );
}

async function testExecuteShowsLoadingState() {
    log("Execute shows loading state...");
    const app = await loadApp();
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = "select 1 as value";
    app.ui.buttons.execute.click();
    assert(
        "shows loading widget",
        app.ui.status.classList.contains("sqlime-status--loading")
    );
    assert(
        "shows executing message",
        app.ui.status.value.includes("Executing query")
    );
}

async function testExecuteMultilineJoin() {
    log("Execute multiline join...");
    const app = await loadApp();
        const sql = `create table departments (id integer primary key, name text);
create table employees (name text, department_id integer);
insert into departments values (1, 'Engineering');
insert into employees values ('Diane', 1);
select e.name as employee_name,
  d.name as department_name
from employees as e
  left join departments as d on d.id = e.department_id`;
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = sql;
    app.ui.buttons.execute.click();
    await wait(MEDIUM_DELAY);
    assert(
        "preserves multiline aliases and join in local storage",
        localStorage.getItem("sqlime.query.new.db") == sql
    );
    assert(
        "keeps multiline aliases and join in editor",
        app.ui.editor.value == sql
    );
    assert("executes multiline aliases and join", app.ui.result.innerText.includes("Diane"));
}

async function testSyntaxHighlighting() {
    log("Syntax highlighting...");
    const app = await loadApp();
    app.ui.editor.value = "-- note\nselect 'hello' as message where id = 42";
    assert(
        "highlights SQL keywords",
        app.ui.editor.highlight.querySelectorAll(".sqlime-editor__keyword").length >= 3
    );
    assert(
        "highlights SQL strings",
        app.ui.editor.highlight.querySelectorAll(".sqlime-editor__string").length == 1
    );
    assert(
        "highlights SQL comments",
        app.ui.editor.highlight.querySelectorAll(".sqlime-editor__comment").length == 1
    );
}

async function testQueryTabs() {
    log("Query tabs...");
    const app = await loadApp();
    app.ui.editor.input.value = "select 1 as first_query";
    app.ui.editor.input.dispatchEvent(new Event("input", { bubbles: true }));
    app.ui.queryTabs.querySelector("[data-query-tab-new]").click();
    app.ui.editor.input.value = "select 2 as second_query";
    app.ui.editor.input.dispatchEvent(new Event("input", { bubbles: true }));
    app.ui.queryTabs.querySelector('[data-query-tab-id="query-1"]').click();
    assert("restores SQL from the first query tab", app.ui.editor.value.includes("first_query"));
    app.ui.queryTabs.querySelector('[data-query-tab-id^="query-"]:not([data-query-tab-id="query-1"])').click();
    assert("restores SQL from the second query tab", app.ui.editor.value.includes("second_query"));
    assert(
        "persists query tabs",
        JSON.parse(localStorage.getItem("sqlime.tabs.new.db")).length == 2
    );
}

async function testQueryTabNamesAndClosing() {
    log("Query tab names and closing...");
    const app = await loadApp();
    app.ui.queryTabs.querySelector("[data-query-tab-new]").click();
    const name = app.ui.queryTabs.querySelector("[data-query-tab-name]");
    name.value = "Quarterly Report.sql";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    const tabs = JSON.parse(localStorage.getItem("sqlime.tabs.new.db"));
    assert("removes SQL extension from tab name", tabs[1].name == "Quarterly Report");

    const close = app.ui.queryTabs.querySelector('[data-query-tab-close^="query-"]:not([data-query-tab-close="query-1"])');
    close.click();
    assert(
        "closes the active query tab",
        JSON.parse(localStorage.getItem("sqlime.tabs.new.db")).length == 1
    );
    app.ui.queryTabs.querySelector('[data-query-tab-close="query-1"]').click();
    assert("clearing the last tab keeps one tab", app.ui.editor.value == "");
}

async function testDownloadSql() {
    log("Download SQL...");
    const app = await loadApp();
    const sql = "select 42 as downloaded_value";
    app.ui.editor.value = sql;
    let downloadedBlob;
    const createObjectUrl = app.window.URL.createObjectURL;
    app.window.URL.createObjectURL = (blob) => {
        downloadedBlob = blob;
        return createObjectUrl(blob);
    };
    await app.actions.downloadSql();
    assert("creates a SQL download", downloadedBlob.type == "text/sql;charset=utf-8");
    assert(
        "downloads the active query text",
        downloadedBlob.size == new TextEncoder().encode(sql).length
    );
    app.window.URL.createObjectURL = createObjectUrl;
}

async function testDownloadSqlFilename() {
    log("Download SQL filename...");
    const app = await loadApp();
    const name = app.ui.queryTabs.querySelector("[data-query-tab-name]");
    name.value = "Class Project.sql";
    name.dispatchEvent(new Event("change", { bubbles: true }));
    let filename;
    const click = app.window.HTMLAnchorElement.prototype.click;
    app.window.HTMLAnchorElement.prototype.click = function () {
        filename = this.download;
    };
    await app.actions.downloadSql();
    assert("sanitizes the SQL download filename", filename == "class-project.sql");
    app.window.HTMLAnchorElement.prototype.click = click;
}

async function testCommandBarStacking() {
    log("Command bar stacking...");
    const app = await loadApp();
    const style = app.window.getComputedStyle(app.ui.commandbar);
    assert("keeps command bar above the editor", style.zIndex == "2");
}

async function testImportAndCommandIcons() {
    log("Import and command icons...");
    const app = await loadApp();
    assert("accepts SQL query files", app.ui.toolbar.file.accept.includes(".sql"));
    assert("run icon appears before its text", app.ui.buttons.execute.firstElementChild.tagName == "svg");
    assert(
        "download button has an icon",
        app.document.querySelector("#download-sql svg") !== null
    );
}

async function testLoadDemo() {
    log("Load demo...");
    const app = await loadApp();
    const btn = app.ui.status.querySelector('[data-action="loadDemo"]');
    btn.click();
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    assert("loads the demo database", app.ui.name.value == "demo.db");
    assert("shows the demo table count", app.ui.status.value == "2 tables:");
    assert("shows the demo tables", app.ui.result.innerText.includes("employees"));
}

async function testLoadUrl() {
    log("Load url...");
    const app = await loadApp();
    app.window.location.assign("../index.html#demo.db");
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    assert("shows database name", app.ui.name.value == "demo.db");
    app.ui.buttons.showTables.click();
    await wait(MEDIUM_DELAY);
    assert("shows tables", app.ui.status.value == "2 tables:");
}

async function testLoadUrlInvalid() {
    log("Load invalid url...");
    const app = await loadApp();
    app.window.location.assign("../index.html#whatever");
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    assert("shows error", app.ui.status.value.includes("Failed to load"));
    assert("editor is empty", app.ui.editor.value == "");
    assert("result is empty", app.ui.result.innerText == "");
}

async function testLoadUrlShowsSchemaView() {
    log("Load url shows schema view...");
    const app = await loadApp();
    const cachedQuery = "select 1 as value";
    localStorage.setItem("sqlime.query.demo.db", cachedQuery);
    app.window.location.assign("../index.html#demo.db");
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    assert("shows database name", app.ui.name.value == "demo.db");
    assert("shows schema view", app.ui.status.value == "2 tables:");
    assert("shows demo table list", app.ui.result.innerText.includes("employees"));
    assert("shows cached query in editor", app.ui.editor.value == cachedQuery);
    assert(
        "keeps cached query in storage",
        localStorage.getItem("sqlime.query.demo.db") == cachedQuery
    );
}

async function testLoadUrlWithoutCachedQueryShowsEmptyEditor() {
    log("Load url without cached query...");
    const app = await loadApp();
    app.window.location.assign("../index.html#demo.db");
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    assert("shows schema view", app.ui.status.value == "2 tables:");
    assert("editor stays empty without cached query", app.ui.editor.value == "");
}

async function testLoadGist() {
    log("Load gist...");
    const app = await loadApp();
    app.window.location.assign(
        "../index.html#gist:e012594111ce51f91590c4737e41a046"
    );
    await wait(LONG_DELAY);
    refreshApp(app);
    assert("shows database name", app.ui.name.value == "employees.en.db");
    assert("shows tables view", app.ui.status.value.includes("tables:"));
    assert("shows table list", app.ui.result.innerText.includes("employees"));
}

async function testLoadGistEncodedHash() {
    log("Load gist encoded hash...");
    const app = await loadApp();
    app.window.location.assign(
        "../index.html#gist%3Ae012594111ce51f91590c4737e41a046"
    );
    await wait(LONG_DELAY);
    refreshApp(app);
    assert("shows database name", app.ui.name.value == "employees.en.db");
    assert("shows tables view", app.ui.status.value.includes("tables:"));
    assert("shows table list", app.ui.result.innerText.includes("employees"));
}

async function testLoadGistInvalid() {
    log("Load invalid gist...");
    const app = await loadApp();
    app.window.location.assign("../index.html#gist:42");
    await wait(LONG_DELAY);
    refreshApp(app);
    assert("shows error", app.ui.status.value.includes("Failed to load"));
    assert("editor is empty", app.ui.editor.value == "");
    assert("result is empty", app.ui.result.innerText == "");
}

async function testShowTables() {
    log("Show tables...");
    const app = await loadApp();
    app.window.location.assign("../index.html#demo.db");
    await wait(MEDIUM_DELAY);
    refreshApp(app);
    app.ui.buttons.showTables.click();
    await wait(MEDIUM_DELAY);
    assert("shows table count", app.ui.status.value == "2 tables:");
    assert("shows table list", app.ui.result.innerText.includes("employees"));
    await app.actions.showTable("employees");
    await wait(MEDIUM_DELAY);
    assert("shows table navbar", app.ui.status.value == "tables / employees:");
    assert(
        "shows table columns",
        app.ui.result.innerText.includes("department")
    );
}

async function testSaveEmpty() {
    log("Save empty snippet...");
    const app = await loadApp();
    mock(app.gister, "hasCredentials", () => true);

    // activate buttons
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = "";
    app.ui.buttons.save.click();
    await wait(MEDIUM_DELAY);
    assert(
        "fails to save empty snippet",
        app.ui.status.value.startsWith("Failed to save")
    );
    unmock(app.gister, "hasCredentials");
}

async function testSave() {
    log("Save snippet...");
    const app = await loadApp();
    mock(app.gister, "hasCredentials", () => true);

    mock(app.gister, "create", (name, schema, query) => {
        assert("before save: database name is not set", name == "new.db");
        assert("before save: database schema is empty", schema == EMPTY_SCHEMA);
        assert("before save: database query equals query text", query == sql);
        const gist = buildGist(name, schema, query);
        return Promise.resolve(gist);
    });

    const sql = "select 'hello' as message";
    // activate buttons
    app.ui.editor.dispatchEvent(new Event("input"));
    app.ui.editor.value = sql;
    app.ui.buttons.save.click();
    await wait(MEDIUM_DELAY);
    assert(
        "after save: database named after gist id",
        app.ui.name.value == "424242.db"
    );
    assert(
        "after save: shows successful status",
        app.ui.status.value.includes("✓ Saved")
    );

    unmock(app.gister, "create");
    unmock(app.gister, "hasCredentials");
}

async function testUpdate() {
    log("Update snippet...");
    const app = await loadApp();
    mock(app.gister, "hasCredentials", () => true);

    const sql1 = "select 'created' as message";
    const sql2 = "select 'updated' as message";

    mock(app.gister, "create", (name, schema, query) => {
        const gist = buildGist(name, schema, query);
        return Promise.resolve(gist);
    });

    mock(app.gister, "update", (id, name, schema, query) => {
        assert("before save: database name is set", name == "424242.db");
        assert("before save: database schema is empty", schema == "");
        assert(
            "before save: database query equals updated text",
            query == sql2
        );
        const gist = buildGist(id, name, schema, query);
        return Promise.resolve(gist);
    });

    // activate buttons
    app.ui.editor.dispatchEvent(new Event("input"));

    // create
    app.ui.editor.value = sql1;
    app.ui.buttons.save.click();
    await wait(MEDIUM_DELAY);

    // update
    app.ui.editor.value = sql2;
    app.ui.buttons.save.click();
    await wait(MEDIUM_DELAY);

    assert(
        "after save: shows successful status",
        app.ui.status.value.includes("✓ Saved")
    );

    unmock(app.gister, "create");
    unmock(app.gister, "update");
    unmock(app.gister, "hasCredentials");
}

async function testAutocomplete() {
    log("Autocomplete...");
    const app = await loadApp();
    app.ui.editor.schema = {
        employees: ["id", "name", "department"],
    };
    app.ui.editor.value = "sel";
    app.ui.editor.input.focus();
    app.ui.editor.input.setSelectionRange(3, 3);

    app.ui.editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true })
    );

    assert("completes keyword on Tab", app.ui.editor.value == "SELECT");
}

async function testChangeName() {
    log("Change database name...");
    const app = await loadApp();
    const name = "my.db";
    app.ui.name.value = name;
    app.ui.name.dispatchEvent(new Event("change"));
    await wait(SMALL_DELAY);
    assert("shows updated name", app.ui.name.value == "my.db");
}

async function runTests() {
    log("Running tests...");
    await testNewDatabase();
    await testExecuteQuery();
    await testExecuteSelection();
    await testExecuteMultilineJoin();
    await testSyntaxHighlighting();
    await testQueryTabs();
    await testQueryTabNamesAndClosing();
    await testDownloadSql();
    await testDownloadSqlFilename();
    await testCommandBarStacking();
    await testImportAndCommandIcons();
    await testLoadDemo();
    await testLoadUrl();
    await testLoadUrlInvalid();
    await testLoadUrlWithoutCachedQueryShowsEmptyEditor();
    await testLoadUrlShowsSchemaView();
    await testLoadGist();
    await testLoadGistEncodedHash();
    await testLoadGistInvalid();
    await testShowTables();
    await testSaveEmpty();
    await testSave();
    await testUpdate();
    await testAutocomplete();
    await testChangeName();
    summary();
}

async function loadApp(timeout = LONG_DELAY) {
    localStorage.removeItem("sqlime.query.new.db");
    localStorage.removeItem("sqlime.query.demo.db");
    localStorage.removeItem("sqlime.query.employees.en.db");
    localStorage.removeItem("sqlime.tabs.new.db");
    localStorage.removeItem("sqlime.tabs.demo.db");
    localStorage.removeItem("sqlime.tabs.employees.en.db");
    const app = {};
    app.frame = document.querySelector("#app");
    const testId = Date.now();
    app.frame.src = `../index.html?test=${testId}`;
    const start = Date.now();
    while (
        !app.frame.contentWindow ||
        app.frame.contentWindow.location.search != `?test=${testId}` ||
        !app.frame.contentWindow.app ||
        !app.frame.contentWindow.app.ui.name.classList.contains("ready") ||
        typeof app.frame.contentWindow.app.ui.editor.schema != "object"
    ) {
        if (Date.now() - start > timeout) {
            break;
        }
        await wait(SMALL_DELAY);
    }
    refreshApp(app);
    return app;
}

function refreshApp(app) {
    app.window = app.frame.contentWindow;
    app.document = app.window.document;
    app.actions = app.window.app.actions;
    app.gister = app.window.app.gister;
    app.ui = app.window.app.ui;
}

function selectText(app, el, start, end) {
    el.input.focus();
    el.input.setSelectionRange(start, end);
}

function buildGist(name, schema = "", query = "") {
    return {
        id: "424242131313",
        name: name,
        owner: "test",
        schema: schema,
        query: query,
    };
}

runTests();
