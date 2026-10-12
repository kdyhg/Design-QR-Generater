"use strict";

const QR_CONFIG = Object.freeze({ correction: "H", contrastWarning: 4.5, maxBatch: 30 });
const DEFAULTS = Object.freeze({
  shapeSelect: "heart", dotStyle: "square", fgColor: "#000000", bgColor: "#ffffff",
  gradientMode: "solid", gradientColor: "#d9365e", pngSize: "1024", paletteSelect: "custom"
});
const PALETTES = {
  classic: ["#000000", "#ffffff", "#000000", "solid"],
  pink: ["#a72354", "#ffffff", "#ef648c", "gradient"],
  ocean: ["#174e8d", "#ffffff", "#097f95", "gradient"],
  forest: ["#145a40", "#ffffff", "#4b9378", "gradient"],
  dusk: ["#623b9a", "#ffffff", "#d14d81", "gradient"]
};
const $ = (id) => document.getElementById(id);
let logoImage = null;
let logoDataUrl = "";
let lastGenerated = null;
let decorationSeedOffset = 0;
let updateTimer = null;
let busy = false;

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  $("qrForm").addEventListener("submit", (ev) => { ev.preventDefault(); generateQR(); });
  $("contentType").addEventListener("change", () => { switchInputMode(); invalidate(); scheduleGenerate(); });
  for (const id of ["urlInput", "textInput", "wifiSsid", "wifiPassword"]) {
    $(id).addEventListener("input", () => { invalidate(); scheduleGenerate(); });
  }
  for (const id of ["wifiSecurity", "wifiHidden"]) {
    $(id).addEventListener("change", () => { invalidate(); scheduleGenerate(); });
  }
  for (const id of Object.keys(DEFAULTS).filter((id) => id !== "paletteSelect")) {
    const event = ["fgColor", "bgColor", "gradientColor"].includes(id) ? "input" : "change";
    $(id).addEventListener(event, () => {
      $("paletteSelect").value = "custom";
      saveSettings();
      if (id !== "pngSize") generateQR();
    });
  }
  $("paletteSelect").addEventListener("change", applyPalette);
  $("shuffleButton").addEventListener("click", () => { decorationSeedOffset += 1; generateQR(); });
  $("logoInput").addEventListener("change", loadLogo);
  $("removeLogo").addEventListener("click", () => {
    logoImage = null; logoDataUrl = ""; $("logoInput").value = "";
    $("removeLogo").disabled = true; generateQR();
  });
  $("resetButton").addEventListener("click", resetDesign);
  $("copyButton").addEventListener("click", copyClipboard);
  $("saveButton").addEventListener("click", savePNG);
  $("saveSvgButton").addEventListener("click", saveSVG);
  $("batchButton").addEventListener("click", createBatch);
  switchInputMode();
  generateQR();
});

function showMessage(message) {
  const box = $("status-msg");
  box.textContent = message;
  box.style.display = "block";
  clearTimeout(showMessage.timeout);
  showMessage.timeout = setTimeout(() => { box.style.display = "none"; }, 3300);
}
function setScanState(type, title, detail) {
  $("scanPanel").className = "scan-panel " + type;
  $("scanStatus").textContent = title;
  $("scanDetails").textContent = detail;
}
function switchInputMode() {
  const kind = $("contentType").value;
  $("urlGroup").hidden = kind !== "url";
  $("textGroup").hidden = kind !== "text";
  $("wifiGroup").hidden = kind !== "wifi";
  $("wifiPasswordGroup").hidden = kind !== "wifi" || $("wifiSecurity").value === "nopass";
}
function invalidate() {
  lastGenerated = null;
  refreshExportState();
  setScanState("warning", "내용 변경됨", "입력한 내용으로 QR코드를 다시 생성합니다.");
}
function scheduleGenerate() {
  switchInputMode();
  clearTimeout(updateTimer);
  updateTimer = setTimeout(generateQR, 380);
}
function refreshExportState() {
  const disabled = !lastGenerated || busy;
  for (const id of ["saveButton", "saveSvgButton", "copyButton"]) $(id).disabled = disabled;
  $("batchButton").disabled = busy;
}
function escWifi(value) { return String(value).replace(/([\\;,:"'])/g, "\\$1"); }
function readPayload() {
  const kind = $("contentType").value;
  if (kind === "url") {
    const raw = $("urlInput").value.trim();
    return { kind, value: normalizeUrl(raw) };
  }
  if (kind === "text") {
    const value = $("textInput").value.trim();
    if (!value) throw new Error("QR로 만들 텍스트를 입력해주세요.");
    return { kind, value };
  }
  const ssid = $("wifiSsid").value;
  if (!ssid.trim()) throw new Error("Wi-Fi 이름(SSID)을 입력해주세요.");
  const security = $("wifiSecurity").value;
  if (!["WPA", "WEP", "nopass"].includes(security)) throw new Error("Wi-Fi 보안 유형을 확인해주세요.");
  const password = security === "nopass" ? "" : $("wifiPassword").value;
  if (security !== "nopass" && !password) throw new Error("Wi-Fi 비밀번호를 입력해주세요.");
  return { kind, value: "WIFI:T:" + security + ";S:" + escWifi(ssid) + ";P:" + escWifi(password) +
    ";H:" + ($("wifiHidden").checked ? "true" : "false") + ";;" };
}
function normalizeUrl(value) {
  if (!value) throw new Error("URL을 입력해주세요.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : "https://" + value;
  let url;
  try { url = new URL(withProtocol); }
  catch { throw new Error("올바른 URL을 입력해주세요."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("http/https 주소만 지원합니다.");
  return url.href;
}
function createQr(value) {
  if (typeof qrcode !== "function") throw new Error("QR 생성 라이브러리를 확인해주세요.");
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  }
  try {
    const qr = qrcode(0, QR_CONFIG.correction);
    qr.addData(value, "Byte"); qr.make();
    return qr;
  } catch {
    throw new Error("입력한 내용이 너무 깁니다. 내용을 줄여주세요.");
  }
}
function getCellSize(count) {
  if (count <= 33) return 12;
  if (count <= 57) return 10;
  if (count <= 85) return 8;
  return 6;
}
function getOrnamentModules(shape, count) {
  if (shape === "square") return 0;
  return Math.max(Math.round(count * (shape === "star" ? 1.10 : 0.42)), 12);
}
function buildLayout(qr, shape) {
  const count = qr.getModuleCount(), cellSize = getCellSize(count);
  const qrSize = count * cellSize;
  const outer = getOrnamentModules(shape, count) * cellSize;
  return { count, cellSize, qrSize, outer, canvasSize: qrSize + 2 * outer, qrX: outer, qrY: outer };
}
function currentOptions() {
  return {
    shape: $("shapeSelect").value, dotStyle: $("dotStyle").value,
    fg: $("fgColor").value, bg: $("bgColor").value,
    gradient: $("gradientMode").value === "gradient",
    gradientColor: $("gradientColor").value,
    logo: logoImage, logoDataUrl,
    seedOffset: decorationSeedOffset
  };
}
function generateQR() {
  clearTimeout(updateTimer);
  const canvas = $("qrCanvas");
  $("shuffleButton").disabled = $("shapeSelect").value === "square";
  try {
    const payload = readPayload(), opts = currentOptions();
    const result = renderPayload(payload.value, opts, canvas);
    const report = verifyCanvas(canvas, payload.value, result.warnings);
    lastGenerated = { ...result, value: payload.value, options: opts, verified: report.verified };
    const edgeNote = opts.shape !== "square"
      ? "장식과 QR 사이 지정 여백 0칸 · 실제 카메라 스캔도 확인해주세요."
      : "기본 사각형 QR · 외부 여백 0칸";
    setScanState(report.type, report.title, report.detail + " " + edgeNote);
  } catch (err) {
    lastGenerated = null;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setScanState("error", "생성할 수 없음", err.message || "QR 생성 중 오류가 발생했습니다.");
  }
  refreshExportState();
}
function renderPayload(value, opts, canvas) {
  const qr = createQr(value), layout = buildLayout(qr, opts.shape);
  canvas.width = layout.canvasSize; canvas.height = layout.canvasSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas를 지원하지 않는 브라우저입니다.");

  // Keep the ornaments dense and uniform. Never sacrifice the silhouette
  // to satisfy a single browser decoder: users can test the exported image
  // on the actual phone they intend to use.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = canvasInk(ctx, opts, layout);
  if (opts.shape !== "square") {
    eachDecoration(layout, opts, value, (x, y, size) => ctx.fillRect(x, y, size, size), qr);
  }
  eachModule(qr, layout, opts.dotStyle, (shape, x, y, size) => drawModule(ctx, shape, x, y, size));
  if (opts.logo) drawLogo(ctx, layout, opts);

  return { qr, layout, warnings: getQualityWarnings(opts) };
}
function decodeMatches(canvas, expected) {
  if (typeof jsQR !== "function") return false;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(data.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    return Boolean(result && result.data === expected);
  } catch { return false; }
}
function decodeMatchesAtPreviewSize(canvas, expected) {
  if (typeof jsQR !== "function") return false;
  try {
    const edge = Math.min(420, canvas.width);
    if (edge === canvas.width) return true;
    const mini = document.createElement("canvas");
    mini.width = edge; mini.height = edge;
    const context = mini.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.imageSmoothingEnabled = true;
    context.drawImage(canvas, 0, 0, edge, edge);
    const sample = context.getImageData(0, 0, edge, edge);
    const result = jsQR(sample.data, edge, edge, { inversionAttempts: "attemptBoth" });
    return Boolean(result && result.data === expected);
  } catch { return false; }
}
function canvasInk(ctx, opts, layout) {
  if (!opts.gradient) return opts.fg;
  const grad = ctx.createLinearGradient(0, 0, layout.canvasSize, layout.canvasSize);
  grad.addColorStop(0, opts.fg); grad.addColorStop(1, opts.gradientColor);
  return grad;
}
function drawModule(ctx, shape, x, y, size) {
  if (shape === "circle") {
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * 0.46, 0, Math.PI * 2); ctx.fill();
  } else if (shape === "rounded") {
    const r = size * 0.27;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + size - r, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + r);
    ctx.lineTo(x + size, y + size - r);
    ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
    ctx.lineTo(x + r, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillRect(x, y, size, size);
  }
}
function alignmentCenters(count) {
  const version = Math.round((count - 17) / 4);
  if (version <= 1) return [];
  const number = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + number * 2 + 1) / (number * 2 - 2)) * 2;
  const positions = [6];
  for (let p = count - 7; positions.length < number; p -= step) positions.splice(1, 0, p);
  return positions;
}
function isProtectedModule(row, col, count, alignment) {
  if ((row < 9 && col < 9) || (row < 9 && col >= count - 8) ||
      (row >= count - 8 && col < 9)) return true;
  if (row === 6 || col === 6 || row === 8 || col === 8) return true;
  for (const cy of alignment) for (const cx of alignment) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === count - 7) || (cx === count - 7 && cy === 6)) continue;
    if (Math.abs(col - cx) <= 2 && Math.abs(row - cy) <= 2) return true;
  }
  return false;
}
function eachModule(qr, layout, style, callback) {
  const alignments = alignmentCenters(layout.count);
  for (let row = 0; row < layout.count; row++) {
    for (let col = 0; col < layout.count; col++) {
      if (!qr.isDark(row, col)) continue;
      const shape = isProtectedModule(row, col, layout.count, alignments) ? "square" : style;
      callback(shape, layout.qrX + col * layout.cellSize,
        layout.qrY + row * layout.cellSize, layout.cellSize);
    }
  }
}
// Uniform pixel-art silhouette with one connected pattern.
// The outline is drawn solid, the interior has a stable QR-like texture.
// All shapes use the same density (unlike the old sparse edge profiles).
// Match the visible ornament texture to the density of the QR itself.
function getQrDarkRatio(qr) {
  const n = qr.getModuleCount();
  let dark = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) dark++;
    }
  }
  return dark / (n * n);
}
function decorationMatrix(layout, opts, value, qr = null) {
  const sourceQr = qr || createQr(value);
  const cols = layout.canvasSize / layout.cellSize;
  const length = cols * cols;
  const mask = new Uint8Array(length);
  const outline = new Uint8Array(length);
  const scores = new Float32Array(length);
  const first = layout.qrX / layout.cellSize;
  const last = first + layout.count;
  const at = (row, col) => row * cols + col;
  const inBounds = (row, col) => row >= 0 && col >= 0 && row < cols && col < cols;
  const inQR = (row, col) => row >= first && row < last && col >= first && col < last;
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const seed = value + "|" + opts.shape + "|" + (opts.seedOffset || 0);
  let area = 0;
  for (let row = 0; row < cols; row++) for (let col = 0; col < cols; col++) {
    if (inQR(row, col)) continue;
    if (!insideShape(opts.shape, (col + 0.5) * layout.cellSize,
      (row + 0.5) * layout.cellSize, layout.canvasSize)) continue;
    const i = at(row, col);
    mask[i] = 1;
    area++;
    // A modest 2x2 texture component creates QR-like clumps, not isolated specks.
    const fine = seededUnit("fine|" + seed + "|" + row + "|" + col);
    const block = seededUnit("tile|" + seed + "|" +
      Math.floor(row / 2) + "|" + Math.floor(col / 2));
    scores[i] = 0.78 * fine + 0.22 * block;
  }
  for (let row = 0; row < cols; row++) for (let col = 0; col < cols; col++) {
    const i = at(row, col);
    if (!mask[i]) continue;
    // Preserve the recognisable solid silhouette, including sharp star tips.
    outline[i] = neighbors.some(([dy, dx]) => {
      const y = row + dy, x = col + dx;
      return !inBounds(y, x) || (!mask[at(y, x)] && !inQR(y, x));
    }) ? 1 : 0;
  }

  function connected(threshold) {
    const candidate = new Uint8Array(length);
    const kept = new Uint8Array(length);
    const queue = [];
    for (let row = 0; row < cols; row++) for (let col = 0; col < cols; col++) {
      const i = at(row, col);
      if (!mask[i] || (!outline[i] && scores[i] >= threshold)) continue;
      candidate[i] = 1;
      if (neighbors.some(([dy, dx]) => inQR(row + dy, col + dx))) {
        kept[i] = 1;
        queue.push(i);
      }
    }
    if (!queue.length) {
      const firstDark = candidate.indexOf(1);
      if (firstDark !== -1) { kept[firstDark] = 1; queue.push(firstDark); }
    }
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k], row = Math.floor(i / cols), col = i % cols;
      for (const [dy, dx] of neighbors) {
        const y = row + dy, x = col + dx;
        if (!inBounds(y, x)) continue;
        const next = at(y, x);
        if (candidate[next] && !kept[next]) { kept[next] = 1; queue.push(next); }
      }
    }
    // Retain pixels at acute tips if they touch a kept region diagonally.
    for (let pass = 0; pass < 2; pass++) {
      for (let row = 0; row < cols; row++) for (let col = 0; col < cols; col++) {
        const i = at(row, col);
        if (!candidate[i] || kept[i]) continue;
        if ([[-1,-1],[-1,1],[1,-1],[1,1]].some(([dy,dx]) =>
          inBounds(row + dy,col + dx) && kept[at(row + dy,col + dx)])) kept[i] = 1;
      }
    }
    let count = 0;
    for (const bit of kept) count += bit;
    return {dark: kept, count};
  }

  const targetRatio = getQrDarkRatio(sourceQr);
  const desired = Math.round(targetRatio * area);
  // Bisection compensates for the darker silhouette outline and removes
  // disconnected pixels without producing a patchy, lower-density shape.
  let low = 0, high = 1;
  let best = connected(0.5);
  for (let i = 0; i < 10; i++) {
    const threshold = (low + high) / 2;
    const trial = connected(threshold);
    if (Math.abs(trial.count - desired) < Math.abs(best.count - desired)) best = trial;
    if (trial.count < desired) low = threshold; else high = threshold;
  }
  return {
    cols,
    dark: best.dark,
    targetRatio,
    actualRatio: area ? best.count / area : 0
  };
}
function eachDecoration(layout, opts, value, callback, qr = null) {
  const pattern = decorationMatrix(layout, opts, value, qr);
  const unit = layout.cellSize;
  for (let r = 0; r < pattern.cols; r++) for (let c = 0; c < pattern.cols; c++) {
    if (pattern.dark[r * pattern.cols + c]) callback(c * unit, r * unit, unit);
  }
}
function inRect(x, y, rect) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}
function insideShape(shape, x, y, size) {
  const nx = (x - size / 2) / (size / 2);
  const ny = (y - size / 2) / (size / 2);
  if (shape === "circle") return nx * nx + ny * ny < 0.95 * 0.95;
  if (shape === "flower") {
    const angle = Math.atan2(ny, nx);
    const radius = Math.hypot(nx, ny);
    return radius < 0.79 + 0.16 * Math.cos(8 * angle);
  }
  if (shape === "bubble") {
    const circle = Math.hypot(nx, ny + 0.07) < 0.87;
    const tail = ny > 0.45 && ny < 0.98 && nx > 0.13 && nx < 0.49 - (ny - 0.45) * 0.23;
    return circle || tail;
  }
  if (shape === "cloud") {
    const clouds = [[0, 0.13, 0.77], [-0.46, 0.1, 0.49], [0.46, 0.12, 0.50],
      [-0.20, -0.37, 0.52], [0.25, -0.34, 0.49]];
    return clouds.some(([cx, cy, r]) => Math.hypot(nx - cx, ny - cy) < r);
  }
  if (shape === "heart") {
    const a = nx / 0.86, b = -ny / 0.80 + 0.12;
    return Math.pow(a * a + b * b - 1, 3) - a * a * b * b * b <= 0;
  }
  if (shape === "star") {
    // Straight edges between 5 outer tips and 5 inner notches.
    return pointInPolygon(nx, ny, SHARP_STAR_POINTS);
  }
  return false;
}
const SHARP_STAR_POINTS = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / 5;
  const radius = i % 2 === 0 ? 0.98 : 0.50;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
});
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi) / (yj - yi)) + xi) inside = !inside;
  }
  return inside;
}

function seededUnit(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13; hash ^= hash >>> 7; hash += hash << 3;
  hash ^= hash >>> 17; hash += hash << 5;
  return (hash >>> 0) / 4294967295;
}
function logoGeometry(layout) {
  const imageSize = Math.floor(layout.qrSize * 0.135);
  const pad = Math.max(2, Math.round(layout.cellSize * 0.7));
  return {
    x: layout.qrX + (layout.qrSize - imageSize) / 2,
    y: layout.qrY + (layout.qrSize - imageSize) / 2,
    size: imageSize, pad
  };
}
function drawLogo(ctx, layout, opts) {
  const g = logoGeometry(layout);
  ctx.fillStyle = opts.bg;
  ctx.fillRect(g.x - g.pad, g.y - g.pad, g.size + 2 * g.pad, g.size + 2 * g.pad);
  ctx.imageSmoothingEnabled = true;
  const scale = Math.min(g.size / opts.logo.width, g.size / opts.logo.height);
  const width = opts.logo.width * scale, height = opts.logo.height * scale;
  ctx.drawImage(opts.logo, g.x + (g.size - width) / 2, g.y + (g.size - height) / 2, width, height);
  ctx.imageSmoothingEnabled = false;
}
function getQualityWarnings(opts) {
  const colors = opts.gradient ? [opts.fg, opts.gradientColor] : [opts.fg];
  const warnings = [];
  const bgLum = luminance(opts.bg);
  if (colors.some((color) => contrastRatio(color, opts.bg) < QR_CONFIG.contrastWarning)) {
    warnings.push("색상 대비가 낮습니다.");
  }
  if (colors.some((color) => luminance(color) >= bgLum)) {
    warnings.push("밝은 배경과 어두운 QR을 권장합니다.");
  }
  if (opts.logo) warnings.push("로고를 넣은 QR은 실제 기기에서도 확인해주세요.");
  return warnings;
}
function luminance(hex) {
  const nums = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channels = nums.map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function verifyCanvas(canvas, expected, warnings) {
  const details = warnings.join(" ");
  if (typeof jsQR !== "function") {
    return { type: "warning", title: "자동 검증 불가", detail: "검증 라이브러리가 없어 스캔 여부를 확인하지 못했습니다. " + details, verified: false };
  }
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    if (result && result.data === expected) {
      return { type: warnings.length ? "warning" : "success",
        title: warnings.length ? "자동 스캔 통과 · 주의" : "자동 스캔 검증 통과",
        detail: "입력한 내용과 디코딩 결과가 일치합니다. " + details,
        verified: true };
    }
    if (result) return { type: "error", title: "다른 내용으로 인식됨",
      detail: "QR을 다른 값으로 읽었습니다. 색상 또는 장식을 변경해주세요.", verified: false };
    return { type: "warning", title: "브라우저 자동 인식 실패",
      detail: "촘촘한 디자인으로 브라우저 디코더가 인식하지 못했습니다. 이미지는 저장 가능하며, 사용 전 휴대전화로 직접 스캔해주세요. " + details, verified: false };
  } catch {
    return { type: "warning", title: "자동 검증 오류",
      detail: "자동 검증을 완료하지 못했습니다. 다른 기기에서 직접 확인해주세요.", verified: false };
  }
}
function loadLogo(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type) || file.size > 2 * 1024 * 1024) {
    ev.target.value = ""; showMessage("PNG, JPG, WEBP, GIF 이미지(2MB 이하)만 첨부할 수 있습니다."); return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      logoImage = image; logoDataUrl = String(reader.result);
      $("removeLogo").disabled = false; generateQR();
    };
    image.onerror = () => showMessage("이미지를 읽지 못했습니다.");
    image.src = String(reader.result);
  };
  reader.onerror = () => showMessage("이미지 파일을 읽지 못했습니다.");
  reader.readAsDataURL(file);
}
function saveSettings() {
  try {
    const settings = {};
    for (const key of Object.keys(DEFAULTS)) settings[key] = $(key).value;
    localStorage.setItem("qrht-design-v2", JSON.stringify(settings));
  } catch { /* 저장을 허용하지 않는 브라우저는 무시합니다. */ }
}
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("qrht-design-v2") || "{}");
    for (const [id, fallback] of Object.entries(DEFAULTS)) {
      const value = saved[id];
      if (typeof value !== "string") { $(id).value = fallback; continue; }
      const el = $(id);
      if (el.type === "color") {
        el.value = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
      } else {
        el.value = Array.from(el.options).some((o) => o.value === value) ? value : fallback;
      }
    }
  } catch {
    for (const [id, value] of Object.entries(DEFAULTS)) $(id).value = value;
  }
}
function applyPalette() {
  const name = $("paletteSelect").value;
  const colors = PALETTES[name];
  if (colors) {
    $("fgColor").value = colors[0]; $("bgColor").value = colors[1];
    $("gradientColor").value = colors[2]; $("gradientMode").value = colors[3];
  }
  saveSettings(); generateQR();
}
function resetDesign() {
  for (const [id, value] of Object.entries(DEFAULTS)) $(id).value = value;
  $("contentType").value = "url"; $("urlInput").value = "https://www.google.com";
  $("textInput").value = ""; $("wifiSsid").value = ""; $("wifiPassword").value = "";
  $("wifiSecurity").value = "WPA"; $("wifiHidden").checked = false;
  $("logoInput").value = ""; $("removeLogo").disabled = true;
  logoImage = null; logoDataUrl = ""; decorationSeedOffset = 0;
  try { localStorage.removeItem("qrht-design-v2"); } catch {}
  switchInputMode(); generateQR(); showMessage("디자인이 초기화되었습니다.");
}
function svgEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function createSVG(result) {
  const { qr, layout, options: opts, value } = result;
  const body = [];
  const fill = opts.gradient ? "url(#qr-gradient)" : opts.fg;
  const n = (x) => Number(x.toFixed(3));
  body.push('<rect width="100%" height="100%" fill="' + opts.bg + '"/>');
  if (opts.shape !== "square") {
    const addDecoration = (x, y, size) => {
      body.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="' + fill + '"/>');
    };
    eachDecoration(layout, opts, value, addDecoration, qr);
  }
  eachModule(qr, layout, opts.dotStyle, (shape, x, y, size) => {
    if (shape === "circle") {
      body.push('<circle cx="' + n(x + size / 2) + '" cy="' + n(y + size / 2) +
        '" r="' + n(size * 0.46) + '" fill="' + fill + '"/>');
    } else {
      const rx = shape === "rounded" ? ' rx="' + n(size * 0.27) + '"' : "";
      body.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size +
        '"' + rx + ' fill="' + fill + '"/>');
    }
  });
  if (opts.logoDataUrl) {
    const g = logoGeometry(layout);
    const scale = Math.min(g.size / opts.logo.width, g.size / opts.logo.height);
    const w = opts.logo.width * scale, h = opts.logo.height * scale;
    body.push('<rect x="' + n(g.x - g.pad) + '" y="' + n(g.y - g.pad) +
      '" width="' + n(g.size + g.pad * 2) + '" height="' + n(g.size + g.pad * 2) +
      '" fill="' + opts.bg + '"/>');
    body.push('<image x="' + n(g.x + (g.size - w) / 2) + '" y="' + n(g.y + (g.size - h) / 2) +
      '" width="' + n(w) + '" height="' + n(h) + '" href="' + svgEscape(opts.logoDataUrl) + '"/>');
  }
  const defs = opts.gradient ? '<defs><linearGradient id="qr-gradient" x1="0" y1="0" x2="' + layout.canvasSize + '" y2="' + layout.canvasSize + '" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="' +
    opts.fg + '"/><stop offset="100%" stop-color="' + opts.gradientColor + '"/></linearGradient></defs>' : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ' +
    'width="' + layout.canvasSize + '" height="' + layout.canvasSize +
    '" viewBox="0 0 ' + layout.canvasSize + ' ' + layout.canvasSize +
    '">' + defs + body.join("") + '</svg>';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function canvasToPng(canvas, size) {
  return new Promise((resolve, reject) => {
    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    const ctx = out.getContext("2d");
    if (!ctx) { reject(new Error("Canvas를 지원하지 않습니다.")); return; }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, size, size);
    out.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG를 만들지 못했습니다.")), "image/png");
  });
}
async function savePNG() {
  if (!lastGenerated || busy) return;
  try {
    const blob = await canvasToPng($("qrCanvas"), Number($("pngSize").value));
    downloadBlob(blob, "qrht_" + lastGenerated.options.shape + ".png");
    showMessage("PNG 이미지를 저장했습니다.");
  } catch (err) { showMessage(err.message); }
}
function saveSVG() {
  if (!lastGenerated || busy) return;
  try {
    const svg = createSVG(lastGenerated);
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "qrht_" + lastGenerated.options.shape + ".svg");
    showMessage("SVG 벡터 파일을 저장했습니다.");
  } catch (err) { showMessage("SVG 저장에 실패했습니다: " + err.message); }
}
async function copyClipboard() {
  if (!lastGenerated || busy) return;
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    showMessage("이 브라우저는 이미지 복사를 지원하지 않습니다. PNG 저장을 이용해주세요."); return;
  }
  try {
    const blob = await canvasToPng($("qrCanvas"), Number($("pngSize").value));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    showMessage("이미지를 복사했습니다.");
  } catch {
    showMessage("복사에 실패했습니다. PNG 저장을 이용해주세요.");
  }
}
// ZIP 저장 방식(STORE): PNG 자체가 압축되어 있으므로 별도의 ZIP 라이브러리가 필요 없습니다.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipFiles(files) {
  const encoder = new TextEncoder(), chunks = [], directory = [];
  let offset = 0, directorySize = 0;
  const u16 = (view, at, val) => view.setUint16(at, val, true);
  const u32 = (view, at, val) => view.setUint32(at, val >>> 0, true);
  for (const file of files) {
    const name = encoder.encode(file.name), bytes = file.bytes, crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length);
    let dv = new DataView(local.buffer);
    u32(dv, 0, 0x04034b50); u16(dv, 4, 20); u16(dv, 6, 0x0800);
    u16(dv, 8, 0); u32(dv, 14, crc); u32(dv, 18, bytes.length);
    u32(dv, 22, bytes.length); u16(dv, 26, name.length);
    local.set(name, 30);
    chunks.push(local, bytes);
    const central = new Uint8Array(46 + name.length);
    dv = new DataView(central.buffer);
    u32(dv, 0, 0x02014b50); u16(dv, 4, 20); u16(dv, 6, 20);
    u16(dv, 8, 0x0800); u16(dv, 10, 0); u32(dv, 16, crc);
    u32(dv, 20, bytes.length); u32(dv, 24, bytes.length);
    u16(dv, 28, name.length); u32(dv, 42, offset); central.set(name, 46);
    directory.push(central); directorySize += central.length;
    offset += local.length + bytes.length;
  }
  const end = new Uint8Array(22), dv = new DataView(end.buffer);
  u32(dv, 0, 0x06054b50); u16(dv, 8, files.length); u16(dv, 10, files.length);
  u32(dv, 12, directorySize); u32(dv, 16, offset);
  return new Blob([...chunks, ...directory, end], { type: "application/zip" });
}
async function createBatch() {
  if (busy) return;
  const lines = $("batchInput").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) { showMessage("일괄 생성할 URL을 한 줄에 하나씩 입력해주세요."); return; }
  if (lines.length > QR_CONFIG.maxBatch) {
    showMessage("한 번에 최대 " + QR_CONFIG.maxBatch + "개까지 생성할 수 있습니다."); return;
  }
  busy = true; refreshExportState();
  const files = [], report = [];
  const opts = currentOptions();
  try {
    for (let i = 0; i < lines.length; i++) {
      $("batchButton").textContent = "생성 중 " + (i + 1) + "/" + lines.length;
      try {
        const value = normalizeUrl(lines[i]);
        const canvas = document.createElement("canvas");
        const item = renderPayload(value, opts, canvas);
        const result = verifyCanvas(canvas, value, item.warnings);
        const blob = await canvasToPng(canvas, Number($("pngSize").value));
        files.push({ name: "qr_" + String(i + 1).padStart(3, "0") + ".png",
          bytes: new Uint8Array(await blob.arrayBuffer()) });
        report.push((i + 1) + ". " + (result.verified ? "자동 검증 통과" : "자동 검증 실패 · 휴대전화 확인 필요") + ": " + value);
      } catch (err) { report.push((i + 1) + ". 실패: " + lines[i] + " (" + err.message + ")"); }
      // 대량 작업 중 화면 업데이트를 허용합니다.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const note = new TextEncoder().encode("QR_HT 일괄 생성 결과\n" +
      "촘촘한 장식형 QR은 브라우저 디코더가 읽지 못할 수 있습니다. 모든 이미지의 휴대전화 인식 여부를 확인해주세요.\n\n" +
      report.join("\n") + "\n");
    files.push({ name: "result.txt", bytes: note });
    downloadBlob(zipFiles(files), "qrht_batch.zip");
    showMessage((files.length - 1) + "개 생성 완료. 결과를 ZIP으로 저장했습니다.");
  } catch (err) {
    showMessage("일괄 생성 실패: " + err.message);
  } finally {
    busy = false; $("batchButton").textContent = "일괄 생성 · ZIP 저장"; refreshExportState();
  }
}
