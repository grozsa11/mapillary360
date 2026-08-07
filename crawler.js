// Mapillary 360 Crawler
// Quadtree-alapú bbox queue
//
// Egy node azonosítója:
// R      = gyökér
// R0     = bal alsó
// R1     = jobb alsó
// R2     = bal felső
// R3     = jobb felső
//
// A Worker egy node-ot dolgoz fel.
// Ha túl nagy, a crawler a négy gyereket teszi a queue-ba.

const state = {
  queue: [],
  visited: new Set(),
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


function showCurrent(node) {

  if(!node) {
    $("current").textContent = "-";
    return;
  }

  $("current").textContent =
    `Node: ${node.id}\n` +
    `minLon: ${node.bbox.minLon}\n` +
    `minLat: ${node.bbox.minLat}\n` +
    `maxLon: ${node.bbox.maxLon}\n` +
    `maxLat: ${node.bbox.maxLat}`;

}


function log(message,type="") {

  const line=document.createElement("div");

  if(type)
    line.className="log-"+type;

  const now=new Date().toLocaleTimeString();

  line.textContent=`${now}  ${message}`;

  $("log").appendChild(line);

  $("log").scrollTop=$("log").scrollHeight;

}


//--------------------------------------------------
// Quadtree
//--------------------------------------------------

function childNodes(node) {

  const b=node.bbox;

  const midLon=
    (b.minLon+b.maxLon)/2;

  const midLat=
    (b.minLat+b.maxLat)/2;


  return [

    {
      id:node.id+"0",
      bbox:{
        minLon:b.minLon,
        minLat:b.minLat,
        maxLon:midLon,
        maxLat:midLat
      }
    },

    {
      id:node.id+"1",
      bbox:{
        minLon:midLon,
        minLat:b.minLat,
        maxLon:b.maxLon,
        maxLat:midLat
      }
    },

    {
      id:node.id+"2",
      bbox:{
        minLon:b.minLon,
        minLat:midLat,
        maxLon:midLon,
        maxLat:b.maxLat
      }
    },

    {
      id:node.id+"3",
      bbox:{
        minLon:midLon,
        minLat:midLat,
        maxLon:b.maxLon,
        maxLat:b.maxLat
      }
    }

  ];

}


//--------------------------------------------------
// Worker URL
//--------------------------------------------------

function getWorkerUrl() {

  return $("workerUrl")
    .value
    .trim()
    .replace(/\/+$/,"");

}


//--------------------------------------------------
// BBOX URL
//--------------------------------------------------

function bboxString(b) {

  return [
    b.minLon,
    b.minLat,
    b.maxLon,
    b.maxLat
  ].join(",");

}


//--------------------------------------------------
// Egy node feldolgozása
//--------------------------------------------------

async function processNode(node) {

  showCurrent(node);

  const url =
    getWorkerUrl() +
    "/store?bbox=" +
    encodeURIComponent(
      bboxString(node.bbox)
    ) +
    "&t=" +
    Date.now();


  const response =
    await fetch(url);


  const text =
    await response.text();


  let data;

  try {
    data=JSON.parse(text);
  }
  catch {
    throw Error(
      `HTTP ${response.status}: ${text.slice(0,300)}`
    );
  }


  if(!response.ok) {

    throw Error(
      data.error ||
      `HTTP ${response.status}`
    );

  }


  return data;

}


//--------------------------------------------------
// Crawler
//--------------------------------------------------

async function runCrawler() {

  if(state.running)
    return;


  state.running=true;
  state.paused=false;
  state.stopped=false;


  log("Crawler elindult");


  while(
    state.queue.length &&
    !state.stopped
  ){

    if(state.paused){

      await sleep(500);

      continue;

    }


    const node=
      state.queue.shift();


    if(state.visited.has(node.id))
      continue;


    state.visited.add(node.id);

    updateStats();


    try {

      const result=
        await processNode(node);


      if(result.needSplit){

        const children=
          childNodes(node);


        for(const child of children){

          if(
            !state.visited.has(child.id)
          ){

            state.queue.push(child);

          }

        }


        state.splits++;

        log(
          `${node.id} SPLIT → ${children.map(x=>x.id).join(", ")}`,
          "split"
        );

      }
      else {

        state.stored++;

        const stats=
          result.stats || {};


        log(
          `${node.id} OK — ` +
          `images=${stats.totalImages ?? "?"}, ` +
          `pano=${stats.panoImages ?? "?"}, ` +
          `seq=${stats.sequencesFound ?? "?"}`,
          "ok"
        );

      }

    }
    catch(error){

      state.errors++;

      log(
        `${node.id} ERROR: ${error.message}`,
        "error"
      );

    }


    updateStats();

    await sleep(100);

  }


  state.running=false;

  if(state.stopped)
    log("Crawler leállítva");

  else if(state.paused)
    log("Crawler szüneteltetve");

  else
    log("Crawler kész");


  updateStats();

}


//--------------------------------------------------
// START
//--------------------------------------------------

function startCrawler() {

  if(state.running)
    return;


  if(!state.queue.length){

    const root={
      id:"R",
      bbox:{
        minLon:Number($("minLon").value),
        minLat:Number($("minLat").value),
        maxLon:Number($("maxLon").value),
        maxLat:Number($("maxLat").value)
      }
    };


    if(
      !Number.isFinite(root.bbox.minLon) ||
      !Number.isFinite(root.bbox.minLat) ||
      !Number.isFinite(root.bbox.maxLon) ||
      !Number.isFinite(root.bbox.maxLat)
    ){

      alert("Érvénytelen bbox");

      return;

    }


    if(
      root.bbox.minLon>=root.bbox.maxLon ||
      root.bbox.minLat>=root.bbox.maxLat
    ){

      alert("A bbox koordinátái hibásak");

      return;

    }


    state.root=root;

    state.queue=[root];

    state.visited.clear();

    state.stored=0;
    state.splits=0;
    state.errors=0;

    $("log").innerHTML="";

    log(
      `Gyökér node: R`,
      "ok"
    );

  }


  runCrawler();

}


//--------------------------------------------------
// PAUSE / STOP / RESET
//--------------------------------------------------

function pauseCrawler() {

  if(!state.running)
    return;

  state.paused=true;

  log("PAUSE");

}


function stopCrawler() {

  state.stopped=true;
  state.paused=false;

}


function resetCrawler() {

  state.running=false;
  state.paused=false;
  state.stopped=true;

  state.queue=[];
  state.visited.clear();

  state.stored=0;
  state.splits=0;
  state.errors=0;

  state.root=null;

  showCurrent(null);

  $("log").innerHTML="";

  updateStats();

  log("Állapot törölve");

}


//--------------------------------------------------
// Segéd
//--------------------------------------------------

function sleep(ms) {

  return new Promise(
    resolve=>setTimeout(resolve,ms)
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


updateStats();
