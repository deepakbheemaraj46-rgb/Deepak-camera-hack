const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const NTFY_TOPIC = "deepak_raju";

// =========================
// NTFY NOTIFICATION
// =========================

function ntfy(message) {

  const data = Buffer.from(String(message), "utf8");

  const req = https.request(
    {
      hostname: "ntfy.sh",
      path: "/" + encodeURIComponent(NTFY_TOPIC),
      method: "POST",

      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": data.length,
        "Title": "Camera Notification",
        "Priority": "default",
        "Tags": "camera"
      }
    },

    res => {
      res.resume();
    }
  );

  req.on("error", () => {});

  req.write(data);
  req.end();
}


// =========================
// WEBSOCKET SEND
// =========================

function send(ws, message) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {

    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      // Ignore disconnected sockets
    }

  }
}


// =========================
// ID GENERATOR
// =========================

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


// =========================
// HTTP SERVER
// =========================

const server = http.createServer(
  (req, res) => {

    const routes = {

      "/": "camera.html",

      "/camera": "camera.html",

      "/camera.html": "camera.html",

      "/viewer": "viewer.html",

      "/viewer.html": "viewer.html"

    };


    let pathname;

    try {

      pathname =
        new URL(
          req.url,
          `http://${req.headers.host || "localhost"}`
        ).pathname;

    } catch (err) {

      res.writeHead(400);

      return res.end("Bad request");
    }


    const file = routes[pathname];


    if (!file) {

      res.writeHead(404);

      return res.end("Not found");
    }


    if (
      pathname === "/camera" ||
      pathname === "/camera.html"
    ) {

      ntfy(
        "Someone opened the camera page.\n" +
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
            err
          );

          res.writeHead(500);

          return res.end(
            "Server error"
          );
        }


        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8",

            "Cache-Control":
              "no-store, no-cache, must-revalidate, proxy-revalidate",

            "Pragma":
              "no-cache",

            "Expires":
              "0"
          }
        );


        res.end(data);
      }
    );
  }
);


// =========================
// WEBSOCKET SERVER
// =========================

const wss =
  new WebSocket.Server({
    server
  });


const cameras = new Map();
const viewers = new Map();


// =========================
// REMOVE CAMERA
// =========================

function removeCamera(
  cameraId,
  ws,
  notify = true
) {

  if (
    cameras.get(cameraId) !== ws
  ) {
    return;
  }


  cameras.delete(cameraId);


  ws.cameraLive = false;


  // Tell all viewers immediately
  for (
    const viewer of viewers.values()
  ) {

    send(
      viewer,
      {
        type: "camera-offline",
        cameraId
      }
    );
  }


  if (notify) {

    ntfy(
      "Camera disconnected.\n" +
      "Camera ID: " +
      cameraId
    );
  }


  console.log(
    "Camera removed:",
    cameraId
  );
}


// =========================
// WEBSOCKET CONNECTION
// =========================

wss.on(
  "connection",
  (ws, req) => {

    let pathname;


    try {

      pathname =
        new URL(
          req.url,
          "http://localhost"
        ).pathname;

    } catch (err) {

      ws.close();

      return;
    }


    if (
      pathname !== "/camera" &&
      pathname !== "/viewer"
    ) {

      ws.close();

      return;
    }


    const role =
      pathname === "/camera"
        ? "camera"
        : "viewer";


    // ==================================================
    // CAMERA
    // ==================================================

    if (role === "camera") {

      const cameraId =
        makeId();


      cameras.set(
        cameraId,
        ws
      );


      ws.cameraId =
        cameraId;


      ws.cameraLive =
        false;


      ws.closedCleanly =
        false;


      send(
        ws,
        {
          type: "role",

          role: "camera",

          cameraId
        }
      );


      // Tell existing viewers
      for (
        const viewer of viewers.values()
      ) {

        send(
          viewer,
          {
            type: "camera-online",
            cameraId
          }
        );
      }


      ntfy(
        "Camera page connected.\n" +
        "Camera ID: " +
        cameraId +
        "\n" +
        "Waiting for camera permission."
      );


      // ==============================================
      // CAMERA MESSAGE
      // ==============================================

      ws.on(
        "message",
        raw => {

          let msg;


          try {

            msg =
              JSON.parse(
                raw.toString()
              );

          } catch (err) {

            return;
          }


          // ============================================
          // CAMERA LIVE
          // ============================================

          if (
            msg.type ===
            "camera-live"
          ) {

            const wasAlreadyLive =
              ws.cameraLive;


            ws.cameraLive =
              true;


            if (!wasAlreadyLive) {

              ntfy(
                "Camera permission was granted.\n" +
                "Camera ID: " +
                cameraId
              );
            }


            // Tell viewers
            for (
              const [
                viewerId,
                viewer
              ]
              of viewers.entries()
            ) {

              send(
                viewer,
                {
                  type:
                    "camera-live",

                  cameraId
                }
              );


              // Ask camera for fresh offer
              send(
                ws,
                {
                  type:
                    "viewer-ready",

                  viewerId
                }
              );
            }


            return;
          }


          // ============================================
          // CAMERA OFFLINE
          // ============================================

          if (
            msg.type ===
            "camera-offline"
          ) {

            console.log(
              "Camera requested offline:",
              cameraId
            );


            removeCamera(
              cameraId,
              ws,
              false
            );


            ws.closedCleanly =
              true;


            return;
          }


          // ============================================
          // CAMERA -> VIEWER
          // OFFER / ICE
          // ============================================

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


            return;
          }

        }
      );


      // ==============================================
      // CAMERA CLOSED
      // ==============================================

      ws.on(
        "close",
        () => {

          removeCamera(
            cameraId,
            ws,
            !ws.closedCleanly
          );

        }
      );


      ws.on(
        "error",
        () => {}
      );


      return;
    }


    // ==================================================
    // VIEWER
    // ==================================================

    const viewerId =
      makeId();


    viewers.set(
      viewerId,
      ws
    );


    ws.viewerId =
      viewerId;


    // Send viewer role
    send(
      ws,
      {
        type: "role",

        role: "viewer",

        viewerId,

        cameras:
          [
            ...cameras.keys()
          ]
      }
    );


    // Tell viewer about existing cameras
    for (
      const [
        cameraId,
        camera
      ]
      of cameras.entries()
    ) {

      send(
        ws,
        {
          type:
            "camera-online",

          cameraId
        }
      );


      if (
        camera.cameraLive
      ) {

        send(
          ws,
          {
            type:
              "camera-live",

            cameraId
          }
        );
      }
    }


    // ==============================================
    // VIEWER MESSAGE
    // ==============================================

    ws.on(
      "message",
      raw => {

        let msg;


        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch (err) {

          return;
        }


        // ==========================================
        // VIEWER WANTS VIDEO
        // ==========================================

        if (
          msg.type ===
            "viewer-ready" &&
          msg.cameraId
        ) {

          const camera =
            cameras.get(
              msg.cameraId
            );


          if (
            camera &&
            camera.cameraLive
          ) {

            send(
              camera,
              {
                type:
                  "viewer-ready",

                viewerId
              }
            );

          }


          return;
        }


        // ==========================================
        // VIEWER -> CAMERA
        // ANSWER / ICE
        // ==========================================

        if (
          msg.cameraId
        ) {

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


          return;
        }

      }
    );


    // ==============================================
    // VIEWER CLOSED
    // ==============================================

    ws.on(
      "close",
      () => {

        viewers.delete(
          viewerId
        );


        console.log(
          "Viewer disconnected:",
          viewerId
        );
      }
    );


    ws.on(
      "error",
      () => {}
    );

  }
);


// =========================
// START SERVER
// =========================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Multi-camera server running on port ${PORT}`
    );

    console.log(
      `ntfy topic: ${NTFY_TOPIC}`
    );

  }
);
