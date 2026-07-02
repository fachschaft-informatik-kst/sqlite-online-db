/* ============================================================
   SQLite Online DB – app.js
   Uses sql.js (SQLite compiled to WebAssembly) to run SQLite
   queries directly in the browser without any server.
   ============================================================ */

(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────
  let db = null;
  let SQL = null;

  // ── DOM refs ─────────────────────────────────────────────
  const uploadArea   = document.getElementById("upload-area");
  const fileInput    = document.getElementById("file-input");
  const dbInfo       = document.getElementById("db-info");
  const dbNameEl     = document.getElementById("db-name");
  const workspace    = document.getElementById("workspace");
  const schemaList   = document.getElementById("schema-list");
  const sqlEditor    = document.getElementById("sql-editor");
  const runBtn       = document.getElementById("run-btn");
  const clearBtn     = document.getElementById("clear-btn");
  const resultsArea  = document.getElementById("results-area");
  const loadingEl    = document.getElementById("loading");

  // ── Initialise sql.js ────────────────────────────────────
  async function initSqlJs() {
    showLoading(true);
    try {
      SQL = await initSqlJsLib({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/${file}`,
      });
    } catch (err) {
      showError(resultsArea, "Failed to load sql.js engine: " + err.message);
    } finally {
      showLoading(false);
    }
  }

  // ── File upload handling ──────────────────────────────────
  uploadArea.addEventListener("click", () => fileInput.click());

  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });

  uploadArea.addEventListener("dragleave", () =>
    uploadArea.classList.remove("drag-over")
  );

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  document.getElementById("close-db-btn").addEventListener("click", closeDb);

  // ── Load a .db file ──────────────────────────────────────
  async function loadFile(file) {
    if (!SQL) {
      showError(resultsArea, "sql.js engine is not ready yet. Please wait a moment and try again.");
      return;
    }

    showLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes  = new Uint8Array(buffer);

      // Close existing DB if open
      if (db) db.close();

      db = new SQL.Database(bytes);

      dbNameEl.textContent = file.name;
      dbInfo.classList.add("visible");
      workspace.classList.add("visible");

      renderSchema();
      clearResults();
      sqlEditor.focus();
    } catch (err) {
      showError(resultsArea, "Could not open database: " + err.message);
    } finally {
      showLoading(false);
      fileInput.value = "";
    }
  }

  function closeDb() {
    if (db) { db.close(); db = null; }
    dbInfo.classList.remove("visible");
    workspace.classList.remove("visible");
    schemaList.innerHTML = "";
    clearResults();
  }

  // ── Schema inspection ────────────────────────────────────
  function renderSchema() {
    schemaList.innerHTML = "";

    const tables = getTables();
    if (tables.length === 0) {
      schemaList.innerHTML = '<li style="color:var(--color-text-muted);font-size:.85rem;">No tables found</li>';
      return;
    }

    tables.forEach((tbl) => {
      const cols  = getColumns(tbl);
      const li    = document.createElement("li");

      const nameEl = document.createElement("span");
      nameEl.className = "table-name";
      nameEl.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
        </svg>
        ${escHtml(tbl)}`;
      nameEl.title = "Click to SELECT from this table";
      nameEl.addEventListener("click", () => {
        sqlEditor.value = `SELECT * FROM ${escSqlIdentifier(tbl)} LIMIT 100;`;
        runQuery();
      });

      const colUl = document.createElement("ul");
      colUl.className = "col-list";
      cols.forEach((c) => {
        const colLi = document.createElement("li");
        colLi.innerHTML = `${escHtml(c.name)} <span class="col-type">${escHtml(c.type || "")}</span>`;
        colUl.appendChild(colLi);
      });

      li.appendChild(nameEl);
      li.appendChild(colUl);
      schemaList.appendChild(li);
    });
  }

  function getTables() {
    try {
      const res = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
      );
      if (!res.length) return [];
      return res[0].values.map((r) => r[0]);
    } catch (_) {
      return [];
    }
  }

  function getColumns(tableName) {
    try {
      const res = db.exec(`PRAGMA table_info(${escSqlIdentifier(tableName)})`);
      if (!res.length) return [];
      const nameIdx = res[0].columns.indexOf("name");
      const typeIdx = res[0].columns.indexOf("type");
      return res[0].values.map((r) => ({ name: r[nameIdx], type: r[typeIdx] }));
    } catch (_) {
      return [];
    }
  }

  // ── Query execution ──────────────────────────────────────
  runBtn.addEventListener("click", runQuery);
  clearBtn.addEventListener("click", () => {
    sqlEditor.value = "";
    clearResults();
    sqlEditor.focus();
  });

  sqlEditor.addEventListener("keydown", (e) => {
    // Ctrl+Enter / Cmd+Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
    // Tab inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const s = sqlEditor.selectionStart;
      const v = sqlEditor.value;
      sqlEditor.value = v.slice(0, s) + "  " + v.slice(sqlEditor.selectionEnd);
      sqlEditor.selectionStart = sqlEditor.selectionEnd = s + 2;
    }
  });

  function runQuery() {
    if (!db) {
      showError(resultsArea, "No database loaded. Please upload a .db file first.");
      return;
    }

    const sql = sqlEditor.value.trim();
    if (!sql) return;

    runBtn.disabled = true;
    clearResults();

    try {
      const t0   = performance.now();
      const rows = db.exec(sql);
      const ms   = (performance.now() - t0).toFixed(1);

      if (rows.length === 0) {
        // DDL / DML with no result set
        resultsArea.innerHTML = `<div class="result-meta">Query executed successfully in <strong>${ms} ms</strong>.</div>`;
      } else {
        renderResults(rows, ms);
      }
    } catch (err) {
      showError(resultsArea, err.message);
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderResults(rows, ms) {
    const fragment = document.createDocumentFragment();

    rows.forEach((result, idx) => {
      const meta = document.createElement("div");
      meta.className = "result-meta";
      const rowCount = result.values.length;
      meta.innerHTML =
        (rows.length > 1 ? `<strong>Result set ${idx + 1}</strong> — ` : "") +
        `<span class="count">${rowCount} row${rowCount !== 1 ? "s" : ""}</span>` +
        ` returned in <strong>${ms} ms</strong>`;
      fragment.appendChild(meta);

      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";

      const tbl  = document.createElement("table");
      const head = document.createElement("thead");
      const hRow = document.createElement("tr");
      result.columns.forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        hRow.appendChild(th);
      });
      head.appendChild(hRow);
      tbl.appendChild(head);

      const body = document.createElement("tbody");
      result.values.forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
          const td = document.createElement("td");
          if (cell === null || cell === undefined) {
            td.textContent = "NULL";
            td.className   = "null";
          } else {
            td.textContent = String(cell);
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      tbl.appendChild(body);
      wrapper.appendChild(tbl);
      fragment.appendChild(wrapper);
    });

    resultsArea.appendChild(fragment);
  }

  // ── Helpers ──────────────────────────────────────────────
  function clearResults() {
    resultsArea.innerHTML = "";
  }

  function showError(container, msg) {
    container.innerHTML = `
      <div class="error-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escHtml(msg)}</span>
      </div>`;
  }

  function showLoading(on) {
    loadingEl.classList.toggle("visible", on);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Escape a string for use as a double-quoted SQL identifier.
   * Double-quote characters inside the identifier are doubled per the SQL standard.
   */
  function escSqlIdentifier(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  // ── Boot ─────────────────────────────────────────────────
  initSqlJs();
})();
