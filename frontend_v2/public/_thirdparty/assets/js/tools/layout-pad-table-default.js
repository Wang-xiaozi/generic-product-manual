(function () {
  "use strict";

  function findPadDefinitionTable(doc) {
    var tables = Array.from(doc.querySelectorAll("[data-editable-table]"));
    return tables.find(function (table) {
      var block = table.closest("[data-table-block]");
      var title = block ? block.querySelector(".section-title") : null;
      return title && title.textContent.indexOf("压点") !== -1;
    }) || null;
  }

  function clearDefaultPadRows() {
    var table = findPadDefinitionTable(document);
    if (!table) return;
    var tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;
    var rows = Array.from(tbody.rows || []);
    if (!rows.length) return;
    tbody.innerHTML = "";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", clearDefaultPadRows, { once: true });
  } else {
    clearDefaultPadRows();
  }
}());
