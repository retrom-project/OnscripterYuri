import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

// All environment inputs are explicit. No checkout, session, or browser path
// outside this repository is inferred. Output contains only authored test data.
const [assets, font, playwrightModule, browserExecutable, output] = process.argv.slice(2);
assert.equal(process.argv.length, 7, "usage: node checkpoint-browser.mjs <assets> <font.ttf> <playwright-module> <browser> <empty-output>");
assert([assets, font, playwrightModule, browserExecutable, output].every(path.isAbsolute), "absolute paths required");
await fs.mkdir(output);
const {chromium} = await import(pathToFileURL(playwrightModule).href);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const customTextWait = process.env.ONS_TEXTGOSUB === "1";
const firstText = customTextWait ? "é" : "FIRST";
const thirdText = customTextWait ? "é".repeat(6) : "FIRSTSECONDTHIRD";
const fourthText = customTextWait ? "é".repeat(10) : "FIRSTSECONDTHIRDFOURTH";
const transitionText = customTextWait ? "é".repeat(40) : "TYPEWRITER TRANSITION WITH MANY CHARACTERS";
const fixture = await fs.readFile(fileURLToPath(new URL(customTextWait ? "fixtures/checkpoint-textgosub/0.txt" : "fixtures/checkpoint-waits/0.txt", import.meta.url)));
const background = Buffer.alloc(54 + 640 * 480 * 3);
background.write("BM"); background.writeUInt32LE(background.length, 2); background.writeUInt32LE(54, 10);
background.writeUInt32LE(40, 14); background.writeInt32LE(640, 18); background.writeInt32LE(480, 22);
background.writeUInt16LE(1, 26); background.writeUInt16LE(24, 28);
for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
  const i = 54 + (y * 640 + x) * 3;
  background[i] = x < 320 ? 180 : 20;
  background[i + 1] = x < 320 ? 30 : 160;
  background[i + 2] = 30;
}
const sourceFiles = new Map([["0.txt", fixture], ["background.bmp", background], ["default.ttf", await fs.readFile(font)]]);
const coreFiles = new Map(await Promise.all(["onsyuri.js", "onsyuri.wasm"].map(async name => [name, await fs.readFile(path.join(assets, name))])));
const report = {inputs: {core: [...coreFiles].map(([name, bytes]) => ({name, sha256: sha(bytes), sizeBytes: bytes.length})), fixture: [...sourceFiles].map(([name, bytes]) => ({name, sha256: sha(bytes), sizeBytes: bytes.length}))}, observations: [], errors: [], console: []};
let restore = null;
let retainLargeReadBuffer = false;
const html = `<!doctype html><body style="margin:0"><canvas id="canvas" tabindex="0" oncontextmenu="event.preventDefault()"></canvas><script src="/onsyuri.js"></script><script>
window.flush_save=()=>{};window.fetch_file=()=>{};window.scale_full=()=>{};window.playVideo=()=>{};window.g_onsyuri_filemap={};window.g_onsyuri_index={gamedir:'/game',savedir:'/save'};
(async()=>{const canvas=document.getElementById('canvas');const orig=canvas.getContext.bind(canvas);canvas.getContext=(type,options)=>orig(type,/webgl/i.test(type)?{...options,preserveDrawingBuffer:true}:options);
const data=await Promise.all(['0.txt','background.bmp','default.ttf'].map(async name=>[name,new Uint8Array(await(await fetch('/'+name)).arrayBuffer())]));
const state=await fetch('/restore');const restored=state.status===200?new Uint8Array(await state.arrayBuffer()):null;const large=await(await fetch('/large-read')).json();
const m=await onsyuri({canvas,locateFile:name=>'/'+name,printErr:text=>console.debug(text)});window.native=m;window.g_onsyuri_module=m;
m.FS.mkdirTree('/game');m.FS.mkdirTree('/save');for(const [name,bytes]of data)m.FS.writeFile('/game/'+name,bytes);if(restored)m.FS.writeFile('/save/save999.dat',restored);if(large)m.FS.writeFile('/game/envdata',new Uint8Array(65536));
window.beforeStartup={ready:m._onsyuri_host_checkpoint_ready(),save:m._onsyuri_host_save(998)};
m._onsyuri_host_set_restore_slot(restored?999:-1);m.callMain(['--root','/game','--font','/game/default.ttf','--save-dir','/save','${customTextWait ? "--enc:utf8" : "--enc:gbk"}']);canvas.focus();
})().catch(error=>{window.failure=String(error);console.error(error)});</script>`;
const server = http.createServer((request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  const name = request.url.slice(1);
  if (name === "favicon.ico") {response.statusCode = 204; response.end(); return;}
  if (name === "large-read") {response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(retainLargeReadBuffer)); return;}
  let bytes = name === "" ? Buffer.from(html) : sourceFiles.get(name) ?? coreFiles.get(name);
  if (name === "restore") bytes = restore;
  if (!bytes) {response.statusCode = name === "restore" ? 204 : 404; response.end(); return;}
  response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "text/javascript" : name === "" ? "text/html" : "application/octet-stream");
  response.end(bytes);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({executablePath: browserExecutable, headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"]});
const pages = [];
const open = async (payload, largeRead = false, expectRestoreFailure = false) => {
  restore = payload;
  retainLargeReadBuffer = largeRead;
  const page = await browser.newPage({viewport: {width: 640, height: 480}}); pages.push(page);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("console", message => {if (report.console.length < 1000) report.console.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.failure || window.native?._onsyuri_host_checkpoint_ready() === 1 || window.native?._onsyuri_host_did_restore_fail() === 1, undefined, {timeout: 30000});
  assert.equal(await page.evaluate(() => window.failure ?? null), null);
  assert.equal(await page.evaluate(() => window.native._onsyuri_host_did_restore_fail()), expectRestoreFailure ? 1 : 0);
  assert.deepEqual(await page.evaluate(() => window.beforeStartup), {ready: 0, save: -1});
  return page;
};
const capture = async page => Buffer.from(await page.evaluate(() => {
  const m = window.native; m._onsyuri_host_set_paused(1);
  try {if (m._onsyuri_host_save(999) !== 0) throw Error("host capture failed"); return Array.from(m.FS.readFile("/save/save999.dat"));}
  finally {m._onsyuri_host_set_paused(0);}
}));
const tail = bytes => {
  const start = bytes.lastIndexOf(Buffer.from("WTXT")); assert(start > 0, "host text continuation absent");
  const nests = bytes.readInt32LE(start + 44);
  const countOffset = start + 48 + nests * 4;
  const count = bytes.readInt32LE(countOffset);
  return {kind: bytes.readInt32LE(start + 4), offset: bytes.readInt32LE(start + 8), click: bytes.readInt32LE(start + 12), x: bytes.readInt32LE(start + 16), y: bytes.readInt32LE(start + 20), nests: [...Array(nests)].map((_, i) => bytes.readInt32LE(start + 48 + i * 4)), text: bytes.subarray(countOffset + 4, countOffset + 4 + count).toString(customTextWait ? "utf8" : "ascii")};
};
const input = async page => {
  await page.bringToFront();
  await page.locator("canvas").evaluate(canvas => canvas.focus());
  if (customTextWait) await page.locator("canvas").click({position: {x: 600, y: 400}, delay: 180});
  else await page.keyboard.press("Enter", {delay: 100});
  await page.waitForFunction(() => window.native._onsyuri_host_checkpoint_ready() === 1);
  await page.waitForTimeout(100);
};
const screenshot = async (page, label) => {
  await page.locator("canvas").screenshot({path: path.join(output, label + ".png")});
  const pixels = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 480;
    const ctx = c.getContext("2d"); ctx.drawImage(window.native.canvas, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 640, 300).data);
  });
  return sha(Buffer.from(pixels));
};
const fullCanvasPixels = async page => Buffer.from(await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  const ctx = c.getContext("2d"); ctx.drawImage(window.native.canvas, 0, 0);
  return Array.from(ctx.getImageData(0, 0, 640, 480).data);
}));
try {
  const original = await open(null);
  const first = await capture(original); assert.equal(tail(first).text, firstText);
  await input(original); await input(original);
  const third = await capture(original); assert.equal(tail(third).text, thirdText);
  await fs.writeFile(path.join(output, "third.dat"), third);
  const thirdBackground = await screenshot(original, "third-wait");
  const restored = await open(third);
  const restoredThird = await capture(restored); assert.deepEqual(tail(restoredThird), tail(third));
  assert.equal(await screenshot(restored, "restored-third-wait"), thirdBackground, "actual background differs");
  await restored.waitForTimeout(7000); assert.deepEqual(tail(await capture(restored)), tail(third), "restored wait advanced without input");
  await input(restored); const fourth = await capture(restored);
  assert.equal(tail(fourth).text, fourthText);
  await screenshot(restored, "continued-fourth-wait");
  let fourthCanvasComparison;
  if (customTextWait) {
    // Compare the restored continuation with the original engine's real next
    // input. Serialized page text alone cannot prove the rendered text layer.
    const restoredFourthCanvas = await fullCanvasPixels(restored);
    await input(original);
    assert.equal(tail(await capture(original)).text, fourthText);
    await screenshot(original, "original-continued-fourth-wait");
    const originalFourthCanvas = await fullCanvasPixels(original);
    let differentPixels = 0, maxChannelDelta = 0;
    for (let i = 0; i < originalFourthCanvas.length; i += 4) {
      let different = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(originalFourthCanvas[i + channel] - restoredFourthCanvas[i + channel]);
        different ||= delta !== 0; maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (different) differentPixels++;
    }
    // drawGlyph's direct surface blend and refreshSurface's cached text blend
    // round integer alpha at different stages. The original six glyphs differ
    // by at most two color levels after reconstruction; missing or misplaced
    // glyphs exceed that bound. Keep both hashes and the exact error measure.
    fourthCanvasComparison = {originalSha256: sha(originalFourthCanvas), restoredSha256: sha(restoredFourthCanvas), differentPixels, maxChannelDelta};
    assert(maxChannelDelta <= 2, "restored textgosub continuation differs from normal native rendering beyond integer text alpha rounding");
  }
  report.observations.push({case: "different-instance-current-wait", third: tail(third), restoredThird: tail(restoredThird), fourth: tail(fourth), backgroundSha256: thirdBackground, fourthCanvasComparison});
  // loadEnvData and loadSaveFile share the same native parser buffer. A valid
  // zero-valued envdata with padding retains a larger allocation before the
  // much shorter checkpoint is read. Restore follows the real startup path;
  // it does not replace script state from an active Asyncify text stack.
  const shortAfterLargeRead = await open(first, true);
  assert.deepEqual(tail(await capture(shortAfterLargeRead)), tail(first));
  const truncated = await open(first.subarray(0, -1), true, true);
  assert.equal(await truncated.evaluate(() => native._onsyuri_host_checkpoint_ready()), 0);
  report.observations.push({case: "native-retained-64KiB-read-buffer-then-short-checkpoint", shortRestored: tail(first), truncatedRestoreFailed: true});
  if (!customTextWait) {
  // A native menu is not a stable dialogue wait. Failed save must leave the
  // previously captured checkpoint intact.
  await original.locator("canvas").click({button: "right", position: {x: 600, y: 400}});
  await original.waitForFunction(() => window.native._onsyuri_host_checkpoint_ready() === 0);
  const rejected = await original.evaluate(() => ({ready: native._onsyuri_host_checkpoint_ready(), save: native._onsyuri_host_save(999), bytes: [...native.FS.readFile("/save/save999.dat")]}));
  assert.equal(rejected.ready, 0); assert.equal(rejected.save, -1); assert.equal(sha(Buffer.from(rejected.bytes)), sha(third));
  await screenshot(original, "menu-rejects-checkpoint"); report.observations.push({case: "native-menu-rejected-without-overwrite", ready: rejected.ready, save: rejected.save});
  // Save through the original user menu, not a host/test-only setter. Its
  // retained native savepoint must remain the beginning of the text line.
  const click = async (page, x, y) => {await page.locator("canvas").click({position: {x, y}}); await page.waitForTimeout(100);};
  await click(original, 300, 225); await screenshot(original, "native-slot-menu");
  await click(original, 310, 249); await screenshot(original, "native-slot-confirm");
  await click(original, 237, 269);
  await original.waitForFunction(() => native.FS.analyzePath("/save/save1.dat").exists);
  await screenshot(original, "native-slot-after-confirm");
  const nativeSlot = Buffer.from(await original.evaluate(() => [...native.FS.readFile("/save/save1.dat")]));
  assert.equal(nativeSlot.includes(Buffer.from("WTXT")), false, "host tail leaked into ordinary native slot");
  await original.waitForFunction(() => native._onsyuri_host_checkpoint_ready() === 1);
  await original.locator("canvas").click({button: "right", position: {x: 600, y: 400}});
  await click(original, 300, 252); await screenshot(original, "native-load-menu");
  await click(original, 310, 249); await click(original, 249, 269);
  await original.waitForFunction(() => native._onsyuri_host_checkpoint_ready() === 1);
  assert.equal(tail(await capture(original)).text, "FIRST", "ordinary native slot was replaced by host THIRD savepoint");
  await input(original); assert.equal(tail(await capture(original)).text, "FIRSTSECOND");
  report.observations.push({case: "ordinary-native-menu-slot-retains-savepoint", slotSha256: sha(nativeSlot), nativeSlotBytes: nativeSlot.length, restoredFirst: true, continuedSecond: true});
  }
  await restored.bringToFront();
  await restored.locator("canvas").evaluate(canvas => canvas.focus());
  // Arm the observation before the real user event. Waiting for the click
  // helper to return can miss a busy interval while other browser instances
  // run. Probe the actual native boundary at its first busy observation.
  await restored.evaluate(() => {
    window.transitionProbe = null;
    const timer = setInterval(() => {
      if (native._onsyuri_host_checkpoint_ready() !== 0) return;
      clearInterval(timer);
      window.transitionProbe = {ready: native._onsyuri_host_checkpoint_ready(), save: native._onsyuri_host_save(999), bytes: [...native.FS.readFile("/save/save999.dat")]};
    }, 10);
  });
  if (customTextWait) await restored.locator("canvas").click({position: {x: 600, y: 400}, delay: 180});
  else await restored.keyboard.press("Enter", {delay: 100});
  await restored.waitForFunction(() => window.transitionProbe !== null, undefined, {timeout: 5000});
  const transition = await restored.evaluate(() => window.transitionProbe);
  assert.equal(transition.ready, 0); assert.equal(transition.save, -1); assert.equal(sha(Buffer.from(transition.bytes)), sha(fourth));
  await restored.waitForFunction(() => native._onsyuri_host_checkpoint_ready() === 1);
  assert.equal(tail(await capture(restored)).text, transitionText);
  report.observations.push({case: "typewriter-transition-rejected-without-overwrite", ready: transition.ready, save: transition.save});
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
} catch (error) {report.status = "FAIL"; report.failure = String(error); for (const [i, page] of pages.entries()) await screenshot(page, "failure-page-" + i).catch(() => {}); throw error;}
finally {await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); await browser.close(); await new Promise(resolve => server.close(resolve));}
