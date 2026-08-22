const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

let camera = null;
const viewers = new Set();

const server = http.createServer((req, res) => {
  const file = req.url === "/" || req.url === "/index.html" ? "index.html" : null;

  if (!file) {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Server error");
    }
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  if (!camera) {
    camera = ws;
    ws.send(JSON.stringify({type:"role", role:"camera"}));
    console.log("Camera A connected");
  } else {
    viewers.add(ws);
    ws.send(JSON.stringify({type:"role", role:"viewer"}));
    console.log("Viewer connected");

    if (camera.readyState === WebSocket.OPEN) {
      camera.send(JSON.stringify({type:"viewer-ready"}));
    }
  }

  ws.on("message", raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (ws === camera) {
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify(message));
      }
    } else if (camera && camera.readyState === WebSocket.OPEN) {
      camera.send(JSON.stringify(message));
    }
  });

  ws.on("close", () => {
    if (ws === camera) {
      camera = null;
      console.log("Camera A disconnected");
      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN)
          viewer.send(JSON.stringify({type:"camera-offline"}));
      }
    } else {
      viewers.delete(ws);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Remote Camera server running on port ${PORT}`);
});
