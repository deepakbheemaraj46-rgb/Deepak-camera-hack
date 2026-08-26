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

    path:
      `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,

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
   SEND MESSAGE
========================= */

function send(ws, message) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {

    ws.send(
      JSON.stringify(message)
    );

  }

}


/* =========================
   ID
========================= */

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

const server = http.createServer(
  (req, res) => {

    const routes = {

      "/":
        "viewer.html",

      "/camera":
        "camera.html",

      "/camera.html":
        "camera.html",

      "/viewer":
        "viewer.html",

      "/viewer.html":
        "viewer.html"

    };


    const pathname =
      new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      ).pathname;


    const file =
      routes[pathname];


    if (!file) {

      res.writeHead(404);

      return res.end(
        "Not found"
      );

    }


    fs.readFile(
      path.join(__dirname, file),
      (err, data) => {

        if (err) {

          res.writeHead(500);

          return res.end(
            "Server error"
          );

        }


        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );


        res.end(data);

      }
    );

  }
);


/* =========================
   WEBSOCKET SERVER
========================= */

const wss =
  new WebSocket.Server({
    server
  });


const cameras =
  new Map();


const viewers =
  new Map();


/* =========================
   CONNECTION
========================= */

wss.on(
  "connection",
  (ws, req) => {

    const pathname =
      new URL(
        req.url,
        "http://localhost"
      ).pathname;


    console.log(
      "WebSocket:",
      pathname
    );


    /* =========================
       CAMERA
    ========================= */

    if (pathname === "/camera") {

      const cameraId =
        makeId();


      cameras.set(
        cameraId,
        ws
      );


      send(ws, {

        type: "role",

        role: "camera",

        cameraId

      });


      console.log(
        "Camera connected:",
        cameraId
      );


      /* Tell viewers */

      for (
        const viewer
        of viewers.values()
      ) {

        send(viewer, {

          type:
            "camera-online",

          cameraId

        });

      }


      telegram(
        `📷 Camera connected\nCamera ID: ${cameraId}`
      );


      /* CAMERA MESSAGES */

      ws.on(
        "message",
        raw => {

          let msg;


          try {

            msg =
              JSON.parse(
                raw.toString()
              );

          }
          catch {

            return;

          }


          console.log(
            "Camera message:",
            msg.type
          );


          /* Camera became LIVE */

          if (
            msg.type ===
            "camera-live"
          ) {

            console.log(
              "Camera LIVE:",
              cameraId
            );


            for (
              const viewer
              of viewers.values()
            ) {

              send(viewer, {

                type:
                  "camera-live",

                cameraId

              });

            }


            return;

          }


          /* Send WebRTC message
             to specific viewer */

          if (
            msg.toViewerId
          ) {

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


      /* CAMERA DISCONNECTED */

      ws.on(
        "close",
        () => {

          if (
            cameras.get(
              cameraId
            ) === ws
          ) {

            cameras.delete(
              cameraId
            );


            console.log(
              "Camera disconnected:",
              cameraId
            );


            for (
              const viewer
              of viewers.values()
            ) {

              send(viewer, {

                type:
                  "camera-offline",

                cameraId

              });

            }

          }

        }
      );


      return;

    }


    /* =========================
       VIEWER
    ========================= */

    if (pathname === "/viewer") {

      const viewerId =
        makeId();


      viewers.set(
        viewerId,
        ws
      );


      console.log(
        "Viewer connected:",
        viewerId
      );


      /* Send current cameras */

      send(ws, {

        type: "role",

        role: "viewer",

        viewerId,

        cameras:
          [...cameras.keys()]

      });


      /* Notify about cameras */

      for (
        const cameraId
        of cameras.keys()
      ) {

        send(ws, {

          type:
            "camera-online",

          cameraId

        });

      }


      /* VIEWER MESSAGES */

      ws.on(
        "message",
        raw => {

          let msg;


          try {

            msg =
              JSON.parse(
                raw.toString()
              );

          }
          catch {

            return;

          }


          console.log(
            "Viewer message:",
            msg.type
          );


          /* Viewer ready */

          if (
            msg.type ===
              "viewer-ready" &&
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


          /* Forward WebRTC
             message to camera */

          if (
            msg.cameraId
          ) {

            const camera =
              cameras.get(
                msg.cameraId
              );


            if (camera) {

              send(camera, {

                ...msg,

                toViewerId:
                  viewerId

              });

            }

          }

        }
      );


      /* VIEWER DISCONNECTED */

      ws.on(
        "close",
        () => {

          console.log(
            "Viewer disconnected:",
            viewerId
          );


          viewers.delete(
            viewerId
          );

        }
      );


      return;

    }


    ws.close();

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
      `Multi-camera server running on port ${PORT}`
    );

  }
);
