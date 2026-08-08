const WORKER_URL = "https://mapillary360.grozsa11.workers.dev";

let queue = [];
let visited = new Set();
let stored = 0;
let splits = 0;
let errors = 0;
let running = false;

const MAX_DEPTH = 20;
const MAX_ACTIVE = 2;

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function log(text, type = "") {
  const el = $("log");

  if (!el) {
    console.log(text);
    return;
  }

  const row = document.createElement("div");

  if (type) {
    row.className = type;
  }

  row.textContent =
    new Date().toLocaleTimeString() + " " + text;

  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function updateStats() {
  setText("queue", queue.length);
  setText("visited", visited.size);
  setText("stored", stored);
  setText("splits", splits);
  setText("errors", errors);
}

function bboxKey(b) {
  return [
    b.minLon,
    b.minLat,
    b.maxLon,
    b.maxLat
  ].join(",");
}

function splitBBox(b) {
  const midLon = (b.minLon + b.maxLon) / 2;
  const midLat = (b.minLat + b.maxLat) / 2;

  return [
    {
      minLon: b.minLon,
      minLat: b.minLat,
      maxLon: midLon,
      maxLat: midLat
    },
    {
      minLon: midLon,
      minLat: b.minLat,
      maxLon: b.maxLon,
      maxLat: midLat
    },
    {
      minLon: b.minLon,
      minLat: midLat,
      maxLon: midLon,
      maxLat: b.maxLat
    },
    {
      minLon: midLon,
      minLat: midLat,
      maxLon: b.maxLon,
      maxLat: b.maxLat
    }
  ];
}

async function callStore(node) {
  const bbox = bboxKey(node.bbox);

  const url =
    WORKER_URL +
    "/store?bbox=" +
    encodeURIComponent(bbox) +
    "&crawler=1";

  const response = await fetch(url, {
    cache: "no-store"
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(
      "HTTP " +
      response.status +
      ": invalid JSON: " +
      text.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      ": " +
      text.slice(0, 300)
    );
  }

  return data;
}

async function processNode(node) {
  const key = bboxKey(node.bbox);

  if (visited.has(key)) {
    return;
  }

  visited.add(key);
  updateStats();

  try {
    const result = await callStore(node);

    if (result.needSplit === true) {
      const depth = node.depth || 0;

      if (depth >= MAX_DEPTH) {
        errors++;

        log(
          key +
          " MAX DEPTH — nem spliteljük tovább",
          "error"
        );

        updateStats();
        return;
      }

      const children =
        Array.isArray(result.children) &&
        result.children.length === 4
          ? result.children
          : splitBBox(node.bbox);

      splits++;

      log(
        key +
        " SPLIT → " +
        children.length +
        " gyermek"
      );

      for (const child of children) {
        queue.push({
          bbox: child,
          depth: depth + 1
        });
      }

      updateStats();
      return;
    }

    if (result.processed === true) {
      stored++;

      const s = result.stats || {};

      const images =
        s.totalImages ??
        s.imagesReceived ??
        0;

      const pano =
        s.panoImages ??
        0;

      const seq =
        s.sequencesFound ??
        0;

      log(
        key +
        " OK — images=" +
        images +
        ", pano=" +
        pano +
        ", seq=" +
        seq
      );

      updateStats();
      return;
    }

    errors++;

    log(
      key +
      " ISMERETLEN VÁLASZ: " +
      JSON.stringify(result).slice(0, 500),
      "error"
    );

    updateStats();

  } catch (err) {
    errors++;

    log(
      "ERROR " +
      key +
      " : " +
      err.message,
      "error"
    );

    updateStats();
  }
}

async function workerLoop() {
  while (running) {
    if (queue.length === 0) {
      running = false;

      log("Crawler befejeződött.");

      return;
    }

    const batch = [];

    while (
      batch.length < MAX_ACTIVE &&
      queue.length > 0
    ) {
      batch.push(queue.shift());
    }

    await Promise.all(
      batch.map(processNode)
    );

    updateStats();

    await new Promise(resolve =>
      setTimeout(resolve, 100)
    );
  }
}

function readValue(id) {
  const el = $(id);

  if (!el) {
    throw new Error(
      "A HTML-ben nincs ilyen elem: #" + id
    );
  }

  const value = parseFloat(el.value);

  if (!Number.isFinite(value)) {
    throw new Error(
      "Érvénytelen érték: #" + id
    );
  }

  return value;
}

function readInitialBBox() {
  const minLon = readValue("minLon");
  const minLat = readValue("minLat");
  const maxLon = readValue("maxLon");
  const maxLat = readValue("maxLat");

  if (
    minLon >= maxLon ||
    minLat >= maxLat
  ) {
    throw new Error(
      "Hibás bbox: min érték nagyobb vagy egyenlő a max értéknél."
    );
  }

  return {
    minLon,
    minLat,
    maxLon,
    maxLat
  };
}

function resetState() {
  queue = [];
  visited = new Set();
  stored = 0;
  splits = 0;
  errors = 0;
}

function startCrawler() {
  if (running) {
    return;
  }

  try {
    const bbox = readInitialBBox();

    resetState();

    queue.push({
      bbox,
      depth: 0
    });

    log("Gyökér node: R");
    log("Crawler elindult");

    updateStats();

    running = true;

    workerLoop();

  } catch (err) {
    log(
      "INDÍTÁSI HIBA: " +
      err.message,
      "error"
    );
  }
}

function stopCrawler() {
  running = false;
  log("Crawler leállítva.");
}

function clearLog() {
  const el = $("log");

  if (el) {
    el.innerHTML = "";
  }
}

function bindClick(id, handler) {
  const el = $(id);

  if (!el) {
    console.warn(
      "Hiányzó HTML elem: #" + id
    );
    return;
  }

  el.addEventListener(
    "click",
    handler
  );
}

window.addEventListener(
  "DOMContentLoaded",
  () => {
    bindClick(
      "start",
      startCrawler
    );

    bindClick(
      "stop",
      stopCrawler
    );

    bindClick(
      "clear",
      clearLog
    );

    updateStats();

    log("Crawler betöltve.");
  }
);
