"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const ids = new Map();
const document = {
  addEventListener() {},
  getElementById(id) { return ids.get(id) || { value: "", checked: false, disabled: false, options: [] }; }
};
const ctx = vm.createContext({ document, URL, Blob, TextEncoder, setTimeout, clearTimeout, Uint8Array, Uint8ClampedArray, console });
vm.runInContext(fs.readFileSync(path.join(root, "vendor", "qrcode.min.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "vendor", "jsQR.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8") +
  "\nthis.api={normalizeUrl,readPayload,createQr,buildLayout,eachDecoration,eachModule,isProtectedModule,alignmentCenters,insideShape,createSVG,zipFiles,contrastRatio};", ctx);
const api = ctx.api;

test("URL normalization rejects invalid or unsafe protocols", () => {
  assert.equal(api.normalizeUrl("example.com"), "https://example.com/");
  assert.throws(() => api.normalizeUrl("javascript:alert(1)"));
  assert.throws(() => api.normalizeUrl(""));
});

test("plain text and Wi-Fi payloads escape delimiters", () => {
  ids.set("contentType", { value: "wifi" });
  ids.set("wifiSsid", { value: "Room;:1" });
  ids.set("wifiSecurity", { value: "WPA" });
  ids.set("wifiPassword", { value: "abc;:xyz" });
  ids.set("wifiHidden", { checked: true });
  assert.equal(api.readPayload().value, "WIFI:T:WPA;S:Room\\;\\:1;P:abc\\;\\:xyz;H:true;;");
  ids.set("contentType", { value: "text" });
  ids.set("textInput", { value: " 한국어 테스트 " });
  assert.equal(api.readPayload().value, "한국어 테스트");
});

test("all ornaments respect the four-module quiet zone", () => {
  const value = "https://example.com/path";
  const qr = api.createQr(value);
  for (const shape of ["heart", "star", "circle", "flower", "cloud", "bubble"]) {
    const layout = api.buildLayout(qr, shape);
    let squares = 0;
    api.eachDecoration(layout, { shape, seedOffset: 0 }, value, (x, y, s) => {
      squares++;
      const gap = layout.cellSize * 4;
      assert.ok(x + s <= layout.qrX - gap || x >= layout.qrX + layout.qrSize + gap ||
        y + s <= layout.qrY - gap || y >= layout.qrY + layout.qrSize + gap);
    });
    assert.ok(squares > 0);
  }
});

test("finder, timing, alignment patterns stay unchanged", () => {
  const pos = api.alignmentCenters(25);
  assert.equal(api.isProtectedModule(0, 0, 25, pos), true);
  assert.equal(api.isProtectedModule(6, 12, 25, pos), true);
  assert.equal(api.isProtectedModule(18, 18, 25, pos), true);
});

test("SVG retains vector dots with full-image gradient", () => {
  const qr = api.createQr("https://example.com");
  const layout = api.buildLayout(qr, "heart");
  const svg = api.createSVG({ qr, layout, value: "https://example.com", options: {
    shape: "heart", dotStyle: "circle", fg: "#111111", bg: "#ffffff",
    gradient: true, gradientColor: "#333333", logo: null, logoDataUrl: "", seedOffset: 0
  } });
  assert.match(svg, /<svg/);
  assert.match(svg, /<circle/);
  assert.match(svg, /gradientUnits="userSpaceOnUse"/);
  assert.doesNotMatch(svg, /<image/);
});

test("ZIP archive has valid local and directory headers", async () => {
  const blob = api.zipFiles([
    { name: "qr_001.png", bytes: new Uint8Array([1, 2, 3]) },
    { name: "result.txt", bytes: new TextEncoder().encode("완료") }
  ]);
  const buffer = await blob.arrayBuffer(), dv = new DataView(buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(buffer.byteLength - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(buffer.byteLength - 22 + 10, true), 2);
});

test("bundled scanner decodes all six decorated QR shapes", () => {
  const value = "https://example.com/test";
  const qr = api.createQr(value);
  for (const shape of ["square", "heart", "star", "circle", "flower", "cloud", "bubble"]) {
    const layout = api.buildLayout(qr, shape), size = layout.canvasSize;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }
    function draw(x, y, width) {
      for (let yy = y; yy < y + width; yy++) for (let xx = x; xx < x + width; xx++) {
        const i = (yy * size + xx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
    if (shape !== "square") api.eachDecoration(layout, { shape, seedOffset: 0 }, value, draw);
    api.eachModule(qr, layout, "square", (_shape, x, y, width) => draw(x, y, width));
    const decoded = ctx.jsQR(pixels, size, size, { inversionAttempts: "attemptBoth" });
    assert.equal(decoded && decoded.data, value, shape);
  }
});

test("URL/text/Wi-Fi can be encoded and decoded", () => {
  const values = ["https://example.com/test", "수학 자료실 QR", "WIFI:T:WPA;S:Test;P:secret;;"];
  for (const value of values) {
    const qr = api.createQr(value), count = qr.getModuleCount(), unit = 10, quiet = 4;
    const size = (count + quiet * 2) * unit, pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const row = Math.floor(y / unit) - quiet, col = Math.floor(x / unit) - quiet;
      const dark = row >= 0 && col >= 0 && row < count && col < count && qr.isDark(row, col);
      const grey = dark ? 0 : 255, i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = grey; pixels[i + 3] = 255;
    }
    const decoded = ctx.jsQR(pixels, size, size);
    assert.equal(decoded && decoded.data, value);
  }
});
