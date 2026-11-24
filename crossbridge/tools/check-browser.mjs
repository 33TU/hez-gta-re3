// Play the Vice City intro, enter the car outside Ken's office, and drive it using the browser controls.
import { chromium } from "playwright-core";

const [url = "http://127.0.0.1:8000/", screenshot] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: process.env.CHROME ? undefined : "chrome",
  executablePath: process.env.CHROME,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const modules = new Set();
  const streams = new Set();
  let state, error, origin, bank, missions;
  page.on("response", (response) => {
    if (!response.ok()) return;
    const path = new URL(response.url()).pathname;
    if (path.includes("/compiled/")) modules.add(path.split("/").pop());
    const chunk = /\/audio\/([^/]+)\/\d+\.bin$/.exec(path);
    if (chunk) streams.add(chunk[1]);
  });
  page.on("pageerror", (problem) => {
    error = problem;
  });
  page.on("crash", () => {
    error = Error("The browser tab crashed");
  });
  page.on("console", (msg) => {
    const line = msg.text().trim();
    if (/Game error|exited with code|Game audio unavailable|Game audio audio\//.test(line))
      error = Error(line);
    if (line.includes("Flash audio:") || line.includes("Retail script ready")) console.log(line);
    if (/Flash audio: \d+ effects/.test(line)) bank = true;
    if (/Retail script ready: \d+ mission scripts/.test(line)) missions = true;
    const match =
      /Game frame (\d+) time \d+ cutscene (\d+) player ([\d.-]+) ([\d.-]+) [\d.-]+ vehicle (-?\d+) controls (\d+)/.exec(
        line,
      );
    if (match) {
      const [frame, cutscene, x, y, car, controls] = match.slice(1).map(Number);
      state = { frame, cutscene, x, y, car, controls, intro: line.includes("mission intro") };
    }
  });
  await page.addInitScript(() => {
    window.audibleBlocks = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (
        this.context.state === "running" &&
        this.buffer?.length === 4096 &&
        this.buffer.getChannelData(0).some((v) => Math.abs(v) > 0.001)
      )
        window.audibleBlocks++;
      return start.apply(this, args);
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 240000;
  let focused = false,
    sawIntro = false,
    attemptedEntry = 0;
  while (Date.now() < deadline) {
    if (error) throw error;
    if (!state) {
      await page.waitForTimeout(150);
      continue;
    }
    if (!focused) {
      await page.locator("#view").click();
      await page.waitForFunction(() => document.pointerLockElement?.id === "view");
      await page.keyboard.press("Tab");
      if (!(await page.evaluate(() => document.activeElement?.id === "game")))
        throw Error("Tab moved focus out of the captured game");
      focused = true;
    }
    if (state.intro) sawIntro = true;
    if (state.cutscene) {
      await page.keyboard.down("Space");
      await page.waitForTimeout(150);
      await page.keyboard.up("Space");
    } else if (sawIntro && !state.intro && state.controls) {
      if (state.car < 0 && Date.now() > attemptedEntry + 3000) {
        await page.keyboard.down("f");
        await page.waitForTimeout(150);
        await page.keyboard.up("f");
        attemptedEntry = Date.now();
      }
      if (state.car >= 0 && !origin) {
        origin = state;
        console.log("Entered vehicle", state.car, "at", state.x, state.y);
        await page.keyboard.down("ArrowUp");
      }
      if (
        origin &&
        origin.car === state.car &&
        Math.hypot(state.x - origin.x, state.y - origin.y) > 8
      ) {
        await page.keyboard.up("ArrowUp");
        console.log("Drove to", state.x, state.y);
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  if (
    !origin ||
    state.car !== origin.car ||
    Math.hypot(state.x - origin.x, state.y - origin.y) <= 8
  )
    throw Error("Timed out driving the car after the opening cinematic: " + JSON.stringify(state));
  if (!bank || !missions || !streams.size || !(await page.evaluate(() => window.audibleBlocks > 0)))
    throw Error("Game data, streamed audio or audible sample buffers were missing");
  if (!new URL(url).pathname.endsWith("/jit.html")) {
    const response = await page.request.get(new URL("./compiled/manifest.json", url).href);
    const manifest = await response.json();
    for (const entry of [...manifest.abcs, ...manifest.libraries])
      if (!modules.has(entry.module.split("/").pop()))
        throw Error("Missing AOT module " + entry.module);
  } else if (modules.size) throw Error("JIT loaded an AOT module");
  if (screenshot) await page.screenshot({ path: screenshot });
  console.log("Verified retail gameplay and audio", [...streams].join(", "));
} finally {
  await browser.close();
}
