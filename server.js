const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let file = req.url === "/" ? "viewer.html" : req.url.substring(1);

  // Don't allow directory traversal
  file = path.basename(file);

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);

    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css"
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "text/plain"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on("connection", (ws) => {
  let room = null;
  let role = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "join") {
        room = data.room || "camera1";
        role = data.role;

        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }

        rooms.get(room).add(ws);

        // Tell everyone else that a peer joined
        for (const peer of rooms.get(room)) {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({
              type: "peer-joined",
              role
            }));
          }
        }

        return;
      }

      if (!room || !rooms.has(room)) return;

      // Relay signaling messages
      for (const peer of rooms.get(room)) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify(data));
        }
      }

    } catch (e) {
      console.log("WebSocket error:", e.message);
    }
  });

  ws.on("close", () => {
    if (room && rooms.has(room)) {
      rooms.get(room).delete(ws);

      for (const peer of rooms.get(room)) {
        if (peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({
            type: "peer-left"
          }));
        }
      }

      if (rooms.get(room).size === 0) {
        rooms.delete(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
