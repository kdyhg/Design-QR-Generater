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
  "\nthis.api={normalizeUrl,readPayload,createQr,buildLayout,eachDecoration,eachModule,isProtectedModule,alignmentCenters,insideShape,pointInPolygon,SHARP_STAR_POINTS,decorationMatrix,createSVG,zipFiles,contrastRatio};", ctx);
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

test("decorations have no padded white frame and keep QR untouched", () => {
  const value = "https://example.com/path", qr = api.createQr(value);
  const basic = api.buildLayout(qr, "square");
  assert.equal(basic.qrX, 0);
  assert.equal(basic.qrY, 0);
  assert.equal(basic.canvasSize, basic.qrSize);
  for (const shape of ["heart", "star", "circle", "flower", "cloud", "bubble"]) {
    const layout = api.buildLayout(qr, shape), data = api.decorationMatrix(layout, {shape, seedOffset:0}, value);
    const unit = layout.cellSize;
    let pieces = 0, contact = 0;
    api.eachDecoration(layout, {shape, seedOffset:0}, value, (x,y,size) => {
      pieces++;
      assert.equal(size, unit);
      assert.ok(x + size <= layout.qrX || x >= layout.qrX + layout.qrSize ||
        y + size <= layout.qrY || y >= layout.qrY + layout.qrSize);
      if ((x + size === layout.qrX || x === layout.qrX + layout.qrSize ||
           y + size === layout.qrY || y === layout.qrY + layout.qrSize)) contact++;
    }, qr);
    assert.ok(pieces > 50, shape + " should be densely decorated");
    assert.ok(contact > 0, shape + " should touch QR directly");
    assert.equal(data.dark.length, data.cols * data.cols);
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

test("all shape silhouettes have consistently dense connected texture", () => {
  const qr = api.createQr("https://example.com/creative");
  for (const shape of ["heart","star","circle","flower","cloud","bubble"]) {
    const layout = api.buildLayout(qr,shape);
    const opts = {shape, seedOffset:0};
    const bitmap = api.decorationMatrix(layout,opts,"https://example.com/creative");
    const N=bitmap.cols, unit=layout.cellSize;
    let inside=0, colored=0;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){
      if(c*unit>=layout.qrX&&c*unit<layout.qrX+layout.qrSize &&
        r*unit>=layout.qrY&&r*unit<layout.qrY+layout.qrSize) continue;
      if(api.insideShape(shape,(c+0.5)*unit,(r+0.5)*unit,layout.canvasSize)){
        inside++;colored+=bitmap.dark[r*N+c];
      }
    }
    assert.ok(colored/inside > 0.62, shape + " should not be sparse");
    assert.ok(colored/inside < 0.94, shape + " should keep readable pixel pattern");
    assert.deepEqual(Array.from(api.decorationMatrix(layout,opts,"https://example.com/creative").dark),
      Array.from(bitmap.dark), "same inputs should render same pattern");
  }
});
test("five-point star has straight sharp tips, not rounded cosine lobes", () => {
  assert.equal(api.SHARP_STAR_POINTS.length,10);
  assert.ok(api.SHARP_STAR_POINTS.every((p)=>p.length===2));
  assert.equal(api.insideShape("star",50,2,100),true);
  assert.equal(api.insideShape("star",50,30,100),true);
  assert.equal(api.insideShape("star",99,1,100),false);
  // Halfway between an outer point and an inner notch is a straight edge.
  const A=api.SHARP_STAR_POINTS[0], B=api.SHARP_STAR_POINTS[1];
  assert.equal(api.pointInPolygon((A[0]+B[0])*0.49, (A[1]+B[1])*0.49,
    api.SHARP_STAR_POINTS),true);
});
test("QR matrix encodes URL, Korean text and Wi-Fi information", () => {
  for (const value of ["https://example.com/test","수학 자료실 QR","WIFI:T:WPA;S:Test;P:secret;;"]){
    const qr=api.createQr(value),count=qr.getModuleCount(), unit=10, size=count*unit;
    const pixels=new Uint8ClampedArray(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const dark=qr.isDark(Math.floor(y/unit),Math.floor(x/unit)),idx=(y*size+x)*4;
      pixels[idx]=pixels[idx+1]=pixels[idx+2]=dark?0:255;pixels[idx+3]=255;
    }
    const decoded=ctx.jsQR(pixels,size,size,{inversionAttempts:"attemptBoth"});
    assert.equal(decoded&&decoded.data,value);
  }
});
test("SVG uses same dense decorations as raster", () => {
  const value="https://example.com/svg", qr=api.createQr(value), layout=api.buildLayout(qr,"heart");
  const opts={shape:"heart",dotStyle:"square",fg:"#ac2748",bg:"#ffffff",gradient:false,
    gradientColor:"#d9365e",logo:null,logoDataUrl:"",seedOffset:0};
  const svg=api.createSVG({qr,layout,value,options:opts});
  let count=0; api.eachDecoration(layout,opts,value,()=>count++,qr);
  assert.ok(count>100);
  assert.ok((svg.match(/<rect /g)||[]).length >= count);
});
