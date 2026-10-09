(function () {
  "use strict";

  var registry = window.ProductManualTemplateTools = window.ProductManualTemplateTools || {};
  var SVG_NS = "http://www.w3.org/2000/svg";
  var DEFAULT_SCENE_STROKE_WIDTH = 15;
  var DEFAULT_SCENE_FONT_SIZE = 150;
  var DEFAULT_GROUND_STROKE_WIDTH = 15;
  var DEFAULT_GROUND_SCALE = 5;
  var state = {
    activeType: null,
    activeZone: null,
    activeItem: null,
    selectedElementId: null,
    drag: null
  };
  var delegatedListeners = [];

  function addDelegatedListener(doc, type, handler) {
    doc.addEventListener(type, handler);
    delegatedListeners.push({ doc: doc, type: type, handler: handler });
  }

  function overlayEditorRoot(doc) {
    return (doc || document).querySelector("[data-overlay-editor-modal]");
  }

  function openOverlayEditor(doc) {
    var root = overlayEditorRoot(doc);
    if (!root) return;
    root.classList.remove("is-hidden");
    root.setAttribute("aria-hidden", "false");
  }

  function closeOverlayEditor(doc) {
    var root = overlayEditorRoot(doc);
    if (!root) return;
    root.classList.add("is-hidden");
    root.setAttribute("aria-hidden", "true");
  }

  function activateEditorForZone(doc, zone, options) {
    options = options || {};
    var item = zone && zone.querySelector(".image-item.scene-item");
    var type = zoneType(zone);
    var label = doc.querySelector("[data-overlay-editor-target]");
    var subtitle = doc.querySelector("[data-overlay-editor-selected]");
    if (!zone || !item || !ensureScene(zone)) return false;
    state.activeType = type;
    state.activeZone = zone;
    state.activeItem = item;
    if (label) {
      label.textContent = type === "assembly"
        ? "\u5f53\u524d\u4e3a\u88c5\u914d\u56fe\u7f16\u8f91\u6a21\u5f0f\uff0c\u8bf7\u70b9\u51fb\u7535\u963b\u3001Vd \u7535\u8def\u3001\u6807\u7b7e\u3001\u63a5\u5730\u7b26\u53f7\u6216\u7aef\u53e3\u6846\u3002"
        : type === "function_block"
          ? "\u5f53\u524d\u4e3a\u529f\u80fd\u6846\u56fe\u7f16\u8f91\u6a21\u5f0f\uff0c\u8bf7\u70b9\u51fb\u653e\u5927\u5668\u3001\u7aef\u53e3\u6807\u7b7e\u3001\u8fde\u7ebf\u6216\u7aef\u53e3\u6846\u3002"
          : "\u5f53\u524d\u4e3a\u5c3a\u5bf8\u56fe\u7f16\u8f91\u6a21\u5f0f\uff0c\u8bf7\u70b9\u51fb\u5c3a\u5bf8\u6807\u6ce8\u3001\u7f16\u53f7\u3001\u63a5\u5730\u7b26\u53f7\u6216\u7aef\u53e3\u6846\u3002";
    }
    if (subtitle) {
      subtitle.textContent = type === "assembly"
        ? "\u5f53\u524d\u6b63\u5728\u7f16\u8f91\u88c5\u914d\u56fe\u3002"
        : type === "function_block"
          ? "\u5f53\u524d\u6b63\u5728\u7f16\u8f91\u529f\u80fd\u6846\u56fe\u3002"
          : "\u5f53\u524d\u6b63\u5728\u7f16\u8f91\u5c3a\u5bf8\u56fe\u3002";
    }
    if (options.open !== false) openOverlayEditor(doc);
    return true;
  }

  function sceneKey(type) {
    if (type === "assembly") return "layoutAssemblyScene";
    if (type === "function_block") return "layoutFunctionBlockScene";
    return "layoutDimensionScene";
  }

  function zoneType(zone) {
    if (!zone) return "dimension";
    if (zone.classList.contains("assembly-image")) return "assembly";
    if (zone.classList.contains("function-block-image")) return "function_block";
    var panel = zone.closest(".half-panel, .section");
    var title = panel ? panel.querySelector(".section-title") : null;
    if (title && /function|block/i.test(String(title.textContent || ""))) return "function_block";
    return "dimension";
  }

  function zoneSelector(type) {
    if (type === "assembly") return ".assembly-image[data-image-zone]";
    if (type === "function_block") return ".function-block-image[data-image-zone], .half-panel [data-image-zone]";
    return ".dimension-images[data-image-zone]";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isTextBearingKind(kind) {
    return kind === "text"
      || kind === "dimension_label"
      || kind === "resistor_block"
      || kind === "vd_supply"
      || kind === "amplifier_block";
  }

  function isLineBearingKind(kind) {
    return kind === "rect"
      || kind === "polyline"
      || kind === "dimension_label"
      || kind === "resistor_block"
      || kind === "vd_supply"
      || kind === "amplifier_block";
  }

  function normalizeGeneratedElement(element) {
    var next = clone(element);
    if (isTextBearingKind(next.kind)) next.font_size = DEFAULT_SCENE_FONT_SIZE;
    if (next.kind === "text" && (next.role === "port_number" || next.role === "dimension_origin")) {
      next.font_size = DEFAULT_SCENE_FONT_SIZE;
    }
    if (next.kind === "dimension_label") {
      next.font_size = DEFAULT_SCENE_FONT_SIZE;
    }
    if (next.kind === "ground_symbol") {
      next.scale = DEFAULT_GROUND_SCALE;
      next.stroke_width = DEFAULT_GROUND_STROKE_WIDTH;
    } else if (isLineBearingKind(next.kind)) {
      next.stroke_width = DEFAULT_SCENE_STROKE_WIDTH;
    }
    return next;
  }

  function centerPortNumbers(scene) {
    var portCenters = {};
    (scene.elements || []).forEach(function (element) {
      if (element.kind !== "rect" || element.role !== "port") return;
      if (!element.meta || element.meta.port_index == null) return;
      portCenters[String(element.meta.port_index)] = {
        x: Number(element.x || 0) + Number(element.width || 0) / 2,
        y: Number(element.y || 0) + Number(element.height || 0) / 2
      };
    });
    (scene.elements || []).forEach(function (element) {
      if (element.kind !== "text" || element.role !== "port_number") return;
      if (!element.meta || element.meta.port_index == null) return;
      var center = portCenters[String(element.meta.port_index)];
      if (!center) return;
      element.x = Number(center.x.toFixed(3));
      element.y = Number(center.y.toFixed(3));
      element.text_anchor = "middle";
    });
  }

  function normalizeGeneratedScene(scene) {
    var next = clone(scene);
    next.elements = (next.elements || []).map(normalizeGeneratedElement);
    centerPortNumbers(next);
    return next;
  }

  function ensureScene(zone) {
    if (!zone || !zone.dataset) return null;
    var key = sceneKey(zoneType(zone));
    if (!zone.dataset[key]) return null;
    try {
      return JSON.parse(zone.dataset[key]);
    } catch (error) {
      return null;
    }
  }

  function writeScene(zone, scene) {
    if (!zone || !zone.dataset) return;
    zone.dataset[sceneKey(zoneType(zone))] = JSON.stringify(scene || null);
  }

  function clearImageList(zone) {
    var list = zone && zone.querySelector(".image-list");
    if (list) list.innerHTML = "";
  }

  function ensureSceneItem(zone, scene) {
    var list = zone && zone.querySelector(".image-list");
    if (!zone || !list || !scene) return null;
    var item = list.querySelector(".image-item.scene-item");
    if (!item) {
      item = document.createElement("figure");
      item.className = "image-item scene-item";
      list.appendChild(item);
    }
    if (!item.querySelector(".remove-image")) {
      var remove = document.createElement("button");
      remove.className = "remove-image";
      remove.type = "button";
      remove.textContent = "\u00d7";
      remove.title = "\u5220\u9664\u56fe\u7247";
      remove.setAttribute("aria-label", "\u5220\u9664\u56fe\u7247");
      item.appendChild(remove);
    }
    item.dataset.sceneType = scene.scene_type || zoneType(zone);
    item.dataset.sceneModel = scene.model_id || "";
    return item;
  }

  function ensureSvg(item, scene) {
    if (!item) return null;
    var svg = item.querySelector("svg.scene-svg");
    if (!svg) {
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "scene-svg");
      var remove = item.querySelector(".remove-image");
      if (remove) {
        item.insertBefore(svg, remove);
      } else {
        item.appendChild(svg);
      }
    }
    svg.setAttribute("viewBox", "0 0 " + scene.canvas.width + " " + scene.canvas.height);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", item.style.width && item.style.height ? "none" : "xMidYMid meet");
    return svg;
  }

  function fitDimensionSceneViewport(svg, scene) {
    if (!svg || !scene || scene.scene_type !== "dimension") return;
    var bounds;
    try {
      bounds = svg.getBBox();
    } catch (error) {
      return;
    }
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
        bounds.width <= 0 || bounds.height <= 0) return;
    var canvasWidth = Number(scene.canvas.width);
    var canvasHeight = Number(scene.canvas.height);
    var padding = Math.max(150, Math.min(canvasWidth, canvasHeight) * 0.06);
    var left = Math.min(0, Math.floor(bounds.x - padding));
    var top = Math.min(0, Math.floor(bounds.y - padding));
    var right = Math.max(canvasWidth, Math.ceil(bounds.x + bounds.width + padding));
    var bottom = Math.max(canvasHeight, Math.ceil(bounds.y + bounds.height + padding));
    svg.setAttribute("viewBox", [left, top, right - left, bottom - top].join(" "));
  }

  function setAttributes(node, attrs) {
    Object.keys(attrs || {}).forEach(function (key) {
      if (attrs[key] == null) return;
      node.setAttribute(key, String(attrs[key]));
    });
  }

  function createNode(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    setAttributes(node, attrs);
    return node;
  }

  function textAttributes(attrs) {
    return Object.assign({
      "font-family": "Arial, Microsoft YaHei, sans-serif",
      "font-weight": "400",
      "letter-spacing": "0"
    }, attrs || {});
  }

  function elementById(scene, elementId) {
    return scene && Array.isArray(scene.elements) ? scene.elements.find(function (element) {
      return element.id === elementId;
    }) || null : null;
  }

  function renderDimensionLabel(group, element) {
    var x = Number(element.x || 0);
    var y = Number(element.y || 0);
    var tick = Number(element.tick_length || 0);
    var gap = Number(element.text_gap || 0);
    var strokeWidth = Number(element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH);
    var fontSize = Number(element.font_size || DEFAULT_SCENE_FONT_SIZE);
    var orientation = element.orientation || "left";
    var text = element.text || "";

    if (orientation === "left") {
      group.appendChild(createNode("line", { x1: x - tick, y1: y, x2: x, y2: y, stroke: "#000", "stroke-width": strokeWidth }));
      group.appendChild(createNode("text", textAttributes({ x: x - tick - gap, y: y, fill: "#000", "font-size": fontSize, "text-anchor": "end", "dominant-baseline": "middle" }))).textContent = text;
    } else if (orientation === "right") {
      group.appendChild(createNode("line", { x1: x, y1: y, x2: x + tick, y2: y, stroke: "#000", "stroke-width": strokeWidth }));
      group.appendChild(createNode("text", textAttributes({ x: x + tick + gap, y: y, fill: "#000", "font-size": fontSize, "text-anchor": "start", "dominant-baseline": "middle" }))).textContent = text;
    } else {
      group.appendChild(createNode("line", { x1: x, y1: y, x2: x, y2: y + tick, stroke: "#000", "stroke-width": strokeWidth }));
      group.appendChild(createNode("text", textAttributes({ x: x, y: y + tick + gap, fill: "#000", "font-size": fontSize, "text-anchor": "middle", "dominant-baseline": "hanging" }))).textContent = text;
    }
  }

  function renderGroundSymbol(group, element) {
    var x = Number(element.x || 0);
    var y = Number(element.y || 0);
    var scale = Number(element.scale || 1);
    var side = element.side || "left";
    var placement = element.placement || "above";
    var elbow = scale * 24;
    var stem = scale * 34;
    var bar = scale * 28;
    var gap = scale * 10;
    var strokeWidth = Number(element.stroke_width || DEFAULT_GROUND_STROKE_WIDTH);
    var points = [];
    var barSegments = [];
    var jointX = x;
    var jointY = y;
    var stemEndX = x;
    var stemEndY = y;

    if (side === "left") {
      jointX = x + elbow;
      stemEndY = placement === "above" ? y - stem : y + stem;
      points = [x, y, jointX, y, jointX, stemEndY];
      [bar * 2.0, bar * 1.45, bar * 0.9].forEach(function (width, index) {
        var yy = placement === "above" ? stemEndY - index * gap : stemEndY + index * gap;
        barSegments.push([jointX - width / 2, yy, jointX + width / 2, yy]);
      });
    } else if (side === "right") {
      jointX = x - elbow;
      stemEndY = placement === "above" ? y - stem : y + stem;
      points = [x, y, jointX, y, jointX, stemEndY];
      [bar * 2.0, bar * 1.45, bar * 0.9].forEach(function (width, index) {
        var yy = placement === "above" ? stemEndY - index * gap : stemEndY + index * gap;
        barSegments.push([jointX - width / 2, yy, jointX + width / 2, yy]);
      });
    } else if (side === "top") {
      jointY = y + elbow;
      stemEndX = x + stem;
      points = [x, y, x, jointY, stemEndX, jointY];
      [bar * 2.0, bar * 1.45, bar * 0.9].forEach(function (width, index) {
        var xx = stemEndX + index * gap;
        barSegments.push([xx, jointY - width / 2, xx, jointY + width / 2]);
      });
    } else {
      jointY = y - elbow;
      stemEndX = x + stem;
      points = [x, y, x, jointY, stemEndX, jointY];
      [bar * 2.0, bar * 1.45, bar * 0.9].forEach(function (width, index) {
        var xx = stemEndX + index * gap;
        barSegments.push([xx, jointY - width / 2, xx, jointY + width / 2]);
      });
    }

    group.appendChild(createNode("polyline", {
      points: points.join(" "),
      fill: "none",
      stroke: "#000",
      "stroke-width": strokeWidth,
      "stroke-linecap": "square",
      "stroke-linejoin": "round"
    }));
    barSegments.forEach(function (segment) {
      group.appendChild(createNode("line", {
        x1: segment[0],
        y1: segment[1],
        x2: segment[2],
        y2: segment[3],
        stroke: "#000",
        "stroke-width": strokeWidth,
        "stroke-linecap": "square"
      }));
    });
  }

  function renderResistorBlock(group, element) {
    var x = Number(element.x || 0);
    var y = Number(element.y || 0);
    var scale = Number(element.scale || 1);
    var side = element.side || "left";
    var label = element.label || "RFin";
    var valueText = element.value_text || "50Ohm";
    var fontSize = Number(element.font_size || DEFAULT_SCENE_FONT_SIZE);
    var strokeWidth = Number(element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH);
    var padGap = scale * 88;
    var blockW = scale * 178;
    var blockH = scale * 178;
    var x1;
    var x2;
    var y1 = y - blockH / 2;
    var y2 = y + blockH / 2;

    if (side === "left") {
      x2 = x - padGap;
      x1 = x2 - blockW;
      group.appendChild(createNode("polyline", {
        points: [x2, y, x - scale * 10, y - scale * 8, x + scale * 52, y].join(" "),
        fill: "none",
        stroke: "#000",
        "stroke-width": strokeWidth
      }));
      group.appendChild(createNode("polyline", {
        points: [x2, y + scale * 12, x - scale * 10, y + scale * 5, x + scale * 52, y + scale * 12].join(" "),
        fill: "none",
        stroke: "#000",
        "stroke-width": strokeWidth
      }));
    } else {
      x1 = x + padGap;
      x2 = x1 + blockW;
      group.appendChild(createNode("polyline", {
        points: [x1, y, x + scale * 10, y - scale * 8, x - scale * 52, y].join(" "),
        fill: "none",
        stroke: "#000",
        "stroke-width": strokeWidth
      }));
      group.appendChild(createNode("polyline", {
        points: [x1, y + scale * 12, x + scale * 10, y + scale * 5, x - scale * 52, y + scale * 12].join(" "),
        fill: "none",
        stroke: "#000",
        "stroke-width": strokeWidth
      }));
    }

    group.appendChild(createNode("rect", {
      x: x1,
      y: y1,
      width: blockW,
      height: blockH,
      fill: "none",
      stroke: "#000",
      "stroke-width": strokeWidth
    }));
    group.appendChild(createNode("rect", {
      x: x1,
      y: y - scale * 25,
      width: blockW,
      height: scale * 50,
      fill: "#999900",
      stroke: "#000",
      "stroke-width": strokeWidth
    }));
    if (label) {
      var labelNode = createNode("text", textAttributes({
        x: (x1 + x2) / 2,
        y: y1 - scale * 18 - 4,
        fill: "#000",
        "font-size": fontSize,
        "text-anchor": "middle"
      }));
      labelNode.textContent = label;
      group.appendChild(labelNode);
    }
    var valueNode = createNode("text", textAttributes({
      x: (x1 + x2) / 2,
      y: y2 + scale * 18,
      fill: "#000",
      "font-size": fontSize,
      "text-anchor": "middle",
      "dominant-baseline": "hanging"
    }));
    valueNode.textContent = valueText;
    group.appendChild(valueNode);
  }

  function renderVdSupply(group, element) {
    var x = Number(element.x || 0);
    var y = Number(element.y || 0);
    var side = element.side || "bottom";
    var scale = Number(element.scale || 1);
    var fontSize = Number(element.font_size || DEFAULT_SCENE_FONT_SIZE);
    var strokeWidth = Number(element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH);
    var capGap = scale * 14;
    var capY = side === "bottom" ? y + scale * 120 : y - scale * 120;
    var boxY1 = side === "bottom" ? capY + scale * 52 : capY - scale * 180;
    var cX1 = x - scale * 78;
    var cX2 = x + scale * 78;
    var boxY2 = boxY1 + scale * 110;
    var vX1 = cX2 + scale * 90;
    var vX2 = vX1 + scale * 120;
    var arcLeft = cX2 - scale * 10;
    var arcRight = vX1 + scale * 10;

    function addArc(top, bottom) {
      var cx = (arcLeft + arcRight) / 2;
      var cy = (top + bottom) / 2;
      var rx = (arcRight - arcLeft) / 2;
      var ry = (bottom - top) / 2;
      var startDeg = 200 * Math.PI / 180;
      var endDeg = 340 * Math.PI / 180;
      var startX = cx + rx * Math.cos(startDeg);
      var startY = cy + ry * Math.sin(startDeg);
      var endX = cx + rx * Math.cos(endDeg);
      var endY = cy + ry * Math.sin(endDeg);
      group.appendChild(createNode("path", {
        d: [
          "M", startX, startY,
          "A", rx, ry, 0, 0, 1, endX, endY
        ].join(" "),
        fill: "none",
        stroke: "#000",
        "stroke-width": Math.max(1, strokeWidth - 1)
      }));
    }

    group.appendChild(createNode("line", { x1: x - capGap, y1: y, x2: x - capGap, y2: capY, stroke: "#000", "stroke-width": strokeWidth }));
    group.appendChild(createNode("line", { x1: x + capGap, y1: y, x2: x + capGap, y2: capY, stroke: "#000", "stroke-width": strokeWidth }));
    group.appendChild(createNode("line", { x1: x - capGap, y1: capY, x2: x - capGap, y2: boxY1, stroke: "#000", "stroke-width": strokeWidth }));
    group.appendChild(createNode("line", { x1: x + capGap, y1: capY, x2: x + capGap, y2: boxY1, stroke: "#000", "stroke-width": strokeWidth }));
    group.appendChild(createNode("rect", { x: cX1, y: boxY1, width: cX2 - cX1, height: boxY2 - boxY1, fill: "none", stroke: "#000", "stroke-width": strokeWidth }));
    group.appendChild(createNode("rect", { x: vX1, y: boxY1, width: vX2 - vX1, height: boxY2 - boxY1, fill: "none", stroke: "#000", "stroke-width": strokeWidth }));

    var boxNode = createNode("text", textAttributes({ x: cX1 + scale * 35, y: boxY1 + scale * 14 + fontSize, fill: "#000", "font-size": fontSize }));
    boxNode.textContent = element.box_text || "C";
    group.appendChild(boxNode);
    var sourceNode = createNode("text", textAttributes({ x: vX1 + scale * 22, y: boxY1 + scale * 14 + fontSize, fill: "#000", "font-size": fontSize }));
    sourceNode.textContent = element.source_text || "Vd";
    group.appendChild(sourceNode);
    addArc(boxY1 + scale * 40, boxY1 + scale * 66);
    addArc(boxY1 + scale * 58, boxY1 + scale * 84);
    var capNode = createNode("text", textAttributes({
      x: cX1 - scale * 18,
      y: boxY1 + scale * 18 + fontSize,
      fill: "#000",
      "font-size": fontSize,
      "text-anchor": "end"
    }));
    capNode.textContent = element.capacitor_text || "100pF";
    group.appendChild(capNode);
    var voltNode = createNode("text", textAttributes({
      x: vX2 + scale * 18,
      y: boxY1 + scale * 18 + fontSize,
      fill: "#000",
      "font-size": fontSize,
      "text-anchor": "start"
    }));
    voltNode.textContent = element.voltage_text || "+5V";
    group.appendChild(voltNode);
  }

  function absolutePoints(element) {
    var baseX = Number(element.x || 0);
    var baseY = Number(element.y || 0);
    return (element.points || []).map(function (point) {
      return [baseX + Number(point[0] || 0), baseY + Number(point[1] || 0)];
    });
  }

  function renderPolyline(group, element) {
    var points = absolutePoints(element);
    if (!points.length) return;
    group.appendChild(createNode("polyline", {
      points: points.map(function (point) { return point[0] + "," + point[1]; }).join(" "),
      fill: element.fill || "none",
      stroke: element.stroke || "#000",
      "stroke-width": element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH,
      "stroke-linecap": "square",
      "stroke-linejoin": "round"
    }));
  }

  function renderAmplifierBlock(group, element) {
    var x = Number(element.x || 0);
    var y = Number(element.y || 0);
    var width = Number(element.width || 0);
    var height = Number(element.height || 0);
    var halfW = width / 2;
    var halfH = height / 2;
    var points = [
      [x - halfW, y - halfH],
      [x - halfW, y + halfH],
      [x + halfW, y]
    ];
    group.appendChild(createNode("polygon", {
      points: points.map(function (point) { return point[0] + "," + point[1]; }).join(" "),
      fill: element.fill || "#fff",
      stroke: element.stroke || "#000",
      "stroke-width": element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH
    }));
    var text = createNode("text", textAttributes({
      x: element.label_x != null ? Number(element.label_x) : x + width * 0.06,
      y: element.label_y != null ? Number(element.label_y) : y,
      fill: "#000",
      "font-size": element.font_size || DEFAULT_SCENE_FONT_SIZE,
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    }));
    text.textContent = element.label || "AMP";
    group.appendChild(text);
  }

  function renderElement(svg, element, selected) {
    var group = createNode("g", {
      "class": "scene-element" + (selected ? " scene-element-selected" : ""),
      "data-scene-element-id": element.id,
      "data-scene-kind": element.kind || ""
    });
    var hit;
    if (element.kind === "rect") {
      group.appendChild(createNode("rect", {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fill: element.fill || "none",
        stroke: element.stroke || "#000",
        "stroke-width": element.stroke_width || DEFAULT_SCENE_STROKE_WIDTH
      }));
      hit = createNode("rect", {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "text") {
      var text = createNode("text", textAttributes({
        x: element.x,
        y: element.y,
        fill: "#000",
        "font-size": element.font_size || DEFAULT_SCENE_FONT_SIZE,
        "text-anchor": element.text_anchor || "start",
        "dominant-baseline": "middle"
      }));
      text.textContent = element.text || "";
      group.appendChild(text);
      hit = createNode("rect", {
        x: Number(element.x || 0) - 12,
        y: Number(element.y || 0) - Number(element.font_size || DEFAULT_SCENE_FONT_SIZE),
        width: Math.max(60, String(element.text || "").length * (Number(element.font_size || DEFAULT_SCENE_FONT_SIZE) * 0.65)),
        height: Math.max(22, Number(element.font_size || DEFAULT_SCENE_FONT_SIZE) * 1.4),
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "ground_symbol") {
      renderGroundSymbol(group, element);
      hit = createNode("rect", {
        x: Number(element.x || 0) - 40,
        y: Number(element.y || 0) - 40,
        width: 90,
        height: 90,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "dimension_label") {
      renderDimensionLabel(group, element);
      hit = createNode("rect", {
        x: Number(element.x || 0) - 70,
        y: Number(element.y || 0) - 30,
        width: 160,
        height: 70,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "resistor_block") {
      renderResistorBlock(group, element);
      hit = createNode("rect", {
        x: Number(element.x || 0) - 260,
        y: Number(element.y || 0) - 120,
        width: 360,
        height: 240,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "vd_supply") {
      renderVdSupply(group, element);
      hit = createNode("rect", {
        x: Number(element.x || 0) - 180,
        y: Number(element.y || 0) - 80,
        width: 460,
        height: 280,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "polyline") {
      renderPolyline(group, element);
      var polyPoints = absolutePoints(element);
      var xs = polyPoints.map(function (point) { return point[0]; });
      var ys = polyPoints.map(function (point) { return point[1]; });
      var minX = Math.min.apply(Math, xs);
      var maxX = Math.max.apply(Math, xs);
      var minY = Math.min.apply(Math, ys);
      var maxY = Math.max.apply(Math, ys);
      hit = createNode("rect", {
        x: minX - 16,
        y: minY - 16,
        width: Math.max(32, maxX - minX + 32),
        height: Math.max(32, maxY - minY + 32),
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    } else if (element.kind === "amplifier_block") {
      renderAmplifierBlock(group, element);
      hit = createNode("rect", {
        x: Number(element.x || 0) - Number(element.width || 0) / 2 - 12,
        y: Number(element.y || 0) - Number(element.height || 0) / 2 - 12,
        width: Number(element.width || 0) + 24,
        height: Number(element.height || 0) + 24,
        fill: "transparent",
        stroke: selected ? "#0f62fe" : "transparent",
        "stroke-width": 2
      });
      group.appendChild(hit);
    }
    svg.appendChild(group);
  }

  function renderScene(zone) {
    var scene = ensureScene(zone);
    if (!scene) return;
    var previousItem = zone.querySelector(".image-item.scene-item");
    var previousWidth = previousItem && previousItem.style.width;
    var previousHeight = previousItem && previousItem.style.height;
    clearImageList(zone);
    zone.classList.add("has-images");
    var item = ensureSceneItem(zone, scene);
    if (!item) return;
    if (previousWidth && previousHeight) {
      item.style.width = previousWidth;
      item.style.height = previousHeight;
    }
    var svg = ensureSvg(item, scene);
    svg.innerHTML = "";
    (scene.elements || []).forEach(function (element) {
      renderElement(svg, element, state.activeItem === item && state.selectedElementId === element.id);
    });
    fitDimensionSceneViewport(svg, scene);
    if (window.ProductManualTemplateToolContext) {
      window.ProductManualTemplateToolContext.ensureResizableImageItem(item);
    }
  }

  function updateAllSceneBindings(doc) {
    doc.querySelectorAll(".dimension-images[data-image-zone], .assembly-image[data-image-zone], .function-block-image[data-image-zone], .half-panel [data-image-zone]").forEach(function (zone) {
      var scene = ensureScene(zone);
      if (!scene) return;
      writeScene(zone, normalizeGeneratedScene(scene));
      renderScene(zone);
    });
  }

  function kindLabel(kind) {
    var labels = {
      rect: "\u7aef\u53e3\u6846 / \u5916\u6846",
      text: "\u6587\u5b57",
      ground_symbol: "\u63a5\u5730\u7b26\u53f7",
      dimension_label: "\u5c3a\u5bf8\u6807\u6ce8",
      resistor_block: "\u7535\u963b\u5916\u63a5\u7535\u8def",
      vd_supply: "Vd \u5916\u63a5\u7535\u8def",
      polyline: "\u8fde\u7ebf",
      amplifier_block: "\u653e\u5927\u5668\u7b26\u53f7"
    };
    return labels[kind] || kind || "";
  }

  function roleLabel(role) {
    var labels = {
      chip_frame: "\u82af\u7247\u5916\u6846",
      port: "\u7aef\u53e3\u6846",
      ground_symbol: "\u63a5\u5730\u7b26\u53f7",
      dimension_top: "\u5de6\u4e0a\u89d2\u82af\u7247\u5bbd\u5ea6\u6807\u6ce8",
      dimension_right: "\u53f3\u4e0b\u89d2\u82af\u7247\u957f\u5ea6\u6807\u6ce8",
      dimension_vd: "Vd \u7aef\u5c3a\u5bf8\u6807\u6ce8",
      dimension_left_signal: "RFin \u7aef\u5c3a\u5bf8\u6807\u6ce8",
      dimension_right_signal: "RFout \u7aef\u5c3a\u5bf8\u6807\u6ce8",
      rfin: "RFin \u7535\u963b",
      rfout: "RFout \u7535\u963b",
      rfin_name: "RFin \u6807\u7b7e",
      rfout_name: "RFout \u6807\u7b7e",
      vd_supply: "Vd \u7535\u6e90\u7535\u5bb9\u7535\u8def",
      vd_name: "Vd \u6807\u7b7e",
      amplifier_block: "\u529f\u80fd\u6846\u56fe\u653e\u5927\u5668",
      rfin_wire: "RFin \u8fde\u7ebf",
      rfout_wire: "RFout \u8fde\u7ebf",
      vd_wire: "Vd \u8fde\u7ebf"
    };
    return labels[role] || role || "";
  }

  function selectionHint(element) {
    if (!element) {
      return "\u5148\u70b9\u51fb\u56fe\u4e2d\u4e00\u4e2a\u5df2\u6709\u5bf9\u8c61\uff0c\u518d\u5728\u53f3\u4fa7\u4fee\u6539\u5c5e\u6027\u3002";
    }
    var parts = [];
    var kind = kindLabel(element.kind);
    var role = roleLabel(element.role);
    if (kind) parts.push("\u5bf9\u8c61\u7c7b\u578b\uff1a" + kind);
    if (role) parts.push("\u5bf9\u8c61\u7528\u9014\uff1a" + role);
    if (element.meta && element.meta.port_index != null) {
      parts.push("\u5173\u8054\u7aef\u53e3\uff1a" + String(element.meta.port_index));
    }
    return parts.join("\u3002") + "\u3002";
  }

  function selectEditorTarget(doc, type) {
    var zone = doc.querySelector(zoneSelector(type));
    var label = doc.querySelector("[data-overlay-editor-target]");
    var subtitle = doc.querySelector("[data-overlay-editor-selected]");
    if (!zone || !ensureScene(zone)) {
      updatePanel(doc, null);
      if (label) {
        label.textContent = type === "assembly"
          ? "\u8bf7\u5148\u751f\u6210\u88c5\u914d\u56fe scene\uff0c\u518d\u8fdb\u884c\u7f16\u8f91\u3002"
          : type === "function_block"
            ? "\u8bf7\u5148\u751f\u6210\u529f\u80fd\u6846\u56fe scene\uff0c\u518d\u8fdb\u884c\u7f16\u8f91\u3002"
            : "\u8bf7\u5148\u751f\u6210\u5c3a\u5bf8\u56fe scene\uff0c\u518d\u8fdb\u884c\u7f16\u8f91\u3002";
      }
      if (subtitle) subtitle.textContent = "\u8bf7\u5148\u751f\u6210 scene \u540e\u518d\u8fdb\u884c\u56fe\u5f62\u7f16\u8f91\u3002";
      closeOverlayEditor(doc);
      return;
    }
    state.selectedElementId = null;
    updatePanel(doc, null);
    activateEditorForZone(doc, zone);
  }

  function ensureFieldLegend(label) {
    if (!label) return null;
    var legend = label.querySelector(".overlay-field-legend");
    if (legend) return legend;
    legend = document.createElement("span");
    legend.className = "overlay-field-legend";
    label.insertBefore(legend, label.firstChild);
    return legend;
  }

  function ensureDynamicTextField(panel, attrName) {
    var input = panel.querySelector("[" + attrName + "]");
    if (input) return input;
    var jsonInput = panel.querySelector("[data-overlay-json]");
    var jsonLabel = jsonInput && jsonInput.closest("label");
    if (!jsonLabel) return null;
    var label = document.createElement("label");
    label.className = "curve-field";
    var legend = document.createElement("span");
    legend.className = "overlay-field-legend";
    label.appendChild(legend);
    input = document.createElement("input");
    input.type = "text";
    input.setAttribute(attrName, "");
    label.appendChild(input);
    jsonLabel.parentNode.insertBefore(label, jsonLabel);
    return input;
  }

  function ensureDynamicTextareaField(panel, attrName, rows) {
    var input = panel.querySelector("[" + attrName + "]");
    if (input) return input;
    var jsonInput = panel.querySelector("[data-overlay-json]");
    var jsonLabel = jsonInput && jsonInput.closest("label");
    if (!jsonLabel) return null;
    var label = document.createElement("label");
    label.className = "curve-field";
    var legend = document.createElement("span");
    legend.className = "overlay-field-legend";
    label.appendChild(legend);
    input = document.createElement("textarea");
    input.rows = rows || 4;
    input.setAttribute(attrName, "");
    label.appendChild(input);
    jsonLabel.parentNode.insertBefore(label, jsonLabel);
    return input;
  }

  function ensureDynamicSelectField(panel, attrName, options) {
    var input = panel.querySelector("[" + attrName + "]");
    if (input) return input;
    var jsonInput = panel.querySelector("[data-overlay-json]");
    var jsonLabel = jsonInput && jsonInput.closest("label");
    if (!jsonLabel) return null;
    var label = document.createElement("label");
    label.className = "curve-field";
    var legend = document.createElement("span");
    legend.className = "overlay-field-legend";
    label.appendChild(legend);
    input = document.createElement("select");
    input.setAttribute(attrName, "");
    (options || []).forEach(function (option) {
      var node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      input.appendChild(node);
    });
    label.appendChild(input);
    jsonLabel.parentNode.insertBefore(label, jsonLabel);
    return input;
  }

  function serializePolylinePoints(element) {
    return absolutePoints(element).map(function (point) {
      return point[0] + ", " + point[1];
    }).join("\n");
  }

  function parsePolylinePoints(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line !== "";
    });
    if (lines.length < 2) {
      throw new Error("At least two polyline points are required.");
    }
    return lines.map(function (line) {
      var parts = line.split(/[\s,]+/).filter(function (part) {
        return part !== "";
      });
      if (parts.length < 2) {
        throw new Error("Each polyline point must contain two numbers, for example: 1200, 980.");
      }
      var x = Number(parts[0]);
      var y = Number(parts[1]);
      if (!isFinite(x) || !isFinite(y)) {
        throw new Error("Polyline coordinates must be numeric values.");
      }
      return [x, y];
    });
  }

  function writePolylinePoints(element, points) {
    var origin = points[0];
    element.x = origin[0];
    element.y = origin[1];
    element.points = points.map(function (point) {
      return [
        Number((point[0] - origin[0]).toFixed(3)),
        Number((point[1] - origin[1]).toFixed(3))
      ];
    });
  }

  function getPanelControls(panel) {
    if (!panel) return null;
    return {
      idInput: panel.querySelector("[data-overlay-selected-id]"),
      kindInput: panel.querySelector("[data-overlay-selected-kind]"),
      primaryInput: panel.querySelector("[data-overlay-text-value]"),
      xInput: panel.querySelector("[data-overlay-pos-x]"),
      yInput: panel.querySelector("[data-overlay-pos-y]"),
      widthInput: panel.querySelector("[data-overlay-size-w]"),
      heightInput: panel.querySelector("[data-overlay-size-h]"),
      secondaryInput: panel.querySelector("[data-overlay-text-secondary]"),
      tertiaryInput: ensureDynamicTextField(panel, "data-overlay-text-tertiary"),
      quaternaryInput: ensureDynamicTextField(panel, "data-overlay-text-quaternary"),
      pointsInput: ensureDynamicTextareaField(panel, "data-overlay-polyline-points", 5),
      newPortSideInput: ensureDynamicSelectField(panel, "data-overlay-new-port-side", [
        { value: "left", label: "left" },
        { value: "right", label: "right" },
        { value: "top", label: "top" },
        { value: "bottom", label: "bottom" }
      ]),
      newGroundSideInput: ensureDynamicSelectField(panel, "data-overlay-new-ground-side", [
        { value: "left", label: "left" },
        { value: "right", label: "right" },
        { value: "top", label: "top" },
        { value: "bottom", label: "bottom" }
      ]),
      newGroundPlacementInput: ensureDynamicSelectField(panel, "data-overlay-new-ground-placement", [
        { value: "above", label: "above" },
        { value: "below", label: "below" },
        { value: "right", label: "right" }
      ]),
      newResistorRoleInput: ensureDynamicSelectField(panel, "data-overlay-new-resistor-role", [
        { value: "RFin", label: "RFin" },
        { value: "RFout", label: "RFout" }
      ]),
      newDimensionOrientationInput: ensureDynamicSelectField(panel, "data-overlay-new-dimension-orientation", [
        { value: "left", label: "left" },
        { value: "right", label: "right" },
        { value: "bottom", label: "bottom" }
      ]),
      placementInput: panel.querySelector("[data-overlay-placement]"),
      scaleInput: panel.querySelector("[data-overlay-scale]"),
      jsonInput: panel.querySelector("[data-overlay-json]"),
      deleteButton: panel.querySelector("[data-overlay-delete]"),
      duplicatePortButton: panel.querySelector("[data-overlay-duplicate-port]"),
      addLineButton: panel.querySelector("[data-overlay-add-line]")
    };
  }

  function ensureActionButton(panel, attrName, labelText) {
    var button = panel.querySelector("[" + attrName + "]");
    if (button) return button;
    var applyButton = panel.querySelector("[data-overlay-apply]");
    var actionRow = applyButton && applyButton.parentNode;
    if (!actionRow) return null;
    button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.setAttribute(attrName, "");
    button.textContent = labelText;
    actionRow.insertBefore(button, applyButton);
    return button;
  }

  function ensureActionButtons(panel) {
    ensureActionButton(panel, "data-overlay-delete", "Delete Selected");
    ensureActionButton(panel, "data-overlay-duplicate-port", "Duplicate Port");
    ensureActionButton(panel, "data-overlay-add-line", "Add Line");
    ensureActionButton(panel, "data-overlay-add-port", "Add Port");
    ensureActionButton(panel, "data-overlay-add-ground", "Add Ground");
    ensureActionButton(panel, "data-overlay-add-text", "Add Text");
    ensureActionButton(panel, "data-overlay-add-amplifier", "Add Amplifier");
    ensureActionButton(panel, "data-overlay-add-resistor", "Add Resistor");
    ensureActionButton(panel, "data-overlay-add-vd-supply", "Add Vd Supply");
    ensureActionButton(panel, "data-overlay-add-dimension", "Add Dimension");
  }

  function configureInsertControls(panel) {
    var controls = getPanelControls(panel);
    if (controls.newPortSideInput) {
      var legend = ensureFieldLegend(controls.newPortSideInput.closest("label"));
      if (legend) legend.textContent = "New Port Side";
      controls.newPortSideInput.title = "Choose which side to place the new port: left, right, top, or bottom.";
    }
    if (controls.newGroundSideInput) {
      var groundSideLegend = ensureFieldLegend(controls.newGroundSideInput.closest("label"));
      if (groundSideLegend) groundSideLegend.textContent = "New Ground Side";
      controls.newGroundSideInput.title = "Choose which side the new ground symbol connects to.";
    }
    if (controls.newGroundPlacementInput) {
      var groundPlacementLegend = ensureFieldLegend(controls.newGroundPlacementInput.closest("label"));
      if (groundPlacementLegend) groundPlacementLegend.textContent = "Ground Placement";
      controls.newGroundPlacementInput.title = "Choose whether the ground symbol expands above, below, or to the right.";
    }
    if (controls.newResistorRoleInput) {
      var resistorLegend = ensureFieldLegend(controls.newResistorRoleInput.closest("label"));
      if (resistorLegend) resistorLegend.textContent = "Resistor Target";
      controls.newResistorRoleInput.title = "Choose whether to insert an RFin resistor or an RFout resistor.";
    }
    if (controls.newDimensionOrientationInput) {
      var dimensionLegend = ensureFieldLegend(controls.newDimensionOrientationInput.closest("label"));
      if (dimensionLegend) dimensionLegend.textContent = "Dimension Orientation";
      controls.newDimensionOrientationInput.title = "Choose whether the new dimension label points left, right, or bottom.";
    }
    var targetHint = panel.querySelector("[data-overlay-editor-target]");
    if (targetHint && !panel.querySelector("[data-overlay-insert-hint]")) {
      var insertHint = document.createElement("p");
      insertHint.className = "tool-hint";
      insertHint.setAttribute("data-overlay-insert-hint", "");
      insertHint.textContent = "The New ... fields below control the side, direction, and target of newly inserted objects. They do not modify the currently selected object.";
      targetHint.parentNode.insertBefore(insertHint, targetHint.nextSibling);
    }
  }

  function fieldDef(key, label, placeholder, type) {
    return {
      key: key,
      label: label,
      placeholder: placeholder || "",
      type: type || "text"
    };
  }

  function sceneFieldConfig(element) {
    var kind = element && element.kind;
    if (kind === "dimension_label") {
      return {
        primary: fieldDef("text", "\u5c3a\u5bf8\u6587\u5b57", "\u4f8b\u5982 1025"),
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 360.0", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 219.5", "number"),
        width: fieldDef("tick_length", "\u523b\u7ebf\u957f\u5ea6", "\u4f8b\u5982 79.8", "number"),
        height: fieldDef("text_gap", "\u6587\u5b57\u95f4\u8ddd", "\u4f8b\u5982 25.2", "number"),
        placement: fieldDef("orientation", "\u6807\u6ce8\u65b9\u5411", "left / right / bottom"),
        scale: fieldDef("stroke_width", "\u7ebf\u5bbd", "\u4f8b\u5982 2.5", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1afont_size\u3001text_anchor \u7b49"
      };
    }
    if (kind === "ground_symbol") {
      return {
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 4317.9", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 1476.3", "number"),
        width: fieldDef("scale", "\u7b26\u53f7\u7f29\u653e", "\u4f8b\u5982 2.1", "number"),
        secondary: fieldDef("side", "\u8fde\u63a5\u4fa7", "left / right / top / bottom"),
        placement: fieldDef("placement", "\u7b26\u53f7\u4f4d\u7f6e", "above / below"),
        scale: fieldDef("stroke_width", "\u7ebf\u5bbd", "\u4f8b\u5982 5", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u7ee7\u7eed\u4fee\u6539\u63a5\u5730\u7b26\u53f7\u7ec6\u8282"
      };
    }
    if (kind === "resistor_block") {
      return {
        primary: fieldDef("label", "\u7aef\u53e3\u540d\u79f0", "RFin / RFout"),
        secondary: fieldDef("value_text", "\u963b\u503c\u6587\u5b57", "\u4f8b\u5982 50\u03a9"),
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 971.6", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 1316.1", "number"),
        width: fieldDef("font_size", "\u5b57\u53f7", "\u4f8b\u5982 92.4", "number"),
        placement: fieldDef("side", "\u8fde\u63a5\u65b9\u5411", "left / right"),
        scale: fieldDef("scale", "\u6574\u4f53\u7f29\u653e", "\u4f8b\u5982 2.1", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u7ee7\u7eed\u4fee\u6539\u7535\u963b\u56fe\u5f62\u7ec6\u8282"
      };
    }
    if (kind === "vd_supply") {
      return {
        primary: fieldDef("source_text", "\u7535\u6e90\u540d\u79f0", "\u4f8b\u5982 Vd"),
        secondary: fieldDef("capacitor_text", "\u7535\u5bb9\u6570\u503c", "\u4f8b\u5982 100pF"),
        tertiary: fieldDef("voltage_text", "\u7535\u538b\u6587\u5b57", "\u4f8b\u5982 +5V"),
        quaternary: fieldDef("box_text", "\u7535\u5bb9\u6846\u6587\u5b57", "\u4f8b\u5982 C"),
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 3061.6", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 2335.6", "number"),
        width: fieldDef("font_size", "\u5b57\u53f7", "\u4f8b\u5982 71.4", "number"),
        placement: fieldDef("side", "\u6446\u653e\u65b9\u5411", "bottom / top"),
        scale: fieldDef("scale", "\u6574\u4f53\u7f29\u653e", "\u4f8b\u5982 2.1", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u7ee7\u7eed\u4fee\u6539 Vd \u5916\u63a5\u7535\u8def\u7ec6\u8282"
      };
    }
    if (kind === "text") {
      return {
        primary: fieldDef("text", "\u6587\u5b57\u5185\u5bb9", "\u4f8b\u5982 RFin / 1 / Vd"),
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 1127.0", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 1253.1", "number"),
        placement: fieldDef("text_anchor", "\u5bf9\u9f50\u65b9\u5f0f", "start / middle / end"),
        scale: fieldDef("font_size", "\u5b57\u53f7", "\u4f8b\u5982 71.4", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u7ee7\u7eed\u4fee\u6539\u6587\u5b57\u5bf9\u9f50\u7ec6\u8282"
      };
    }
    if (kind === "polyline") {
      return {
        points: fieldDef("__polyline_points__", "\u8fde\u7ebf\u8282\u70b9", "\u6bcf\u884c\u4e00\u4e2a\u70b9\uff0c\u4f8b\u5982 1200, 980"),
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 1200.0", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 980.0", "number"),
        scale: fieldDef("stroke_width", "\u7ebf\u5bbd", "\u4f8b\u5982 4.0", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u82e5\u9700\u8981\uff0c\u4ecd\u53ef\u76f4\u63a5\u7f16\u8f91 points JSON"
      };
    }
    if (kind === "amplifier_block") {
      return {
        primary: fieldDef("label", "\u7b26\u53f7\u6587\u5b57", "\u4f8b\u5982 AMP"),
        x: fieldDef("x", "X \u4e2d\u5fc3\u5750\u6807", "\u4f8b\u5982 2500.0", "number"),
        y: fieldDef("y", "Y \u4e2d\u5fc3\u5750\u6807", "\u4f8b\u5982 1200.0", "number"),
        width: fieldDef("width", "\u5bbd\u5ea6", "\u4f8b\u5982 609.0", "number"),
        height: fieldDef("height", "\u9ad8\u5ea6", "\u4f8b\u5982 462.0", "number"),
        scale: fieldDef("font_size", "\u5b57\u53f7", "\u4f8b\u5982 88.2", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1astroke_width\u3001fill \u7b49"
      };
    }
    if (kind === "rect") {
      return {
        x: fieldDef("x", "X \u5750\u6807", "\u4f8b\u5982 360.0", "number"),
        y: fieldDef("y", "Y \u5750\u6807", "\u4f8b\u5982 219.5", "number"),
        width: fieldDef("width", "\u5bbd\u5ea6", "\u4f8b\u5982 4189.5", "number"),
        height: fieldDef("height", "\u9ad8\u5ea6", "\u4f8b\u5982 2152.5", "number"),
        scale: fieldDef("stroke_width", "\u7ebf\u5bbd", "\u4f8b\u5982 2.31", "number"),
        jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u7ee7\u7eed\u4fee\u6539\u7ebf\u6761\u7ec6\u8282"
      };
    }
    return {
      primary: fieldDef("text", "\u4e3b\u6587\u5b57", ""),
      x: fieldDef("x", "X \u5750\u6807", "", "number"),
      y: fieldDef("y", "Y \u5750\u6807", "", "number"),
      width: fieldDef("width", "\u5bbd\u5ea6", "", "number"),
      height: fieldDef("height", "\u9ad8\u5ea6", "", "number"),
      placement: fieldDef("placement", "\u4f4d\u7f6e / \u65b9\u5411", ""),
      scale: fieldDef("scale", "\u7f29\u653e / \u7ebf\u5bbd", "", "number"),
      jsonPlaceholder: "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u76f4\u63a5\u7f16\u8f91 JSON"
    };
  }

  function setFieldUi(input, definition, value, enabled) {
    if (!input) return;
    var label = input.closest("label");
    if (!label) return;
    if (!definition) {
      label.hidden = true;
      input.disabled = true;
      input.value = "";
      return;
    }
    label.hidden = false;
    input.disabled = !enabled;
    var legend = ensureFieldLegend(label);
    if (legend) legend.textContent = definition.label;
    input.placeholder = definition.placeholder || "";
    input.value = value != null ? String(value) : "";
  }

  function readFieldValue(element, definition) {
    if (!element || !definition || !definition.key) return "";
    if (definition.key === "__polyline_points__") return serializePolylinePoints(element);
    return element[definition.key] != null ? element[definition.key] : "";
  }

  function applyFieldValue(next, input, definition) {
    if (!input || !definition || !definition.key || input.disabled) return;
    if (definition.key === "__polyline_points__") {
      if ((input.value || "").trim() === "") return;
      writePolylinePoints(next, parsePolylinePoints(input.value));
      return;
    }
    if (definition.type === "number") {
      if (input.value === "") return;
      next[definition.key] = Number(input.value);
      return;
    }
    next[definition.key] = input.value;
  }

  function updatePanel(doc, element) {
    var panel = doc.getElementById("overlayEditorPanel");
    if (!panel) return;
    var enabled = !!state.activeItem;
    var targetHint = doc.querySelector("[data-overlay-editor-target]");
    panel.classList.toggle("is-hidden", !enabled);
    var controls = getPanelControls(panel);
    panel.querySelectorAll("[data-overlay-apply], [data-overlay-close], [data-overlay-text-value], [data-overlay-pos-x], [data-overlay-pos-y], [data-overlay-size-w], [data-overlay-size-h], [data-overlay-text-secondary], [data-overlay-text-tertiary], [data-overlay-text-quaternary], [data-overlay-polyline-points], [data-overlay-placement], [data-overlay-scale], [data-overlay-json]").forEach(function (control) {
      control.disabled = !enabled;
    });
    if (!enabled) return;
    if (!element) {
      if (controls.idInput) controls.idInput.value = "";
      if (controls.kindInput) controls.kindInput.value = "";
      if (targetHint && state.activeItem) targetHint.textContent = selectionHint(null);
      setFieldUi(controls.primaryInput, fieldDef("text", "\u4e3b\u6587\u5b57", "", "text"), "", false);
      setFieldUi(controls.xInput, fieldDef("x", "X \u5750\u6807", "", "number"), "", false);
      setFieldUi(controls.yInput, fieldDef("y", "Y \u5750\u6807", "", "number"), "", false);
      setFieldUi(controls.widthInput, null, "", false);
      setFieldUi(controls.heightInput, null, "", false);
      setFieldUi(controls.secondaryInput, null, "", false);
      setFieldUi(controls.tertiaryInput, null, "", false);
      setFieldUi(controls.quaternaryInput, null, "", false);
      setFieldUi(controls.pointsInput, null, "", false);
      setFieldUi(controls.placementInput, null, "", false);
      setFieldUi(controls.scaleInput, null, "", false);
      if (controls.jsonInput) controls.jsonInput.value = "";
      return;
    }
    var config = sceneFieldConfig(element);
    if (controls.idInput) controls.idInput.value = element.id || "";
    if (controls.kindInput) controls.kindInput.value = kindLabel(element.kind);
    if (targetHint) targetHint.textContent = selectionHint(element);
    setFieldUi(controls.primaryInput, config.primary || null, readFieldValue(element, config.primary), enabled);
    setFieldUi(controls.xInput, config.x || null, readFieldValue(element, config.x), enabled);
    setFieldUi(controls.yInput, config.y || null, readFieldValue(element, config.y), enabled);
    setFieldUi(controls.widthInput, config.width || null, readFieldValue(element, config.width), enabled);
    setFieldUi(controls.heightInput, config.height || null, readFieldValue(element, config.height), enabled);
    setFieldUi(controls.secondaryInput, config.secondary || null, readFieldValue(element, config.secondary), enabled);
    setFieldUi(controls.tertiaryInput, config.tertiary || null, readFieldValue(element, config.tertiary), enabled);
    setFieldUi(controls.quaternaryInput, config.quaternary || null, readFieldValue(element, config.quaternary), enabled);
    setFieldUi(controls.pointsInput, config.points || null, readFieldValue(element, config.points), enabled);
    setFieldUi(controls.placementInput, config.placement || null, readFieldValue(element, config.placement), enabled);
    setFieldUi(controls.scaleInput, config.scale || null, readFieldValue(element, config.scale), enabled);
    if (controls.jsonInput) {
      controls.jsonInput.placeholder = config.jsonPlaceholder || "\u9ad8\u7ea7\u5b57\u6bb5\uff1a\u53ef\u76f4\u63a5\u7f16\u8f91 JSON";
      controls.jsonInput.value = JSON.stringify(element, null, 2);
    }
  }

  function currentScene() {
    return state.activeZone ? ensureScene(state.activeZone) : null;
  }

  function currentElement() {
    var scene = currentScene();
    return scene ? elementById(scene, state.selectedElementId) : null;
  }

  function nextElementId(scene, prefix) {
    var ids = new Set((scene && scene.elements || []).map(function (element) { return element.id; }));
    var index = 1;
    var candidate = prefix;
    while (ids.has(candidate)) {
      candidate = prefix + "-" + index;
      index += 1;
    }
    return candidate;
  }

  function sceneCanvas(scene) {
    return {
      width: scene && scene.canvas && scene.canvas.width ? Number(scene.canvas.width) : 4800,
      height: scene && scene.canvas && scene.canvas.height ? Number(scene.canvas.height) : 2600
    };
  }

  function defaultPortPosition(scene, side, width, height) {
    var canvas = sceneCanvas(scene);
    if (side === "right") return { x: canvas.width - width - 280, y: canvas.height * 0.42 };
    if (side === "top") return { x: canvas.width * 0.46, y: 280 };
    if (side === "bottom") return { x: canvas.width * 0.46, y: canvas.height - height - 280 };
    return { x: 280, y: canvas.height * 0.42 };
  }

  function defaultGroundPosition(scene, side) {
    var canvas = sceneCanvas(scene);
    if (side === "right") return { x: canvas.width - 320, y: canvas.height * 0.34 };
    if (side === "top") return { x: canvas.width * 0.48, y: 320 };
    if (side === "bottom") return { x: canvas.width * 0.48, y: canvas.height - 320 };
    return { x: 320, y: canvas.height * 0.34 };
  }

  function nearestPortBySide(scene, side) {
    var ports = (scene && scene.elements || []).filter(function (element) {
      return element.kind === "rect" && element.role === "port";
    });
    if (!ports.length) return null;
    var sidePorts = ports.filter(function (port) {
      return port.meta && port.meta.side === side;
    });
    if (sidePorts.length) return sidePorts[0];
    return ports[0];
  }

  function saveScene(context, scene) {
    if (!state.activeZone || !scene) return;
    writeScene(state.activeZone, scene);
    renderScene(state.activeZone);
    context.schedulePagination(80, { afterPaint: true });
    context.saveActivePage();
  }

  function applyPanelEdits(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene || !state.selectedElementId) return;
    var panel = doc.getElementById("overlayEditorPanel");
    var controls = getPanelControls(panel);
    var parsed = {};
    if ((controls.jsonInput.value || "").trim()) {
      try {
        parsed = JSON.parse(controls.jsonInput.value);
      } catch (error) {
        alert("JSON \u683c\u5f0f\u4e0d\u6b63\u786e\uff0c\u8bf7\u5148\u4fee\u6b63\u540e\u518d\u5e94\u7528\u3002");
        return;
      }
    }
    try {
      scene.elements = (scene.elements || []).map(function (element) {
        if (element.id !== state.selectedElementId) return element;
        var config = sceneFieldConfig(element);
        var next = Object.assign(clone(element), clone(parsed));
        next.id = element.id;
        next.kind = element.kind;
        applyFieldValue(next, controls.primaryInput, config.primary);
        applyFieldValue(next, controls.xInput, config.x);
        applyFieldValue(next, controls.yInput, config.y);
        applyFieldValue(next, controls.widthInput, config.width);
        applyFieldValue(next, controls.heightInput, config.height);
        applyFieldValue(next, controls.secondaryInput, config.secondary);
        applyFieldValue(next, controls.tertiaryInput, config.tertiary);
        applyFieldValue(next, controls.quaternaryInput, config.quaternary);
        applyFieldValue(next, controls.pointsInput, config.points);
        applyFieldValue(next, controls.placementInput, config.placement);
        applyFieldValue(next, controls.scaleInput, config.scale);
        return next;
      });
    } catch (error) {
      alert(error && error.message ? error.message : "\u8fde\u7ebf\u8282\u70b9\u4fee\u6539\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u8f93\u5165\u683c\u5f0f\u3002");
      return;
    }
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function deleteCurrentElement(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene || !state.selectedElementId) return;
    scene.elements = (scene.elements || []).filter(function (element) {
      return element.id !== state.selectedElementId;
    });
    state.selectedElementId = null;
    saveScene(context, scene);
    updatePanel(doc, null);
  }

  function duplicateCurrentPort(context) {
    var doc = context.document;
    var scene = currentScene();
    var element = currentElement();
    if (!scene || !element || element.kind !== "rect" || element.role !== "port") {
      alert("Please select a port rectangle before duplicating the current port.");
      return;
    }
    var next = clone(element);
    next.id = nextElementId(scene, element.id + "-copy");
    next.x = Number(next.x || 0) + 80;
    next.y = Number(next.y || 0) + 80;
    if (next.meta) {
      next.meta = clone(next.meta);
      next.meta.is_manual = true;
    }
    scene.elements.push(next);
    state.selectedElementId = next.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addManualLine(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var baseX = scene.canvas && scene.canvas.width ? scene.canvas.width * 0.42 : 1200;
    var baseY = scene.canvas && scene.canvas.height ? scene.canvas.height * 0.45 : 900;
    var line = {
      id: nextElementId(scene, "manual-line"),
      kind: "polyline",
      role: "manual_line",
      x: Number(baseX.toFixed(3)),
      y: Number(baseY.toFixed(3)),
      points: [
        [0, 0],
        [180, 0]
      ],
      stroke: "#000000",
      fill: "none",
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      editable: { position: true, size: false, text: false },
      meta: { is_manual: true }
    };
    scene.elements.push(line);
    state.selectedElementId = line.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addPortRect(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var panel = doc.getElementById("overlayEditorPanel");
    var controls = getPanelControls(panel);
    var side = controls.newPortSideInput ? controls.newPortSideInput.value : "left";
    var width = 120;
    var height = 120;
    var position = defaultPortPosition(scene, side, width, height);
    var port = {
      id: nextElementId(scene, "manual-port"),
      kind: "rect",
      role: "port",
      x: Number(position.x.toFixed(3)),
      y: Number(position.y.toFixed(3)),
      width: width,
      height: height,
      stroke: "#000000",
      fill: "none",
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      editable: { position: true, size: true, text: false },
      meta: {
        is_manual: true,
        port_index: "manual",
        side: side,
        is_ground: false
      }
    };
    scene.elements.push(port);
    state.selectedElementId = port.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addGroundSymbol(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var panel = doc.getElementById("overlayEditorPanel");
    var controls = getPanelControls(panel);
    var side = controls.newGroundSideInput ? controls.newGroundSideInput.value : "left";
    var placement = controls.newGroundPlacementInput ? controls.newGroundPlacementInput.value : "above";
    var position = defaultGroundPosition(scene, side);
    var symbol = {
      id: nextElementId(scene, "manual-ground"),
      kind: "ground_symbol",
      role: "ground_symbol",
      x: Number(position.x.toFixed(3)),
      y: Number(position.y.toFixed(3)),
      side: side,
      placement: placement,
      scale: DEFAULT_GROUND_SCALE,
      stroke_width: DEFAULT_GROUND_STROKE_WIDTH,
      editable: { position: true, size: true, text: false },
      meta: { is_manual: true }
    };
    scene.elements.push(symbol);
    state.selectedElementId = symbol.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addTextLabel(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var text = {
      id: nextElementId(scene, "manual-text"),
      kind: "text",
      role: "manual_text",
      x: scene.canvas && scene.canvas.width ? Number((scene.canvas.width * 0.18).toFixed(3)) : 700,
      y: scene.canvas && scene.canvas.height ? Number((scene.canvas.height * 0.22).toFixed(3)) : 480,
      text: "Text",
      font_size: DEFAULT_SCENE_FONT_SIZE,
      text_anchor: "start",
      editable: { position: true, size: false, text: true },
      meta: { is_manual: true }
    };
    scene.elements.push(text);
    state.selectedElementId = text.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addAmplifierBlock(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var amp = {
      id: nextElementId(scene, "manual-amp"),
      kind: "amplifier_block",
      role: "amplifier_block",
      x: scene.canvas && scene.canvas.width ? Number((scene.canvas.width * 0.52).toFixed(3)) : 2200,
      y: scene.canvas && scene.canvas.height ? Number((scene.canvas.height * 0.46).toFixed(3)) : 1100,
      width: 300,
      height: 220,
      label: "AMP",
      font_size: DEFAULT_SCENE_FONT_SIZE,
      stroke: "#000000",
      fill: "#ffffff",
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      editable: { position: true, size: true, text: true },
      meta: { is_manual: true }
    };
    scene.elements.push(amp);
    state.selectedElementId = amp.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addResistorCircuit(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var panel = doc.getElementById("overlayEditorPanel");
    var controls = getPanelControls(panel);
    var label = controls.newResistorRoleInput ? controls.newResistorRoleInput.value : "RFin";
    var side = label === "RFout" ? "right" : "left";
    var port = nearestPortBySide(scene, side);
    var baseX = port ? Number(port.x || 0) + (side === "right" ? Number(port.width || 0) : 0) : (scene.canvas && scene.canvas.width ? scene.canvas.width * 0.20 : 920);
    var baseY = port ? Number(port.y || 0) + Number(port.height || 0) / 2 : (scene.canvas && scene.canvas.height ? scene.canvas.height * 0.50 : 1180);
    var resistor = {
      id: nextElementId(scene, "manual-resistor"),
      kind: "resistor_block",
      role: "manual_resistor",
      x: Number(baseX.toFixed(3)),
      y: Number(baseY.toFixed(3)),
      side: side,
      label: label,
      value_text: "50Ohm",
      scale: 2.1,
      font_size: DEFAULT_SCENE_FONT_SIZE,
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      editable: { position: true, size: true, text: true },
      meta: { is_manual: true }
    };
    scene.elements.push(resistor);
    state.selectedElementId = resistor.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addVdSupply(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var supply = {
      id: nextElementId(scene, "manual-vd-supply"),
      kind: "vd_supply",
      role: "vd_supply",
      x: scene.canvas && scene.canvas.width ? Number((scene.canvas.width * 0.50).toFixed(3)) : 2100,
      y: scene.canvas && scene.canvas.height ? Number((scene.canvas.height * 0.62).toFixed(3)) : 1500,
      side: "bottom",
      scale: 2.1,
      font_size: DEFAULT_SCENE_FONT_SIZE,
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      capacitor_text: "100pF",
      box_text: "C",
      source_text: "Vd",
      voltage_text: "+5V",
      editable: { position: true, size: true, text: true },
      meta: { is_manual: true }
    };
    scene.elements.push(supply);
    state.selectedElementId = supply.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function addDimensionLabel(context) {
    var doc = context.document;
    var scene = currentScene();
    if (!scene) return;
    var panel = doc.getElementById("overlayEditorPanel");
    var controls = getPanelControls(panel);
    var orientation = controls.newDimensionOrientationInput ? controls.newDimensionOrientationInput.value : "left";
    var canvas = sceneCanvas(scene);
    var x = orientation === "right" ? canvas.width - 320 : orientation === "bottom" ? canvas.width * 0.52 : 320;
    var y = orientation === "bottom" ? canvas.height - 320 : canvas.height * 0.24;
    var label = {
      id: nextElementId(scene, "manual-dimension"),
      kind: "dimension_label",
      role: "manual_dimension",
      orientation: orientation,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      text: "1000",
      stroke_width: DEFAULT_SCENE_STROKE_WIDTH,
      tick_length: 80,
      text_gap: 25,
      font_size: DEFAULT_SCENE_FONT_SIZE,
      editable: { position: true, size: false, text: true },
      meta: { is_manual: true }
    };
    scene.elements.push(label);
    state.selectedElementId = label.id;
    saveScene(context, scene);
    updatePanel(doc, currentElement());
  }

  function bindPanel(context) {
    var doc = context.document;
    var legacyPanel = doc.getElementById("overlayEditorPanelSidebar");
    if (legacyPanel && legacyPanel.parentNode) legacyPanel.parentNode.removeChild(legacyPanel);
    var panel = doc.getElementById("overlayEditorPanel");
    if (!panel) return;
    if (panel.dataset.sceneEditorBound !== "true") {
      panel.dataset.sceneEditorBound = "true";
      ensureActionButtons(panel);
      configureInsertControls(panel);
      var controls = getPanelControls(panel);
      if (controls.newPortSideInput) controls.newPortSideInput.value = "left";
      if (controls.newGroundSideInput) controls.newGroundSideInput.value = "left";
      if (controls.newGroundPlacementInput) controls.newGroundPlacementInput.value = "above";
      if (controls.newResistorRoleInput) controls.newResistorRoleInput.value = "RFin";
      if (controls.newDimensionOrientationInput) controls.newDimensionOrientationInput.value = "left";

      panel.querySelector("[data-overlay-apply]").addEventListener("click", function () {
        applyPanelEdits(context);
      });

      panel.querySelector("[data-overlay-delete]").addEventListener("click", function () {
        deleteCurrentElement(context);
      });

      panel.querySelector("[data-overlay-duplicate-port]").addEventListener("click", function () {
        duplicateCurrentPort(context);
      });

      panel.querySelector("[data-overlay-add-line]").addEventListener("click", function () {
        addManualLine(context);
      });

      panel.querySelector("[data-overlay-add-port]").addEventListener("click", function () {
        addPortRect(context);
      });

      panel.querySelector("[data-overlay-add-ground]").addEventListener("click", function () {
        addGroundSymbol(context);
      });

      panel.querySelector("[data-overlay-add-text]").addEventListener("click", function () {
        addTextLabel(context);
      });

      panel.querySelector("[data-overlay-add-amplifier]").addEventListener("click", function () {
        addAmplifierBlock(context);
      });

      panel.querySelector("[data-overlay-add-resistor]").addEventListener("click", function () {
        addResistorCircuit(context);
      });

      panel.querySelector("[data-overlay-add-vd-supply]").addEventListener("click", function () {
        addVdSupply(context);
      });

      panel.querySelector("[data-overlay-add-dimension]").addEventListener("click", function () {
        addDimensionLabel(context);
      });
    }

    if (doc.body && doc.body.dataset.overlayEditorDelegated !== "true") {
      doc.body.dataset.overlayEditorDelegated = "true";
      addDelegatedListener(doc, "click", function (event) {
        var openButton = event.target.closest("[data-open-overlay-editor]");
        if (openButton) {
          event.preventDefault();
          selectEditorTarget(doc, openButton.getAttribute("data-open-overlay-editor"));
          return;
        }
      });
    }

    if (doc.body && doc.body.dataset.overlayEditorCloseDelegated !== "true") {
      doc.body.dataset.overlayEditorCloseDelegated = "true";
      addDelegatedListener(doc, "click", function (event) {
        var closeButton = event.target.closest("[data-overlay-close]");
        if (!closeButton) return;
        state.activeType = null;
        state.activeZone = null;
        state.activeItem = null;
        state.selectedElementId = null;
        state.drag = null;
        updatePanel(doc, null);
        closeOverlayEditor(doc);
      });
    }

    if (doc.body && doc.body.dataset.overlayEditorEscBound !== "true") {
      doc.body.dataset.overlayEditorEscBound = "true";
      addDelegatedListener(doc, "keydown", function (event) {
        if (event.key !== "Escape") return;
        if (overlayEditorRoot(doc) && !overlayEditorRoot(doc).classList.contains("is-hidden")) {
          state.activeType = null;
          state.activeZone = null;
          state.activeItem = null;
          state.selectedElementId = null;
          state.drag = null;
          updatePanel(doc, null);
          closeOverlayEditor(doc);
        }
      });
    }
  }

  function bindZone(zone, context) {
    if (!zone || zone.dataset.sceneZoneBound === "true") return;
    zone.dataset.sceneZoneBound = "true";

    zone.addEventListener("click", function (event) {
      if (event.target.closest(".image-resize-handle")) return;
      var elementNode = event.target.closest("[data-scene-element-id]");
      if (!ensureScene(zone)) return;
      if (event.target.closest(".remove-image")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.activeZone || state.activeZone !== zone) {
        activateEditorForZone(context.document, zone, { open: false });
      }
      if (!elementNode || !state.activeZone || state.activeZone !== zone) return;
      state.selectedElementId = elementNode.getAttribute("data-scene-element-id");
      renderScene(zone);
      updatePanel(context.document, currentElement());
      openOverlayEditor(context.document);
    }, true);

    zone.addEventListener("pointerdown", function (event) {
      var elementNode = event.target.closest("[data-scene-element-id]");
      if (!elementNode) return;
      if (!state.activeZone || state.activeZone !== zone) {
        activateEditorForZone(context.document, zone, { open: false });
      }
      if (!state.activeZone || state.activeZone !== zone) return;
      var scene = currentScene();
      var element = scene ? elementById(scene, elementNode.getAttribute("data-scene-element-id")) : null;
      if (!element || !(element.editable && element.editable.position)) return;
      state.selectedElementId = element.id;
      var svg = zone.querySelector("svg.scene-svg");
      var matrix = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
      state.drag = {
        startX: event.clientX,
        startY: event.clientY,
        inverseMatrix: matrix ? matrix.inverse() : null,
        element: clone(element)
      };
      try {
        if (zone.setPointerCapture && event.pointerId != null) zone.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore browsers that do not support pointer capture for this target.
      }
      event.preventDefault();
    });

    zone.addEventListener("pointermove", function (event) {
      if (!state.drag || !state.activeZone || state.activeZone !== zone) return;
      var scene = currentScene();
      var svg = zone.querySelector("svg.scene-svg");
      if (!scene || !svg) return;
      var dx;
      var dy;
      if (state.drag.inverseMatrix && svg.createSVGPoint) {
        var start = svg.createSVGPoint();
        start.x = state.drag.startX;
        start.y = state.drag.startY;
        var current = svg.createSVGPoint();
        current.x = event.clientX;
        current.y = event.clientY;
        var startScene = start.matrixTransform(state.drag.inverseMatrix);
        var currentScene = current.matrixTransform(state.drag.inverseMatrix);
        dx = currentScene.x - startScene.x;
        dy = currentScene.y - startScene.y;
      } else {
        var rect = svg.getBoundingClientRect();
        var viewBox = svg.viewBox.baseVal;
        dx = (event.clientX - state.drag.startX) * viewBox.width / Math.max(rect.width, 1);
        dy = (event.clientY - state.drag.startY) * viewBox.height / Math.max(rect.height, 1);
      }
      scene.elements = (scene.elements || []).map(function (element) {
        if (element.id !== state.selectedElementId) return element;
        var next = clone(element);
        next.x = Number(state.drag.element.x || 0) + dx;
        next.y = Number(state.drag.element.y || 0) + dy;
        return next;
      });
      writeScene(zone, scene);
      renderScene(zone);
      updatePanel(context.document, currentElement());
    });

    zone.addEventListener("pointerup", function (event) {
      if (!state.drag || !state.activeZone || state.activeZone !== zone) return;
      state.drag = null;
      try {
        if (zone.releasePointerCapture && event.pointerId != null) zone.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Safe fallback when pointer capture was never acquired.
      }
      updatePanel(context.document, currentElement());
      openOverlayEditor(context.document);
      context.schedulePagination(80, { afterPaint: true });
      context.saveActivePage();
    });
  }

  registry.applyLayoutScene = function applyLayoutScene(context, type, scene) {
    var zone = context.document.querySelector(zoneSelector(type));
    if (!zone || !scene) return;
    writeScene(zone, normalizeGeneratedScene(scene));
    renderScene(zone);
    bindZone(zone, context);
  };

  registry.bindOverlayImageEditor = function bindOverlayImageEditor(context) {
    bindPanel(context);
    updateAllSceneBindings(context.document);
    context.document.querySelectorAll(".dimension-images[data-image-zone], .assembly-image[data-image-zone], .function-block-image[data-image-zone], .half-panel [data-image-zone]").forEach(function (zone) {
      bindZone(zone, context);
    });
  };

  registry.disposeOverlayImageEditor = function disposeOverlayImageEditor() {
    delegatedListeners.forEach(function (item) {
      item.doc.removeEventListener(item.type, item.handler);
    });
    delegatedListeners = [];
    if (document.body) {
      delete document.body.dataset.overlayEditorDelegated;
      delete document.body.dataset.overlayEditorCloseDelegated;
      delete document.body.dataset.overlayEditorEscBound;
    }
    state.activeType = null;
    state.activeZone = null;
    state.activeItem = null;
    state.selectedElementId = null;
    state.drag = null;
  };
})();
