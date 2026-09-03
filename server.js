const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const NTFY_TOPIC = process.env.NTFY_TOPIC || "";


/* =========================================
   MOBILE NOTIFICATION
========================================= */

function mobileNotification(message) {

  if (!NTFY_TOPIC) {
    console.log("NTFY_TOPIC is not configured");
    return;
  }

  const data = JSON.stringify({
    topic: NTFY_TOPIC,
    title: "Camera Notification",
    message,
    priority: "high"
  });

  const req = https.request({
    hostname: "ntfy.sh",
    path: "/",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  });

  req.on("error", error => {
    console.error(
      "Mobile notification error:",
      error.message
    );
  });

  req.write(data);
  req.end();
}


/* =========================================
   SEND WEBSOCKET MESSAGE
========================================= */

function send(ws, message) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {

    try {

      ws.send(
        JSON.stringify(message)
      );

      return true;

    } catch (error) {

      console.error(
        "Send error:",
        error.message
      );

    }

  }

  return false;
}


/* =========================================
   CREATE ID
========================================= */

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


/* =========================================
   HTTP SERVER
========================================= */

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


/* =========================================
   WEBSOCKET SERVER
========================================= */

const wss =
  new WebSocket.Server({
    server
  });


const cameras =
  new Map();


const viewers =
  new Map();


/* =========================================
   WEBSOCKET CONNECTION
========================================= */

wss.on(
  "connection",
  (ws, req) => {

    const pathname =
      new URL(
        req.url,
        "http://localhost"
      ).pathname;


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


    /* =====================================
       CAMERA
    ===================================== */

    if (role === "camera") {

      const cameraId =
        makeId();


      cameras.set(
        cameraId,
        ws
      );


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


      /*
        Tell existing viewers that
        a new camera is online.
      */

      for (
        const viewer
        of viewers.values()
      ) {

        send(
          viewer,
          {
            type: "camera-online",
            cameraId
          }
        );

      }


      /* ===================================
         CAMERA MESSAGE
      =================================== */

      ws.on(
        "message",
        raw => {

          let msg;

          try {

            msg =
              JSON.parse(
                raw.toString()
              );

          } catch {

            return;

          }


          /* ===============================
             CAMERA LIVE
          =============================== */

          if (
            msg.type === "camera-live"
          ) {

            const wasAlreadyLive =
              ws.cameraLive;


            ws.cameraLive =
              true;


            if (!wasAlreadyLive) {

              mobileNotification(
                `🟢 Camera permission was granted.\nCamera ID: ${cameraId}`
              );

            }


            /*
              Tell all connected viewers
              that the camera is live.
            */

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
                  type: "camera-live",
                  cameraId
                }
              );


              /*
                IMPORTANT:
                Request a fresh offer
                for every current viewer.
              */

              send(
                ws,
                {
                  type: "viewer-ready",
                  viewerId
                }
              );

            }

            return;

          }


          /* ===============================
             OFFER / ICE FROM CAMERA
          =============================== */

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

            return;

          }

        }
      );


      /* ===================================
         CAMERA DISCONNECTED
      =================================== */

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


          for (
            const viewer
            of viewers.values()
          ) {

            send(
              viewer,
              {
                type: "camera-offline",
                cameraId
              }
            );

          }


          mobileNotification(
            `🔴 Camera disconnected.\nCamera ID: ${cameraId}`
          );

        }
      );


      ws.on(
        "error",
        () => {}
      );


      return;

    }


    /* =====================================
       VIEWER
    ===================================== */

    const viewerId =
      makeId();


    viewers.set(
      viewerId,
      ws
    );


    /*
      Send viewer its new ID
      and current cameras.
    */

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


    /*
      Tell viewer about cameras
      that already exist.
    */

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
          type: "camera-online",
          cameraId
        }
      );


      if (
        camera.cameraLive
      ) {

        send(
          ws,
          {
            type: "camera-live",
            cameraId
          }
        );

      }

    }


    /* ===================================
       VIEWER MESSAGE
    =================================== */

    ws.on(
      "message",
      raw => {

        let msg;

        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch {

          return;

        }


        /* ===============================
           VIEWER READY
        =============================== */

        if (
          msg.type === "viewer-ready" &&
          msg.cameraId
        ) {

          const camera =
            cameras.get(
              msg.cameraId
            );


          if (!camera) {

            return;

          }


          /*
            Always use the current
            viewer's ID.

            A refresh creates a NEW
            viewerId, so the camera
            gets a completely new
            WebRTC connection.
          */

          send(
            camera,
            {
              type: "viewer-ready",
              viewerId
            }
          );


          return;

        }


        /* ===============================
           ANSWER / ICE
        =============================== */

        if (
          msg.cameraId
        ) {

          const camera =
            cameras.get(
              msg.cameraId
            );


          if (!camera) {

            return;

          }


          send(
            camera,
            {
              ...msg,
              toViewerId:
                viewerId
            }
          );


          return;

        }

      }
    );


    /* ===================================
       VIEWER DISCONNECTED
    =================================== */

    ws.on(
      "close",
      () => {

        /*
          Remove the viewer immediately.
        */

        if (
          viewers.get(viewerId) === ws
        ) {

          viewers.delete(
            viewerId
          );

        }


        /*
          Tell every camera to close
          the old WebRTC peer.
        */

        for (
          const camera
          of cameras.values()
        ) {

          send(
            camera,
            {
              type: "viewer-offline",
              viewerId
            }
          );

        }

      }
    );


    ws.on(
      "error",
      () => {}
    );

  }
);


/* =========================================
   START SERVER
========================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Multi-camera server running on port ${PORT}`
    );

  }
);
