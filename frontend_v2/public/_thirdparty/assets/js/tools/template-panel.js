(function () {
  "use strict";

  var registry = window.ProductManualTemplateTools = window.ProductManualTemplateTools || {};

  registry.bindTemplatePanel = function bindTemplatePanel(context) {
    var doc = context.document;
    var sideToggleButton = doc.getElementById("toggleTemplatePanelSide");
    var panel = doc.getElementById("templatePanel");
    if (!sideToggleButton || !panel || panel.dataset.toolBound === "true") return;
    panel.dataset.toolBound = "true";

    function togglePanel() {
      panel.classList.toggle("is-hidden");
      var isOpen = !panel.classList.contains("is-hidden");
      sideToggleButton.classList.toggle("is-active", isOpen);
      if (isOpen) panel.scrollIntoView({ block: "nearest" });
    }

    sideToggleButton.classList.toggle("is-active", !panel.classList.contains("is-hidden"));
    sideToggleButton.addEventListener("click", togglePanel);

    var featureInput = panel.querySelector("[data-feature-excel-input]");
    var featureButton = panel.querySelector("[data-load-feature-excel]");
    if (featureInput && featureButton) {
      featureButton.addEventListener("click", function () {
        featureInput.value = "";
        featureInput.click();
      });
      featureInput.addEventListener("change", function () {
        context.importFeatureFile(featureInput.files && featureInput.files[0]);
      });
    }
  };
}());
