const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    let url = req.url.split("?")[0];

    if (url === "/") {
        url = "/camera.html";
    }

    const filePath = path.join(__dirname, url);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end("Not found");
        }

        let type = "text/html";

        if (filePath.endsWith(".js")) {
            type = "application/javascript";
        }

        if (filePath.endsWith(".css")) {
            type = "text/css";
        }

        res.writeHead(200, {
            "Content-Type": type
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({
    server
});

let camera = null;
const viewers = new Map();

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

wss.on("connection", (ws) => {

    let role = null;
    let id = null;

    console.log("WebSocket connected");

    ws.on("message", (raw) => {

        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }

        console.log(
            "MESSAGE:",
            msg.type
        );


        // ============================================
        // CAMERA
        // ============================================

        if (msg.type === "camera-register") {

            role = "camera";

            id =
                msg.cameraId ||
                "camera-" +
                Math.random()
                    .toString(36)
                    .slice(2);

            camera = {
                ws,
                id
            };

            console.log(
                "CAMERA ONLINE:",
                id
            );

            send(ws, {
                type: "camera-registered",
                cameraId: id
            });

            for (const viewer of viewers.values()) {
                send(viewer.ws, {
                    type: "camera-online",
                    cameraId: id
                });
            }

            return;
        }


        // ============================================
        // VIEWER
        // ============================================

        if (msg.type === "viewer-register") {

            role = "viewer";

            id =
                msg.viewerId ||
                "viewer-" +
                Math.random()
                    .toString(36)
                    .slice(2);

            viewers.set(id, {
                ws
            });

            console.log(
                "VIEWER ONLINE:",
                id
            );

            send(ws, {
                type: "viewer-registered",
                viewerId: id
            });

            if (camera) {
                send(ws, {
                    type: "camera-online",
                    cameraId: camera.id
                });
            } else {
                send(ws, {
                    type: "camera-offline"
                });
            }

            return;
        }


        // ============================================
        // VIEWER REQUESTS STREAM
        // ============================================

        if (msg.type === "start-view") {

            if (!camera) {
                send(ws, {
                    type: "camera-offline"
                });
                return;
            }

            send(camera.ws, {
                type: "start-view",
                viewerId: msg.viewerId
            });

            return;
        }


        // ============================================
        // CAMERA OFFER -> VIEWER
        // ============================================

        if (msg.type === "offer") {

            const viewer =
                viewers.get(msg.viewerId);

            if (!viewer) {
                console.log(
                    "Viewer not found:",
                    msg.viewerId
                );
                return;
            }

            send(viewer.ws, {
                type: "offer",
                cameraId: camera
                    ? camera.id
                    : null,
                offer: msg.offer
            });

            return;
        }


        // ============================================
        // VIEWER ANSWER -> CAMERA
        // ============================================

        if (msg.type === "answer") {

            if (!camera) {
                return;
            }

            send(camera.ws, {
                type: "answer",
                viewerId: msg.viewerId,
                answer: msg.answer
            });

            return;
        }


        // ============================================
        // ICE CAMERA -> VIEWER
        // ============================================

        if (
            msg.type === "ice" &&
            role === "camera"
        ) {

            const viewer =
                viewers.get(msg.viewerId);

            if (viewer) {

                send(viewer.ws, {
                    type: "ice",
                    candidate: msg.candidate
                });

            }

            return;
        }


        // ============================================
        // ICE VIEWER -> CAMERA
        // ============================================

        if (
            msg.type === "ice" &&
            role === "viewer"
        ) {

            if (camera) {

                send(camera.ws, {
                    type: "ice",
                    viewerId: id,
                    candidate: msg.candidate
                });

            }

            return;
        }

    });


    // ================================================
    // DISCONNECT
    // ================================================

    ws.on("close", () => {

        console.log(
            "Disconnected:",
            role,
            id
        );

        if (
            role === "camera" &&
            camera &&
            camera.ws === ws
        ) {

            camera = null;

            for (const viewer of viewers.values()) {
                send(viewer.ws, {
                    type: "camera-offline"
                });
            }
        }

        if (
            role === "viewer" &&
            id
        ) {
            viewers.delete(id);
        }
    });


    ws.on("error", (err) => {
        console.log(
            "WebSocket error:",
            err.message
        );
    });

});

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "Server running on port",
            PORT
        );
    }
);
