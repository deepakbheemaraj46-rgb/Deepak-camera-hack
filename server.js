const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const cameras = new Map();
const viewers = new Map();

const server = http.createServer((req, res) => {
    let file;

    // ROOT = CAMERA PAGE
    if (req.url === "/" || req.url === "/camera.html") {
        file = "camera.html";
    }

    // VIEWER PAGE
    else if (req.url === "/viewer.html") {
        file = "viewer.html";
    }

    else {
        res.writeHead(404);
        res.end("Not found");
        return;
    }

    const filePath = path.join(__dirname, file);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(err);
            res.writeHead(500);
            res.end("File error");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

wss.on("connection", (ws) => {
    console.log("WebSocket connected");

    ws.role = null;
    ws.id = null;

    ws.on("message", (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }

        // CAMERA REGISTER
        if (msg.type === "camera-register") {
            ws.role = "camera";
            ws.id = msg.cameraId;

            cameras.set(ws.id, ws);

            console.log("CAMERA ONLINE:", ws.id);

            // Tell all viewers
            for (const viewer of viewers.values()) {
                send(viewer, {
                    type: "camera-online",
                    cameraId: ws.id
                });
            }

            return;
        }

        // VIEWER REGISTER
        if (msg.type === "viewer-register") {
            ws.role = "viewer";
            ws.id = msg.viewerId;

            viewers.set(ws.id, ws);

            console.log("VIEWER ONLINE:", ws.id);

            // Tell viewer about all cameras
            for (const cameraId of cameras.keys()) {
                send(ws, {
                    type: "camera-online",
                    cameraId
                });
            }

            return;
        }

        // VIEWER REQUESTS VIDEO
        if (msg.type === "start-view") {
            const camera = cameras.get(msg.cameraId);

            if (!camera) {
                send(ws, {
                    type: "camera-offline"
                });
                return;
            }

            send(camera, {
                type: "start-view",
                viewerId: msg.viewerId
            });

            return;
        }

        // VIEWER WANTS FRONT/BACK
        if (msg.type === "switch-camera") {
            const camera = cameras.get(msg.cameraId);

            if (!camera) return;

            send(camera, {
                type: "switch-camera",
                viewerId: msg.viewerId,
                facing: msg.facing
            });

            return;
        }

        // CAMERA OFFER -> VIEWER
        if (msg.type === "offer") {
            const viewer = viewers.get(msg.viewerId);

            if (!viewer) return;

            send(viewer, {
                type: "offer",
                cameraId: msg.cameraId,
                offer: msg.offer
            });

            return;
        }

        // VIEWER ANSWER -> CAMERA
        if (msg.type === "answer") {
            const camera = cameras.get(msg.cameraId);

            if (!camera) return;

            send(camera, {
                type: "answer",
                viewerId: msg.viewerId,
                answer: msg.answer
            });

            return;
        }

        // ICE
        if (msg.type === "ice") {

            // CAMERA -> VIEWER
            if (ws.role === "camera") {
                const viewer = viewers.get(msg.viewerId);

                if (!viewer) return;

                send(viewer, {
                    type: "ice",
                    cameraId: msg.cameraId,
                    candidate: msg.candidate
                });
            }

            // VIEWER -> CAMERA
            else if (ws.role === "viewer") {
                const camera = cameras.get(msg.cameraId);

                if (!camera) return;

                send(camera, {
                    type: "ice",
                    viewerId: msg.viewerId,
                    candidate: msg.candidate
                });
            }

            return;
        }
    });

    ws.on("close", () => {

        if (ws.role === "camera") {
            cameras.delete(ws.id);

            console.log("CAMERA OFFLINE:", ws.id);

            for (const viewer of viewers.values()) {
                send(viewer, {
                    type: "camera-offline",
                    cameraId: ws.id
                });
            }
        }

        if (ws.role === "viewer") {
            viewers.delete(ws.id);

            console.log("VIEWER OFFLINE:", ws.id);
        }
    });
});

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
