const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "";


/* =========================================================
   TELEGRAM
========================================================= */

function telegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const data = new URLSearchParams({
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  }).toString();

  const req = https.request({
    hostname: "api.telegram.org",
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data)
    }
  });

  req.on("error", () => {});

  req.write(data);
  req.end();
}


/* =========================================================
   SAFE SEND
========================================================= */

function send(ws, message) {
  if (!ws) return false;

  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch (err) {
    console.log("Send error:", err.message);
    return false;
  }
}


/* =========================================================
   ID
========================================================= */

function makeId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4)
  );
}


/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {

  const routes = {
    "/": "camera.html",
    "/camera": "camera.html",
    "/camera.html": "camera.html",
    "/viewer": "viewer.html",
    "/viewer.html": "viewer.html"
  };

  const pathname =
    new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname;

  const file = routes[pathname];

  if (!file) {
    res.writeHead(404);
    return res.end("Not found");
  }

  if (
    pathname === "/" ||
    pathname === "/camera" ||
    pathname === "/camera.html"
  ) {
    telegram(
      "🔔 Someone opened the camera page.\n" +
      "Camera permission is still required."
    );
  }

  fs.readFile(
    path.join(__dirname, file),
    (err, data) => {

      if (err) {
        console.log("File error:", err.message);

        res.writeHead(500);
        return res.end("Server error");
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });

      res.end(data);
    }
  );
});


/* =========================================================
   WEBSOCKET
========================================================= */

const wss = new WebSocket.Server({
  server
});


/*
   cameraId -> WebSocket
*/
const cameras = new Map();


/*
   viewerId -> WebSocket
*/
const viewers = new Map();


/* =========================================================
   BROADCAST CAMERA EVENT
========================================================= */

function broadcast(message) {
  for (const viewer of viewers.values()) {
    send(viewer, message);
  }
}


/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

wss.on("connection", (ws, req) => {

  const pathname =
    new URL(
      req.url || "/",
      "http://localhost"
    ).pathname;


  /* =======================================================
     CAMERA CONNECTION
  ======================================================= */

  if (pathname === "/camera") {

    const cameraId = makeId();

    cameras.set(cameraId, ws);

    console.log(
      "📷 Camera connected:",
      cameraId
    );


    /* Tell camera its ID */

    send(ws, {
      type: "role",
      role: "camera",
      cameraId
    });


    /* Tell existing viewers */

    broadcast({
      type: "camera-online",
      cameraId
    });


    telegram(
      "📷 Camera page connected.\n" +
      `Camera ID: ${cameraId}\n` +
      "The user must still allow camera access."
    );


    /* =====================================================
       CAMERA MESSAGES
    ===================================================== */

    ws.on("message", raw => {

      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        console.log("Invalid camera message");
        return;
      }


      console.log(
        "CAMERA → SERVER:",
        msg.type,
        cameraId
      );


      /* ===================================================
         CAMERA LIVE
      =================================================== */

      if (msg.type === "camera-live") {

        console.log(
          "🟢 Camera LIVE:",
          cameraId
        );

        telegram(
          "🟢 Camera permission was granted.\n" +
          `Camera ID: ${cameraId}`
        );

        broadcast({
          type: "camera-live",
          cameraId
        });

        return;
      }


      /* ===================================================
         VIEWER READY
         
         Camera should receive:
         viewerId
         cameraId
      =================================================== */

      if (msg.type === "viewer-ready") {

        const viewerId =
          msg.viewerId ||
          msg.toViewerId ||
          msg.targetViewerId;

        if (!viewerId) {

          console.log(
            "⚠️ viewer-ready has no viewerId"
          );

          return;
        }


        const viewer =
          viewers.get(viewerId);

        if (!viewer) {

          console.log(
            "⚠️ Viewer not found:",
            viewerId
          );

          return;
        }


        send(ws, {
          type: "viewer-ready",
          viewerId,
          cameraId,
          reconnect: !!msg.reconnect
        });


        console.log(
          "viewer-ready accepted:",
          cameraId,
          "→",
          viewerId
        );

        return;
      }


      /* ===================================================
         CAMERA → VIEWER WEBRTC SIGNALING

         offer
         candidate
      =================================================== */

      if (
        msg.type === "offer" ||
        msg.type === "candidate"
      ) {

        const viewerId =
          msg.toViewerId ||
          msg.viewerId ||
          msg.targetViewerId;

        if (!viewerId) {

          console.log(
            `⚠️ ${msg.type} has no viewer ID`
          );

          return;
        }


        const viewer =
          viewers.get(viewerId);

        if (!viewer) {

          console.log(
            "⚠️ Viewer not connected:",
            viewerId
          );

          return;
        }


        const outgoing = {
          type: msg.type,
          cameraId
        };


        if (msg.type === "offer") {
          outgoing.offer = msg.offer;
        }


        if (msg.type === "candidate") {
          outgoing.candidate = msg.candidate;
        }


        send(viewer, outgoing);


        console.log(
          `CAMERA → VIEWER: ${msg.type}`,
          cameraId,
          viewerId
        );

        return;
      }

    });


    /* =====================================================
       CAMERA CLOSE
    ===================================================== */

    ws.on("close", () => {

      if (cameras.get(cameraId) !== ws) {
        return;
      }


      cameras.delete(cameraId);


      console.log(
        "🔴 Camera disconnected:",
        cameraId
      );


      broadcast({
        type: "camera-offline",
        cameraId
      });


      telegram(
        "🔴 Camera disconnected.\n" +
        `Camera ID: ${cameraId}`
      );
    });


    ws.on("error", err => {

      console.log(
        "Camera WebSocket error:",
        err.message
      );

    });


    return;
  }


  /* =======================================================
     VIEWER CONNECTION
  ======================================================= */

  if (pathname !== "/viewer") {

    ws.close();
    return;

  }


  const viewerId = makeId();

  viewers.set(viewerId, ws);


  console.log(
    "👁 Viewer connected:",
    viewerId
  );


  /* =====================================================
     SEND VIEWER ROLE
  ===================================================== */

  send(ws, {
    type: "role",
    role: "viewer",
    viewerId,
    cameras: [...cameras.keys()]
  });


  /* =====================================================
     SEND EXISTING CAMERAS
  ===================================================== */

  for (const cameraId of cameras.keys()) {

    send(ws, {
      type: "camera-online",
      cameraId
    });

  }


  /* =====================================================
     VIEWER MESSAGES
  ===================================================== */

  ws.on("message", raw => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.log("Invalid viewer message");
      return;
    }


    console.log(
      "VIEWER → SERVER:",
      msg.type,
      viewerId,
      msg.cameraId || ""
    );


    /* ===================================================
       VIEWER READY
    =================================================== */

    if (
      msg.type === "viewer-ready" &&
      msg.cameraId
    ) {

      const cameraId =
        msg.cameraId;

      const camera =
        cameras.get(cameraId);


      if (!camera) {

        send(ws, {
          type: "camera-offline",
          cameraId
        });

        return;
      }


      /*
         Forward viewer-ready to camera.
      */

      send(camera, {
        type: "viewer-ready",
        viewerId,
        cameraId,
        reconnect: !!msg.reconnect
      });


      console.log(
        "VIEWER READY:",
        viewerId,
        "→",
        cameraId
      );


      return;
    }


    /* ===================================================
       VIEWER → CAMERA
       
       answer
       candidate
    =================================================== */

    if (
      (
        msg.type === "answer" ||
        msg.type === "candidate"
      ) &&
      msg.cameraId
    ) {

      const cameraId =
        msg.cameraId;

      const camera =
        cameras.get(cameraId);


      if (!camera) {

        send(ws, {
          type: "camera-offline",
          cameraId
        });

        return;
      }


      const outgoing = {
        type: msg.type,
        cameraId,
        toViewerId: viewerId
      };


      if (msg.type === "answer") {
        outgoing.answer = msg.answer;
      }


      if (msg.type === "candidate") {
        outgoing.candidate = msg.candidate;
      }


      send(camera, outgoing);


      console.log(
        `VIEWER → CAMERA: ${msg.type}`,
        viewerId,
        cameraId
      );


      return;
    }

  });


  /* =====================================================
     VIEWER CLOSE
  ===================================================== */

  ws.on("close", () => {

    if (viewers.get(viewerId) === ws) {
      viewers.delete(viewerId);
    }


    console.log(
      "🔴 Viewer disconnected:",
      viewerId
    );

  });


  ws.on("error", err => {

    console.log(
      "Viewer WebSocket error:",
      err.message
    );

  });

});


/* =========================================================
   SERVER START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Multi-camera server running on port ${PORT}`
    );

  }
);


/* =========================================================
   SERVER ERROR
========================================================= */

server.on("error", err => {

  console.error(
    "Server error:",
    err
  );

});
