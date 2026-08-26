const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let file;

  if (req.url === "/camera.html") {
    file = "camera.html";
  } else if (req.url === "/viewer.html" || req.url === "/") {
    file = "viewer.html";
  } else {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("File not found");
      return;
    }

    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "text/plain";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const cameras = new Map();
const viewers = new Set();

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws, req) => {

  console.log("WebSocket:", req.url);

  ws.role = null;
  ws.cameraId = null;

  ws.on("message", (raw) => {

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.log("Invalid JSON");
      return;
    }

    /*
    ==========================
    CAMERA REGISTER
    ==========================
    */

    if (msg.type === "register-camera") {

      ws.role = "camera";

      const cameraId =
        msg.cameraId ||
        "camera-" + Math.random().toString(36).slice(2, 8);

      ws.cameraId = cameraId;

      cameras.set(cameraId, ws);

      console.log("CAMERA ONLINE:", cameraId);

      // Tell every viewer
      for (const viewer of viewers) {
        send(viewer, {
          type: "camera-online",
          cameraId: cameraId
        });
      }

      return;
    }

    /*
    ==========================
    VIEWER REGISTER
    ==========================
    */

    if (msg.type === "register-viewer") {

      ws.role = "viewer";

      viewers.add(ws);

      console.log("VIEWER ONLINE");

      // Send all currently connected cameras
      for (const cameraId of cameras.keys()) {

        send(ws, {
          type: "camera-online",
          cameraId: cameraId
        });

      }

      return;
    }

    /*
    ==========================
    VIEWER REQUESTS CAMERA
    ==========================
    */

    if (msg.type === "viewer-request") {

      const camera = cameras.get(msg.cameraId);

      if (!camera) {

        console.log(
          "Camera not found:",
          msg.cameraId
        );

        send(ws, {
          type: "camera-error",
          cameraId: msg.cameraId,
          message: "Camera is offline"
        });

        return;
      }

      console.log(
        "VIEWER REQUEST -> CAMERA:",
        msg.cameraId
      );

      send(camera, {
        type: "viewer-request",
        cameraId: msg.cameraId
      });

      return;
    }

    /*
    ==========================
    WEBRTC SIGNALING
    ==========================
    */

    if (
      msg.type === "offer" ||
      msg.type === "answer" ||
      msg.type === "ice-candidate"
    ) {

      const camera = cameras.get(msg.cameraId);

      if (!camera) {
        console.log(
          "Signaling camera not found:",
          msg.cameraId
        );
        return;
      }

      /*
      OFFER:
      camera -> all viewers

      ANSWER:
      viewer -> camera

      ICE:
      forwarded to the other side
      */

      if (msg.type === "offer") {

        console.log(
          "OFFER from camera:",
          msg.cameraId
        );

        for (const viewer of viewers) {

          send(viewer, {
            ...msg
          });

        }

        return;
      }

      if (msg.type === "answer") {

        console.log(
          "ANSWER from viewer:",
          msg.cameraId
        );

        send(camera, {
          ...msg
        });

        return;
      }

      if (msg.type === "ice-candidate") {

        /*
        If message came from camera,
        send to viewers.

        If message came from viewer,
        send to camera.
        */

        if (ws.role === "camera") {

          for (const viewer of viewers) {

            send(viewer, {
              ...msg
            });

          }

        } else if (ws.role === "viewer") {

          send(camera, {
            ...msg
          });

        }

        return;
      }
    }

  });

  ws.on("close", () => {

    if (ws.role === "camera") {

      cameras.delete(ws.cameraId);

      console.log(
        "CAMERA OFFLINE:",
        ws.cameraId
      );

      for (const viewer of viewers) {

        send(viewer, {
          type: "camera-offline",
          cameraId: ws.cameraId
        });

      }

    }

    if (ws.role === "viewer") {

      viewers.delete(ws);

      console.log("VIEWER OFFLINE");

    }

  });

  ws.on("error", (err) => {

    console.log(
      "WebSocket error:",
      err.message
    );

  });

});

server.listen(PORT, () => {

  console.log(
    "Server running on port:",
    PORT
  );

});
