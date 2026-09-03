const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

/*
  Mobile notification settings.

  Set NTFY_TOPIC in your hosting environment.
  Example:
  NTFY_TOPIC=your-private-random-topic
*/

const NTFY_TOPIC =
  process.env.NTFY_TOPIC || "";


/* =========================================
   MOBILE NOTIFICATION
========================================= */

function mobileNotification(message) {

  if (!NTFY_TOPIC) {

    console.log(
      "NTFY_TOPIC is not configured"
    );

    return;

  }


  const data = JSON.stringify({

    topic: NTFY_TOPIC,

    title:
      "Camera Notification",

    message,

    priority:
      "high"

  });


  const req = https.request({

    hostname:
      "ntfy.sh",

    path:
      "/",

    method:
      "POST",

    headers: {

      "Content-Type":
        "application/json",

      "Content-Length":
        Buffer.byteLength(data)

    }

  });


  req.on(
    "error",
    error => {

      console.error(
        "Mobile notification error:",
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

    ws.send(
      JSON.stringify(message)
    );

  }

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



wss.on(

  "connection",

  (ws, req) => {


    const pathname =

      new URL(

        req.url,

        "http://localhost"

      ).pathname;


    /*
      Only accept camera
      and viewer connections.
    */

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

    if (

      role === "camera"

    ) {


      const cameraId =
        makeId();


      cameras.set(

        cameraId,

        ws

      );


      /*
        Camera permission
        has not been granted yet.
      */

      ws.cameraLive =
        false;


      send(

        ws,

        {

          type:
            "role",

          role:
            "camera",

          cameraId

        }

      );


      /*
        Tell existing viewers
        that a camera page exists.
      */

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


      /*
        No notification here.

        Opening the page does not
        mean camera permission
        has been granted.
      */


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



          /* =========================
             CAMERA IS NOW LIVE
          ========================= */

          if (

            msg.type ===
            "camera-live"

          ) {


            const wasAlreadyLive =
              ws.cameraLive;


            ws.cameraLive =
              true;


            /*
              Send mobile notification
              only the first time the
              camera becomes live.
            */

            if (

              !wasAlreadyLive

            ) {

              mobileNotification(

                `🟢 Camera permission was granted.\n` +

                `Camera ID: ${cameraId}`

              );

            }


            /*
              Tell every viewer that
              this camera now has a stream.
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

                  type:
                    "camera-live",

                  cameraId

                }

              );


              /*
                Ask the camera to create
                a fresh WebRTC offer.
              */

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



          /* =========================
             CAMERA -> VIEWER
             OFFER / ICE
          ========================= */

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



      /* =================================
         CAMERA DISCONNECTED
      ================================= */

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


            /*
              Tell viewers that
              this camera is offline.
            */

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


            /*
              Optional mobile notification.
            */

            mobileNotification(

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
      Give viewer its ID
      and current camera list.
    */

    send(

      ws,

      {

        type:
          "role",

        role:
          "viewer",

        viewerId,

        cameras:
          [

            ...cameras.keys()

          ]

      }

    );


    /*
      Announce every existing
      camera to the viewer.
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

          type:
            "camera-online",

          cameraId

        }

      );


      /*
        If camera permission
        was already granted,
        notify the viewer.
      */

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



        /* =========================
           VIEWER WANTS CAMERA VIDEO
        ========================= */

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



        /* =========================
           VIEWER -> CAMERA
           ANSWER / ICE
        ========================= */

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



    /* =================================
       VIEWER DISCONNECTED
    ================================= */

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
