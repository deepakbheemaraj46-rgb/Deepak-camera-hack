const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function telegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

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

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function makeId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

const server = http.createServer((req, res) => {
  const routes = {
    "/": "index.html",
    "/camera": "camera.html",
    "/camera.html": "camera.html",
    "/viewer": "viewer.html",
    "/viewer.html": "viewer.html"
  };

  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const file = routes[pathname];

  if (!file) {
    res.writeHead(404);
    return res.end("Not found");
  }

  if (pathname === "/camera" || pathname === "/camera.html") {
    telegram("🔔 Someone opened the camera page.\nCamera permission is still required.");
  }

  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Server error");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const cameras = new Map(); // cameraId -> websocket
const viewers = new Map(); // viewerId -> websocket

wss.on("connection", (ws, req) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const role = pathname === "/camera" ? "camera" : "viewer";

  if (role === "camera") {
    const cameraId = makeId();
    cameras.set(cameraId, ws);

    send(ws, { type: "role", role: "camera", cameraId });

    for (const viewer of viewers.values()) {
      send(viewer, {
        type: "camera-online",
        cameraId
      });
    }

    telegram(`📷 Camera page connected.\nCamera ID: ${cameraId}\nThe user must still allow camera access.`);

    ws.on("message", raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "camera-live") {
        telegram(`🟢 Camera permission was granted.\nCamera ID: ${cameraId}`);
        for (const viewer of viewers.values()) {
          send(viewer, { type: "camera-live", cameraId });
        }
        return;
      }

      if (msg.toViewerId) {
        const viewer = viewers.get(msg.toViewerId);
        if (viewer) {
          send(viewer, { ...msg, cameraId });
        }
      }
    });

    ws.on("close", () => {
      if (cameras.get(cameraId) === ws) {
        cameras.delete(cameraId);
        for (const viewer of viewers.values()) {
          send(viewer, { type: "camera-offline", cameraId });
        }
        telegram(`🔴 Camera disconnected.\nCamera ID: ${cameraId}`);
      }
    });

    return;
  }

  const viewerId = makeId();
  viewers.set(viewerId, ws);

  send(ws, {
    type: "role",
    role: "viewer",
    viewerId,
    cameras: [...cameras.keys()]
  });

  for (const cameraId of cameras.keys()) {
    send(ws, { type: "camera-online", cameraId });
  }

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "viewer-ready" && msg.cameraId) {
      const camera = cameras.get(msg.cameraId);
      if (camera) {
        send(camera, {
          type: "viewer-ready",
          viewerId
        });
      }
      return;
    }

    if (msg.cameraId) {
      const camera = cameras.get(msg.cameraId);
      if (camera) {
        send(camera, {
          ...msg,
          toViewerId: viewerId
        });
      }
    }
  });

  ws.on("close", () => {
    viewers.delete(viewerId);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Multi-camera server running on port ${PORT}`);
});
