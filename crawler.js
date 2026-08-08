/*
Mapillary 360 Crawler

Quadtree-alapú feldolgozás.

R  = gyökér
R0 = bal-alsó
R1 = jobb-alsó
R2 = bal-felső
R3 = jobb-felső

A Worker /store végpontja dönti el, hogy egy bbox
feldolgozható-e vagy négy részre kell bontani.

Biztonsági korlátok:

* maximális quadtree mélység
* hibák újrapróbálása
* a tényleges bbox méretének kijelzése
  */

const MAX_DEPTH = 20;
const MAX_RETRIES = 3;

const state = {
queue: [],
visited: new Set(),
completed: new Set(),
stored: 0,
splits: 0,
errors: 0,
running: false,
paused: false,
stopped: false,
root: null
};

const $ = id => document.getElementById(id);

//--------------------------------------------------
// UI
//--------------------------------------------------

function updateStats() {
$("queueCount").textContent = state.queue.length;
$("visitedCount").textContent = state.visited.size;
$("storedCount").textContent = state.stored;
$("splitCount").textContent = state.splits;
$("errorCount").textContent = state.errors;
}

function log(message, type = "") {
const line = document.createElement("div");

if (type) line.className = "log-" + type;

line.textContent =
new Date().toLocaleTimeString() + "  " + message;

$("log").appendChild(line);
$("log").scrollTop = $("log").scrollHeight;
}

function showCurrent(node) {
if (!node) {
$("current").textContent = "-";
return;
}

const b = node.bbox;

$("current").textContent =
`Node: ${node.id}\n` +
`Depth: ${node.depth}\n` +
`minLon: ${b.minLon}\n` +
`minLat: ${b.minLat}\n` +
`maxLon: ${b.maxLon}\n` +
`maxLat: ${b.maxLat}`;
}

//--------------------------------------------------
// Földrajzi méret
//--------------------------------------------------

function areaInfo(b) {
const lat = (b.minLat + b.maxLat) / 2;

const latKm =
(b.maxLat - b.minLat) * 111.32;

const lonKm =
(b.maxLon - b.minLon) *
111.32 *
Math.cos(lat * Math.PI / 180);

const area =
latKm * lonKm;

return {
lonKm,
latKm,
area
};
}

function updateAreaInfo() {
const b = {
minLon: Number($("minLon").value),
minLat: Number($("minLat").value),
maxLon: Number($("maxLon").value),
maxLat: Number($("maxLat").value)
};

if (
!Number.isFinite(b.minLon) ||
!Number.isFinite(b.minLat) ||
!Number.isFinite(b.maxLon) ||
!Number.isFinite(b.maxLat) ||
b.minLon >= b.maxLon ||
b.minLat >= b.maxLat
) {
$("areaInfo").textContent = "Érvénytelen bbox";
return;
}

const a = areaInfo(b);

$("areaInfo").textContent =
`Méret: ${a.lonKm.toFixed(3)} × ${a.latKm.toFixed(3)} km` +
`  |  terület: ${a.area.toFixed(4)} km²`;
}

//--------------------------------------------------
// Quadtree
//--------------------------------------------------

function childNodes(node) {
const b = node.bbox;

const midLon =
(b.minLon + b.maxLon) / 2;

const midLat =
(b.minLat + b.maxLat) / 2;

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

//--------------------------------------------------
// Worker
//--------------------------------------------------

function workerUrl() {
return $("workerUrl")
.value
.trim()
.replace(//+$/, "")
}

function bboxString(b) {
return [
b.minLon,
b.minLat,
b.maxLon,
b.maxLat
].join(",");
}

//--------------------------------------------------
// Worker kérés
//--------------------------------------------------

async function requestStore(node) {
const url =
workerUrl() +
"/store?bbox=" +
encodeURIComponent(bboxString(node.bbox)) +
"&t=" +
Date.now();

let lastError;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
try {
const response = await fetch(url);

```
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  }
  catch {
    throw new Error(
      `HTTP ${response.status}: ${text.slice(0,300)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}
catch (error) {
  lastError = error;

  if (attempt < MAX_RETRIES) {
    log(
      `${node.id}: hiba, újrapróbálás ${attempt}/${MAX_RETRIES}`,
      "warning"
    );

    await sleep(1500 * attempt);
  }
}
```

}

throw lastError;
}

//--------------------------------------------------
// Node feldolgozása
//--------------------------------------------------

async function processNode(node) {
showCurrent(node);

log(
`${node.id} feldolgozás — depth=${node.depth}`
);

const result =
await requestStore(node);

//------------------------------------------------
// SPLIT
//------------------------------------------------

if (result.needSplit === true) {

```
if (node.depth >= MAX_DEPTH) {

  log(
    `${node.id} ELÉRTE A MAX_DEPTH=${MAX_DEPTH} ` +
    `értéket, további split letiltva`,
    "warning"
  );

  return {
    stoppedByDepth: true
  };
}

const children =
  childNodes(node);

for (const child of children) {
  if (
    !state.visited.has(child.id) &&
    !state.completed.has(child.id)
  ) {
    state.queue.push(child);
  }
}

state.splits++;

log(
  `${node.id} SPLIT → ` +
  children.map(x => x.id).join(", "),
  "split"
);

return {
  split: true
};
```

}

//------------------------------------------------
// SIKERES FELDOLGOZÁS
//------------------------------------------------

state.stored++;

const stats =
result.stats || {};

log(
`${node.id} OK — ` +
`images=${stats.totalImages ?? result.imagesReceived ?? "?"}, ` +
`pano=${stats.panoImages ?? "?"}, ` +
`seq=${stats.sequencesFound ?? "?"}`,
"ok"
);

return {
stored: true
};
}

//--------------------------------------------------
// Crawler
//--------------------------------------------------

async function runCrawler() {
if (state.running) return;

state.running = true;
state.paused = false;
state.stopped = false;

log("Crawler elindult", "ok");

while (
state.queue.length &&
!state.stopped
) {

```
if (state.paused) {
  await sleep(500);
  continue;
}

const node =
  state.queue.shift();

if (
  state.completed.has(node.id)
) {
  updateStats();
  continue;
}

state.visited.add(node.id);
updateStats();

try {

  const result =
    await processNode(node);

  /*
    A node akkor kerül completed állapotba,
    ha sikeresen feldolgoztuk.
    Split esetén is késznek tekintjük a szülőt,
    mert a négy gyermek folytatja a feldolgozást.
  */

  state.completed.add(node.id);

}
catch (error) {

  state.errors++;

  log(
    `${node.id} ERROR: ${error.message}`,
    "error"
  );

  /*
    Hibánál visszatesszük a queue végére.
    Így egy átmeneti hálózati/Cloudflare hiba
    nem veszíti el automatikusan a node-ot.
  */

  state.queue.push(node);

  /*
    Ne pörögjön végtelen sebességgel hibánál.
  */

  await sleep(3000);
}

updateStats();

await sleep(150);
```

}

state.running = false;

if (state.stopped) {
log("Crawler leállítva", "warning");
}
else if (state.paused) {
log("Crawler szüneteltetve", "warning");
}
else if (!state.queue.length) {
log("Crawler kész", "ok");
}

updateStats();
}

//--------------------------------------------------
// START
//--------------------------------------------------

function startCrawler() {

if (state.running) return;

//------------------------------------------------
// Ha nincs queue, új gyökér
//------------------------------------------------

if (!state.queue.length) {

```
const root = {
  id: "R",
  depth: 0,
  bbox: {
    minLon: Number($("minLon").value),
    minLat: Number($("minLat").value),
    maxLon: Number($("maxLon").value),
    maxLat: Number($("maxLat").value)
  }
};

const b = root.bbox;

if (
  !Number.isFinite(b.minLon) ||
  !Number.isFinite(b.minLat) ||
  !Number.isFinite(b.maxLon) ||
  !Number.isFinite(b.maxLat)
) {
  alert("Érvénytelen bbox");
  return;
}

if (
  b.minLon >= b.maxLon ||
  b.minLat >= b.maxLat
) {
  alert("A bbox koordinátái hibásak");
  return;
}

//------------------------------------------------
// Figyelmeztetés nagy területre
//------------------------------------------------

const size =
  areaInfo(b);

if (size.area > 1) {

  const answer =
    confirm(
      `A megadott terület kb. ` +
      `${size.area.toFixed(2)} km².\n\n` +
      `Ez nem kis tesztterület.\n` +
      `Biztosan el akarod indítani?`
    );

  if (!answer) {
    log(
      "Indítás megszakítva: túl nagy tesztterület.",
      "warning"
    );
    return;
  }
}

//------------------------------------------------
// Állapot inicializálása
//------------------------------------------------

state.root = root;
state.queue = [root];

state.visited.clear();
state.completed.clear();

state.stored = 0;
state.splits = 0;
state.errors = 0;

state.stopped = false;
state.paused = false;

$("log").innerHTML = "";

log(
  `Gyökér node: R — ` +
  `${size.lonKm.toFixed(3)} × ` +
  `${size.latKm.toFixed(3)} km`,
  "ok"
);
```

}

runCrawler();
}

//--------------------------------------------------
// PAUSE
//--------------------------------------------------

function pauseCrawler() {

if (!state.running) return;

state.paused = true;

log("PAUSE", "warning");
}

//--------------------------------------------------
// STOP
//--------------------------------------------------

function stopCrawler() {

state.stopped = true;
state.paused = false;

log("STOP kérés", "warning");
}

//--------------------------------------------------
// RESET
//--------------------------------------------------

function resetCrawler() {

state.running = false;
state.paused = false;
state.stopped = true;

state.queue = [];
state.visited.clear();
state.completed.clear();

state.stored = 0;
state.splits = 0;
state.errors = 0;

state.root = null;

showCurrent(null);

$("log").innerHTML = "";

updateStats();

log("Állapot törölve", "warning");
}

//--------------------------------------------------
// Segéd
//--------------------------------------------------

function sleep(ms) {
return new Promise(
resolve => setTimeout(resolve, ms)
);
}

//--------------------------------------------------
// Input változás
//--------------------------------------------------

for (const id of [
"minLon",
"minLat",
"maxLon",
"maxLat"
]) {
$(id).addEventListener(
"input",
updateAreaInfo
);
}

//--------------------------------------------------
// Gombok
//--------------------------------------------------

$("startBtn")
.addEventListener(
"click",
startCrawler
);

$("pauseBtn")
.addEventListener(
"click",
pauseCrawler
);

$("stopBtn")
.addEventListener(
"click",
stopCrawler
);

$("resetBtn")
.addEventListener(
"click",
resetCrawler
);

//--------------------------------------------------
// Indulás
//--------------------------------------------------

updateAreaInfo();
updateStats();
