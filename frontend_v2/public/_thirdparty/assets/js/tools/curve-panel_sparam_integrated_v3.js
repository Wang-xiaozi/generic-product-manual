(function () {
  "use strict";

  var registry = window.ProductManualTemplateTools = window.ProductManualTemplateTools || {};
  var importBatchSeed = 0;

  function nextImportBatchId() {
    importBatchSeed += 1;
    return Date.now().toString(36) + "-" + importBatchSeed.toString(36);
  }

  function readFileAsText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error("文件读取失败")); };
      reader.readAsText(file);
    });
  }

  function isLikelySnpFile(file, context) {
    var path = file && (file.webkitRelativePath || file.name) || "";
    if (context.isSupportedSnpFile && context.isSupportedSnpFile(path)) return true;
    return /\.(txt|dat)$/i.test(path);
  }

  function readSnpFiles(files, context) {
    var list = Array.from(files || []).filter(function (file) {
      return isLikelySnpFile(file, context);
    });
    if (!list.length) {
      context.setCurveStatus("没有找到可读取的 .s1p/.s2p/.snp 文件", true);
      return;
    }
    context.setCurveStatus("正在读取 " + list.length + " 个 S 参数文件，解析后会列出全部可用数据...", false);
    var batchId = nextImportBatchId();
    Promise.all(list.map(function (file, index) {
      return readFileAsText(file).then(function (text) {
        return {
          id: "local-snp-" + batchId + "-" + index,
          name: file.name || ("S参数文件 " + (index + 1)),
          sourcePath: file.webkitRelativePath || file.name || "",
          text: text
        };
      }).catch(function () {
        return null;
      });
    })).then(function (items) {
      items = items.filter(Boolean);
      var added = context.appendCurveResources ? context.appendCurveResources(items) : 0;
      var loaded = context.getCurveResources ? context.getCurveResources().length : added;
      if (!loaded) {
        context.setCurveStatus("文件读取完成，但没有解析到有效 S 参数", true);
        return;
      }
      context.setCurveStatus("本次新增 " + added + " 个 S 参数文件，当前共 " + loaded + " 个" + (added < list.length ? "，跳过或重复 " + (list.length - added) + " 个" : ""), false);
    });
  }

  function readPastedSnp(context, textarea) {
    var text = textarea ? textarea.value : "";
    if (!text.trim()) {
      context.setCurveStatus("请先粘贴 Touchstone S 参数内容", true);
      if (textarea) textarea.focus();
      return false;
    }
    var pasteId = Date.now().toString(36);
    var added = context.appendCurveResources ? context.appendCurveResources([{
      id: "pasted-snp-" + pasteId,
      name: "pasted-" + pasteId + ".s2p",
      sourcePath: "pasted-" + pasteId + ".s2p",
      text: text
    }]) : 0;
    if (!added) {
      context.setCurveStatus("粘贴内容不是有效的 Touchstone S 参数", true);
      if (textarea) textarea.focus();
      return false;
    }
    context.setCurveStatus("已导入粘贴的 S 参数内容，请勾选后生成曲线", false);
    if (textarea) textarea.value = "";
    return true;
  }

  registry.bindCurvePanel = function bindCurvePanel(context) {
    var doc = context.document;
    var curveToggle = doc.getElementById("toggleCurvePanel");
    var curvePanel = doc.getElementById("curvePanel");
    if (!curveToggle || !curvePanel || curvePanel.dataset.toolBound === "true") return;
    curvePanel.dataset.toolBound = "true";

    curveToggle.classList.toggle("is-active", !curvePanel.classList.contains("is-hidden"));
    curveToggle.addEventListener("click", function () {
      curvePanel.classList.toggle("is-hidden");
      var isOpen = !curvePanel.classList.contains("is-hidden");
      curveToggle.classList.toggle("is-active", isOpen);
      if (isOpen) curvePanel.scrollIntoView({ block: "nearest" });
    });

    var snpFileInput = curvePanel.querySelector("[data-snp-file-input]");
    var snpDirInput = curvePanel.querySelector("[data-snp-dir-input]");
    var pickSnpFilesButton = curvePanel.querySelector("[data-pick-snp-files]");
    var pickSnpDirButton = curvePanel.querySelector("[data-pick-snp-dir]");
    var openPasteButton = curvePanel.querySelector("[data-open-snp-paste]");
    var pasteModal = doc.querySelector("[data-snp-paste-modal]");
    var pasteTextarea = pasteModal && pasteModal.querySelector("[data-snp-paste-text]");

    function setPasteModalOpen(isOpen) {
      if (!pasteModal) return;
      pasteModal.classList.toggle("is-hidden", !isOpen);
      pasteModal.setAttribute("aria-hidden", isOpen ? "false" : "true");
      if (isOpen && pasteTextarea) {
        window.setTimeout(function () { pasteTextarea.focus(); }, 0);
      } else if (!isOpen && openPasteButton) {
        openPasteButton.focus();
      }
    }

    if (pickSnpFilesButton && snpFileInput) {
      pickSnpFilesButton.addEventListener("click", function () {
        snpFileInput.value = "";
        snpFileInput.click();
      });
      snpFileInput.addEventListener("change", function () {
        readSnpFiles(snpFileInput.files, context);
      });
    }

    if (pickSnpDirButton && snpDirInput) {
      pickSnpDirButton.addEventListener("click", function () {
        snpDirInput.value = "";
        snpDirInput.click();
      });
      snpDirInput.addEventListener("change", function () {
        readSnpFiles(snpDirInput.files, context);
      });
    }

    if (openPasteButton && pasteModal) {
      openPasteButton.addEventListener("click", function () {
        setPasteModalOpen(true);
      });
      pasteModal.addEventListener("click", function (event) {
        if (event.target.closest("[data-snp-paste-close]")) {
          setPasteModalOpen(false);
          return;
        }
        if (event.target.closest("[data-import-pasted-snp]") && readPastedSnp(context, pasteTextarea)) {
          setPasteModalOpen(false);
        }
      });
      pasteModal.addEventListener("keydown", function (event) {
        if (event.key === "Escape") setPasteModalOpen(false);
      });
    }

    curvePanel.addEventListener("change", function (event) {
      if (!event.target.matches("[data-curve-select-index]")) return;
      context.setCurveResourceSelected(event.target.dataset.curveSelectIndex, event.target.checked);
      context.renderCurveList();
    });

    curvePanel.addEventListener("click", function (event) {
      if (event.target.closest("[data-toggle-all-curves]")) {
        context.toggleAllCurveResources();
        context.renderCurveList();
        return;
      }
      if (event.target.closest("[data-generate-selected-curves]")) {
        context.insertSelectedCurveSuite();
        return;
      }
      if (event.target.closest("[data-delete-selected-curve-resources]")) {
        context.deleteSelectedCurveResources();
        return;
      }
    });

    window.manualCurveTool = {
      loadSnpFiles: function (files) {
        readSnpFiles(files, context);
      },
      getResources: function () {
        return context.getCurveResources ? context.getCurveResources() : [];
      }
    };
  };
}());
