// Render at the selected pixel size, then fit the scene and the Flash overlay together.
export function installDisplay(game, view) {
  const resolution = document.querySelector("#resolution");
  const rate = document.querySelector("#rate");
  const store = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  function restore(select, key) {
    try {
      const saved = localStorage.getItem(key);
      if ([...select.options].some((option) => option.value === saved)) select.value = saved;
    } catch {}
  }
  for (const [w, h] of [
    [640, 480],
    [1280, 960],
    [1280, 720],
    [1920, 1080],
  ]) {
    resolution.add(new Option(w + " × " + h, w + "x" + h));
  }
  for (const fps of [30, 60, 120, 144, 240, 256]) rate.add(new Option(String(fps), String(fps)));
  rate.add(new Option("Display refresh", "display"));
  restore(resolution, "re3-resolution");
  restore(rate, "re3-frame-rate");
  let width,
    height,
    displayRate = 60,
    sampleFrame = 0,
    nextSample = 0;

  function fit() {
    const scale = Math.min(view.clientWidth / width, view.clientHeight / height);
    view.style.setProperty("--game-scale", String(scale));
  }
  function apply() {
    game.re3Display?.(width, height, rate.value === "display" ? displayRate : Number(rate.value));
  }
  function size() {
    [width, height] = resolution.value.split("x").map(Number);
    const style = document.documentElement.style;
    style.setProperty("--render-width", width + "px");
    style.setProperty("--render-height", height + "px");
    style.setProperty("--game-aspect", String(width / height));
    fit();
    apply();
  }
  function measureRefresh() {
    cancelAnimationFrame(sampleFrame);
    clearTimeout(nextSample);
    if (rate.value !== "display" || document.hidden) return;
    const intervals = [];
    let previous;
    function sample(now) {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      if (intervals.length < 15) {
        sampleFrame = requestAnimationFrame(sample);
        return;
      }
      intervals.sort((a, b) => a - b);
      const hz = 1000 / intervals[7];
      const measured = Math.max(1, Math.min(1000, Math.round(hz)));
      if (Number.isFinite(hz) && measured !== displayRate) {
        displayRate = measured;
        apply();
      }
      // Recover from a busy loading screen or a move between monitors.
      nextSample = setTimeout(measureRefresh, 5000);
    }
    sampleFrame = requestAnimationFrame(sample);
  }
  window.re3DisplayReady = () => {
    queueMicrotask(apply);
  };
  resolution.addEventListener("change", () => {
    size();
    store("re3-resolution", resolution.value);
  });
  rate.addEventListener("change", () => {
    apply();
    measureRefresh();
    store("re3-frame-rate", rate.value);
  });
  document.addEventListener("visibilitychange", measureRefresh);
  window.addEventListener("resize", measureRefresh);
  new ResizeObserver(fit).observe(view);
  size();
  measureRefresh();
}
