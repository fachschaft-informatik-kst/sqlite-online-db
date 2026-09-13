import printer from "../printer.js";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100];

// SQL result component
// shows the result of the SQL query as a paginated table
class SqlimeResult extends HTMLElement {
    constructor() {
        super();
        this.result = null;
        this.page = 1;
        this.pageSize = DEFAULT_PAGE_SIZE;

        this.addEventListener("click", (event) => this.onPagingClick(event));
        this.addEventListener("change", (event) => this.onPagingChange(event));
    }

    // print prints SQL query result as a paginated table
    print(result) {
        if (!result) {
            this.clear();
            return;
        }
        this.result = result;
        this.page = 1;
        this.renderResult();
    }

    // printTables prints table list as a table
    printTables(tables) {
        this.resetPaging();
        this.applyPrinter(tables, printer.printTables);
    }

    // printMarkdown prints markdown text
    printMarkdown(text) {
        this.resetPaging();
        this.applyPrinter(text, printer.printMarkdown);
    }

    renderResult() {
        const values = Array.isArray(this.result && this.result.values)
            ? this.result.values
            : [];
        const totalRows = values.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
        this.page = Math.min(Math.max(1, this.page), totalPages);

        const start = (this.page - 1) * this.pageSize;
        const end = Math.min(start + this.pageSize, totalRows);
        const pageResult = Object.assign({}, this.result, {
            values: values.slice(start, end),
        });

        const from = totalRows ? start + 1 : 0;
        const to = totalRows ? end : 0;
        const sizeOptions = PAGE_SIZES.map(
            (size) => `<option value="${size}" ${size == this.pageSize ? "selected" : ""}>${size}</option>`
        ).join("");

        this.innerHTML = `
<div class="sqlime-result__card">
    <div class="sqlime-result__toolbar" aria-label="Result pagination">
        <div class="sqlime-result__summary">
            <strong>${from}–${to}</strong> of <strong>${totalRows}</strong> rows
        </div>
        <div class="sqlime-result__paging">
            <label class="sqlime-result__page-size">
                <span>Rows</span>
                <select data-result-page-size aria-label="Rows per page">${sizeOptions}</select>
            </label>
            <div class="sqlime-result__page-buttons">
                <button type="button" data-result-page="first" aria-label="First page" ${this.page <= 1 ? "disabled" : ""}>«</button>
                <button type="button" data-result-page="previous" aria-label="Previous page" ${this.page <= 1 ? "disabled" : ""}>‹</button>
                <span class="sqlime-result__page-label">Page ${this.page} of ${totalPages}</span>
                <button type="button" data-result-page="next" aria-label="Next page" ${this.page >= totalPages ? "disabled" : ""}>›</button>
                <button type="button" data-result-page="last" aria-label="Last page" ${this.page >= totalPages ? "disabled" : ""}>»</button>
            </div>
        </div>
    </div>
    <div class="sqlime-result__table-wrap">
        ${printer.printResult(pageResult)}
    </div>
</div>`;
    }

    onPagingClick(event) {
        const button = event.target.closest("[data-result-page]");
        if (!button || !this.result || button.disabled) {
            return;
        }

        const totalRows = Array.isArray(this.result.values) ? this.result.values.length : 0;
        const totalPages = Math.max(1, Math.ceil(totalRows / this.pageSize));
        switch (button.dataset.resultPage) {
            case "first":
                this.page = 1;
                break;
            case "previous":
                this.page -= 1;
                break;
            case "next":
                this.page += 1;
                break;
            case "last":
                this.page = totalPages;
                break;
        }
        this.renderResult();
    }

    onPagingChange(event) {
        const select = event.target.closest("[data-result-page-size]");
        if (!select || !this.result) {
            return;
        }
        const pageSize = Number(select.value);
        if (!PAGE_SIZES.includes(pageSize)) {
            return;
        }
        this.pageSize = pageSize;
        this.page = 1;
        this.renderResult();
    }

    resetPaging() {
        this.result = null;
        this.page = 1;
    }

    // applyPrinter prints data structure
    // with specified printer function
    applyPrinter(data, printFunc) {
        if (!data) {
            this.clear();
            return;
        }
        this.innerHTML = printFunc(data);
    }

    // clear hides the table
    clear() {
        this.resetPaging();
        this.innerHTML = "";
    }
}

if (!window.customElements.get("sqlime-result")) {
    window.SqlimeResult = SqlimeResult;
    customElements.define("sqlime-result", SqlimeResult);
}
