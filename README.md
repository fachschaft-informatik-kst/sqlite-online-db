# SQLite Online DB

A lightweight, browser-based SQLite query tool that can be hosted on **GitHub Pages**. Upload any `.db` file and let students explore the database with SQL queries — no server, no installation, no data ever leaves the browser.

## ✨ Features

- **Drag & drop** or click-to-upload `.db` / `.sqlite` / `.sqlite3` files
- **Schema sidebar** — browse tables and columns; click a table to auto-generate a `SELECT` query
- **SQL editor** with keyboard shortcut (`Ctrl`+`Enter` / `Cmd`+`Enter` to run)
- **Results table** with row count and execution time
- **100 % client-side** — powered by [sql.js](https://sql.js.org/) (SQLite compiled to WebAssembly); data never leaves the student's browser
- Zero dependencies to install — everything is loaded from a CDN

## 🚀 Deployment (GitHub Pages)

1. Fork or clone this repository.
2. Go to **Settings → Pages** in your GitHub repository.
3. Under **Source**, select the branch (e.g. `main`) and root folder `/`.
4. Click **Save**. Your site will be published at `https://<org>.github.io/<repo>/`.

## 🛠️ Local development

Just open `index.html` in a web browser — no build step required.

> **Tip:** Some browsers restrict `file://` access to WASM. Use a local server for best results:
> ```bash
> # Python 3
> python -m http.server 8080
> # then open http://localhost:8080
> ```

## 📁 File structure

```
index.html   # Main application page
style.css    # Styles
app.js       # Application logic (file upload, SQL execution, schema display)
README.md    # This file
```

## 🙏 Credits

- [sql.js](https://github.com/sql-js/sql.js) — SQLite compiled to WebAssembly
- Inspired by [sqlime](https://github.com/nalgeon/sqlime)
