const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let file = "viewer.html";

  if (req.url === "/camera.html") {
    file = "camera.html";
  } else if (req.url === "/" || req.url === "/viewer.html") {
    file = "viewer.html";
  }

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {
        "Content-Type": "text/plain"
      });
      res.end("File not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server
});

const cameras = new Set();
const viewers = new Set();

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastToViewers(message) {
  for (const viewer of viewers) {
    send(viewer, message);
  }
}

wss.on("connection", (ws, req) => {
  console.log("WebSocket connected:", req.url);

  let type = null;

  ws.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /*
      CAMERA registers itself
    */
    if (message.type === "register-camera") {
      type = "camera";
      cameras.add(ws);

      const cameraId =
        message.cameraId ||
        "camera-" + Math.random().toString(36).slice(2, 8);

      ws.cameraId = cameraId;

      console.log("Camera connected:", cameraId);

      broadcastToViewers({
        type: "camera-online",
        cameraId
      });

      return;
    }

    /*
      VIEWER registers itself
    */
    if (message.type === "register-viewer") {
      type = "viewer";
      viewers.add(ws);

      console.log("Viewer connected");

      // Tell viewer about cameras already online
      for (const camera of cameras) {
        if (camera.readyState === WebSocket.OPEN) {
          send(ws, {
            type: "camera-online",
            cameraId: camera.cameraId
          });
        }
      }

      return;
    }

    /*
      Signaling messages
      are forwarded between camera and viewer.
    */
    if (
      message.type === "offer" ||
      message.type === "answer" ||
      message.type === "ice-candidate"
    ) {
      const targetCameraId = message.cameraId;

      for (const camera of cameras) {
        if (
          camera.cameraId === targetCameraId &&
          camera.readyState === WebSocket.OPEN
        ) {
          send(camera, message);
        }
      }

      for (const viewer of viewers) {
        if (viewer !== ws && viewer.readyState === WebSocket.OPEN) {
          send(viewer, message);
        }
      }

      return;
    }
  });

  ws.on("close", () => {
    if (type === "camera") {
      cameras.delete(ws);

      console.log("Camera disconnected:", ws.cameraId);

      broadcastToViewers({
        type: "camera-offline",
        cameraId: ws.cameraId
      });
    }

    if (type === "viewer") {
      viewers.delete(ws);

      console.log("Viewer disconnected");
    }
  });

  ws.on("error", (err) => {
    console.log("WebSocket error:", err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
