```javascript
// Mapillary360 crawler
// A böngészőből vezérelt quadtree crawler.
// A Worker /store végpontja egy bboxot feldolgoz, vagy jelzi,
// hogy azt négy részre kell bontani.
//
// Fontos:
// - nincs végtelen rekurzió;
// - MAX_DEPTH és MIN_SIZE védi a crawlert;
// - csak ténylegesen túlzsúfolt bboxot splitelünk;
// - a teljes világ is megadható kezdő bboxként;
// - a sok Worker-hívást a böngésző végzi egymás után.

const WORKER_URL = "https://mapillary360.grozsa11.workers.dev";

const MAX_DEPTH = 18;

// Ennél kisebb bboxot már nem darabolunk tovább.
// Budapest környékén ez nagyságrendileg néhány méter alatti
// méretet jelent a megfelelő irányokban.
const MIN_LON_SIZE = 0.000005;
const MIN_LAT_SIZE = 0.000005;

// Egyidejű fetch-ek száma.
// Nem használunk nagy párhuzamosságot, mert a Worker és a Mapillary
// oldalán is könnyebb így követni a terhelést.
const CONCURRENCY = 1;

let queue = [];
let visited = 0;
let stored = 0;
let splits = 0;
let errors = 0;
let stopped = false;
let running = false;

const stats = {
  ok: 0,
  split: 0,
  minSize: 0,
  errors: 0,
  images: 0,
  panos: 0,
  sequences: 0
};

function $(id) {
  return document.getElementById(id);
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  const line = `${time} ${message}`;

  const el = $("log");
  if (el) {
    el.textContent += line + "\n";
    el.scrollTop = el.scrollHeight;
  }

  console.log(line);
}

function updateStats() {
  if ($("queue")) $("queue").textContent = queue.length;
  if ($("visited")) $("visited").textContent = visited;
  if ($("stored")) $("stored").textContent = stored;
  if ($("splits")) $("splits").textContent = splits;
  if ($("errors")) $("errors").textContent = errors;

  if ($("statOk")) $("statOk").textContent = stats.ok;
  if ($("statSplit")) $("statSplit").textContent = stats.split;
  if ($("statMin")) $("statMin").textContent = stats.minSize;
  if ($("statImages")) $("statImages").textContent = stats.images;
  if ($("statPanos")) $("statPanos").textContent = stats.panos;
  if ($("statSequences")) $("statSequences").textContent = stats.sequences;
}

function normalizeWorkerUrl() {
  return WORKER_URL.replace(/\/+$/, "");
}

function bboxString(b) {
  return `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`;
}

function bboxSize(b) {
  return {
    lon: Math.abs(b.maxLon - b.minLon),
    lat: Math.abs(b.maxLat - b.minLat)
  };
}

function canSplit(node) {
  if (node.depth >= MAX_DEPTH) return false;

  const size = bboxSize(node.bbox);

  if (size.lon <= MIN_LON_SIZE) return false;
  if (size.lat <= MIN_LAT_SIZE) return false;

  return true;
}

function splitBBox(node) {
  const b = node.bbox;

  const midLon = (b.minLon + b.maxLon) / 2;
  const midLat = (b.minLat + b.maxLat) / 2;

  return [
    {
      id: node.id + "0",
      depth: node.depth + 1,
      bbox: {
        minLon: b.minLon,
        minLat: b.minLat,
        maxLon: midLon,
        maxLat: midLat
      }
    },
    {
      id: node.id + "1",
      depth: node.depth + 1,
      bbox: {
        minLon: midLon,
        minLat: b.minLat,
        maxLon: b.maxLon,
        maxLat: midLat
      }
    },
    {
      id: node.id + "2",
      depth: node.depth + 1,
      bbox: {
        minLon: b.minLon,
        minLat: midLat,
        maxLon: midLon,
        maxLat: b.maxLat
      }
    },
    {
      id: node.id + "3",
      depth: node.depth + 1,
      bbox: {
        minLon: midLon,
        minLat: midLat,
        maxLon: b.maxLon,
        maxLat: b.maxLat
      }
    }
  ];
}

async function callStore(node) {
  const url =
    normalizeWorkerUrl() +
    "/store?bbox=" +
    encodeURIComponent(bboxString(node.bbox)) +
    "&crawler=1&t=" +
    Date.now();

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store"
    });
  } catch (error) {
    throw new Error("Failed to fetch: " + error.message);
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  if (!response.ok) {
    const message =
      data && data.error
        ? data.error
        : `HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

function getImageCount(data) {
  if (data.stats && Number.isFinite(data.stats.totalImages)) {
    return data.stats.totalImages;
  }

  if (Number.isFinite(data.imagesReceived)) {
    return data.imagesReceived;
  }

  if (Number.isFinite(data.downloaded)) {
    return data.downloaded;
  }

  return null;
}

function getPanoCount(data) {
  if (data.stats && Number.isFinite(data.stats.panoImages)) {
    return data.stats.panoImages;
  }

  if (Number.isFinite(data.panoImages)) {
    return data.panoImages;
  }

  return 0;
}

function getSequenceCount(data) {
  if (data.stats && Number.isFinite(data.stats.sequencesFound)) {
    return data.stats.sequencesFound;
  }

  if (Number.isFinite(data.sequencesStored)) {
    return data.sequencesStored;
  }

  return 0;
}

function isSplitResponse(data) {
  return data &&
    data.needSplit === true &&
    Array.isArray(data.children);
}

async function processNode(node) {
  if (stopped) return;

  visited++;
  updateStats();

  const b = node.bbox;

  try {
    const data = await callStore(node);

    if (isSplitResponse(data)) {
      if (!canSplit(node)) {
        stats.minSize++;

        log(
          `${node.id} MIN-SIZE — ` +
          `depth=${node.depth} bbox=${bboxString(b)}`
        );

        updateStats();
        return;
      }

      const children = splitBBox(node);

      splits++;
      stats.split++;

      log(
        `${node.id} SPLIT → ` +
        `${children.map(x => x.id).join(", ")} ` +
        `depth=${node.depth}`
      );

      for (const child of children) {
        queue.push(child);
      }

      updateStats();
      return;
    }

    const images = getImageCount(data);
    const panos = getPanoCount(data);
    const sequences = getSequenceCount(data);

    stats.ok++;
    stats.images += images || 0;
    stats.panos += panos || 0;
    stats.sequences += sequences || 0;

    stored += sequences;

    log(
      `${node.id} OK — ` +
      `images=${images ?? "?"}, ` +
      `pano=${panos}, ` +
      `seq=${sequences}, ` +
      `depth=${node.depth}`
    );

    updateStats();

  } catch (error) {
    errors++;
    stats.errors++;

    log(
      `${node.id} ERROR — ${error.message}`
    );

    updateStats();
  }
}

async function workerLoop() {
  while (!stopped && queue.length > 0) {
    const batch = [];

    for (
      let i = 0;
      i < CONCURRENCY && queue.length > 0;
      i++
    ) {
      batch.push(queue.shift());
    }

    await Promise.all(
      batch.map(node => processNode(node))
    );

    updateStats();

    // A böngészőnek legyen lehetősége UI-t frissíteni.
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function parseNumber(id) {
  const value = Number($(id)?.value);

  if (!Number.isFinite(value)) {
    throw new Error(`Érvénytelen szám: ${id}`);
  }

  return value;
}

function getInitialBBox() {
  return {
    minLon: parseNumber("minLon"),
    minLat: parseNumber("minLat"),
    maxLon: parseNumber("maxLon"),
    maxLat: parseNumber("maxLat")
  };
}

function validateBBox(b) {
  if (b.minLon >= b.maxLon) {
    throw new Error("minLon >= maxLon");
  }

  if (b.minLat >= b.maxLat) {
    throw new Error("minLat >= maxLat");
  }

  if (b.minLon < -180 || b.maxLon > 180) {
    throw new Error("Longitude kívül esik a -180..180 tartományon");
  }

  if (b.minLat < -90 || b.maxLat > 90) {
    throw new Error("Latitude kívül esik a -90..90 tartományon");
  }
}

function resetCrawler() {
  queue = [];
  visited = 0;
  stored = 0;
  splits = 0;
  errors = 0;
  stopped = false;

  stats.ok = 0;
  stats.split = 0;
  stats.minSize = 0;
  stats.errors = 0;
  stats.images = 0;
  stats.panos = 0;
  stats.sequences = 0;

  updateStats();
}

async function startCrawler() {
  if (running) {
    log("A crawler már fut.");
    return;
  }

  try {
    const bbox = getInitialBBox();
    validateBBox(bbox);

    resetCrawler();

    const root = {
      id: "R",
      depth: 0,
      bbox
    };

    queue.push(root);
    running = true;

    log("Gyökér node: R");
    log(
      `Crawler elindult — bbox=${bboxString(bbox)}`
    );
    log(
      `MAX_DEPTH=${MAX_DEPTH}, ` +
      `MIN_LON_SIZE=${MIN_LON_SIZE}, ` +
      `MIN_LAT_SIZE=${MIN_LAT_SIZE}`
    );

    updateStats();

    await workerLoop();

    if (stopped) {
      log("Crawler leállítva.");
    } else {
      log(
        `Crawler befejezve — ` +
        `visited=${visited}, ` +
        `stored=${stored}, ` +
        `splits=${splits}, ` +
        `errors=${errors}`
      );
    }

  } catch (error) {
    log("INDÍTÁSI HIBA: " + error.message);
  } finally {
    running = false;
    updateStats();
  }
}

function stopCrawler() {
  stopped = true;
  log("Leállítás kérve...");
}

function clearLog() {
  const el = $("log");
  if (el) el.textContent = "";
}

window.startCrawler = startCrawler;
window.stopCrawler = stopCrawler;
window.clearLog = clearLog;

updateStats();
```
