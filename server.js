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

  const topic = NTFY_TOPIC.trim();

  if (!topic) {
    console.error(
      "❌ NTFY_TOPIC is not configured in Render"
    );
    return;
  }

  const data = Buffer.from(
    message,
    "utf8"
  );

  console.log(
    "📱 Sending ntfy notification..."
  );

  console.log(
    "📱 Topic:",
    topic
  );

  console.log(
    "📱 Message:",
    message
  );


  const req = https.request({

    hostname: "ntfy.sh",

    port: 443,

    path:
      "/" +
      encodeURIComponent(topic),

    method: "POST",

    headers: {

      "Content-Type":
        "text/plain; charset=utf-8",

      "Content-Length":
        data.length,

      "Title":
        "Camera Notification",

      "Priority":
        "high"

    }

  }, res => {

    let response = "";

    res.on(
      "data",
      chunk => {
        response += chunk.toString();
      }
    );

    res.on(
      "end",
      () => {

        console.log(
          "📱 ntfy HTTP status:",
          res.statusCode
        );


        if (response) {

          console.log(
            "📱 ntfy response:",
            response
          );

        }


        if (
          res.statusCode >= 200 &&
          res.statusCode < 300
        ) {

          console.log(
            "✅ Mobile notification sent successfully"
          );

        } else {

          console.error(
            "❌ ntfy notification failed"
          );

        }

      }
    );

  });


  req.on(
    "error",
    error => {

      console.error(
        "❌ Mobile notification error:",
        error.message
      );

    }
  );


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

const server =
  http.createServer(
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


      let pathname;

      try {

        pathname =
          new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
          ).pathname;

      } catch {

        res.writeHead(400);

        return res.end(
          "Bad request"
        );

      }


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

            console.error(
              "File error:",
              err.message
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

    let pathname;

    try {

      pathname =
        new URL(
          req.url,
          "http://localhost"
        ).pathname;

    } catch {

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


      /*
        Notify mobile immediately
        when camera WebSocket connects.
      */

      mobileNotification(
        `🟢 Camera connected.\nCamera ID: ${cameraId}`
      );


      /*
        Give camera its ID.
      */

      send(
        ws,
        {
          type: "role",
          role: "camera",
          cameraId
        }
      );


      /*
        Tell existing viewers
        that a new camera is online.
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

          } catch (error) {

            console.error(
              "Invalid camera message"
            );

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


            /*
              Send notification only once
              for this camera connection.
            */

            if (!wasAlreadyLive) {

              mobileNotification(
                `🟢 Camera is LIVE.\nCamera ID: ${cameraId}`
              );

            }


            /*
              Tell all connected viewers
              that camera is live.
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
                Request a fresh WebRTC offer.
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


          /*
            Tell every viewer that
            this camera is offline.
          */

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


          /*
            Send mobile notification.
          */

          mobileNotification(
            `🔴 Camera disconnected.\nCamera ID: ${cameraId}`
          );

        }
      );


      ws.on(
        "error",
        error => {

          console.error(
            "Camera WebSocket error:",
            error.message
          );

        }
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
      Send viewer its ID
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

        } catch (error) {

          console.error(
            "Invalid viewer message"
          );

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
            Always use the current viewer ID.
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
          Remove viewer immediately.
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
      error => {

        console.error(
          "Viewer WebSocket error:",
          error.message
        );

      }
    );

  }
);


/* =========================================
   SERVER ERROR
========================================= */

server.on(
  "error",
  error => {

    console.error(
      "HTTP server error:",
      error.message
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

    console.log(
      "NTFY:",
      NTFY_TOPIC
        ? "configured"
        : "NOT CONFIGURED"
    );

  }
);
