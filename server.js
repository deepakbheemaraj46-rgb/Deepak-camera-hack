const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  const routes = {
    "/": "camera.html",
    "/camera": "camera.html",
    "/camera.html": "camera.html",
    "/viewer": "viewer.html",
    "/viewer.html": "viewer.html"
  };
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const file = routes[pathname];
  if (!file) { res.writeHead(404); return res.end("Not found"); }

  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(500); return res.end("Server error"); }
    res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
let camera = null;
const viewers = new Set();

wss.on("connection", (ws, req) => {
  const role = new URL(req.url, "http://localhost").pathname === "/camera" ? "camera" : "viewer";

  if (role === "camera") {
    if (camera && camera.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({type:"error", message:"Camera A is already connected."}));
      ws.close();
      return;
    }
    camera = ws;
    ws.send(JSON.stringify({type:"role", role:"camera"}));
    console.log("Camera A connected");
    for (const viewer of viewers)
      if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify({type:"camera-online"}));
  } else {
    viewers.add(ws);
    ws.send(JSON.stringify({type:"role", role:"viewer"}));
    console.log("Viewer connected");
    if (camera && camera.readyState === WebSocket.OPEN)
      camera.send(JSON.stringify({type:"viewer-ready"}));
    else
      ws.send(JSON.stringify({type:"camera-offline"}));
  }

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (role === "camera") {
      for (const viewer of viewers)
        if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify(msg));
    } else if (camera && camera.readyState === WebSocket.OPEN) {
      camera.send(JSON.stringify(msg));
    }
  });

  ws.on("close", () => {
    if (role === "camera" && ws === camera) {
      camera = null;
      console.log("Camera A disconnected");
      for (const viewer of viewers)
        if (viewer.readyState === WebSocket.OPEN) viewer.send(JSON.stringify({type:"camera-offline"}));
    } else {
      viewers.delete(ws);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Remote Camera server running on port ${PORT}`));
