const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const ROOT = __dirname;

let camera = null;
const viewers = new Map();


// =====================================================
// HTTP SERVER
// =====================================================

const server = http.createServer((req, res) => {

    let url = req.url.split("?")[0];

    if (url === "/") {
        url = "/camera.html";
    }

    const filePath = path.join(ROOT, url);

    // Prevent going outside project directory
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {

        if (err) {
            res.writeHead(404, {
                "Content-Type": "text/plain"
            });

            res.end("File not found");
            return;
        }

        let contentType = "text/html";

        if (filePath.endsWith(".js")) {
            contentType = "application/javascript";
        }

        if (filePath.endsWith(".css")) {
            contentType = "text/css";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});


// =====================================================
// WEBSOCKET SERVER
// =====================================================

const wss = new WebSocket.Server({
    server: server
});


// =====================================================
// SEND HELPER
// =====================================================

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }

}


// =====================================================
// BROADCAST CAMERA ONLINE
// =====================================================

function notifyCameraOnline() {

    if (!camera) {
        return;
    }

    for (const viewer of viewers.values()) {

        send(viewer.ws, {
            type: "camera-online",
            cameraId: camera.id
        });

    }

}


// =====================================================
// BROADCAST CAMERA OFFLINE
// =====================================================

function notifyCameraOffline() {

    for (const viewer of viewers.values()) {

        send(viewer.ws, {
            type: "camera-offline"
        });

    }

}


// =====================================================
// WEBSOCKET CONNECTION
// =====================================================

wss.on("connection", (ws) => {

    console.log("WebSocket client connected");

    let role = null;
    let id = null;


    ws.on("message", (raw) => {

        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch (err) {

            console.log("Invalid JSON received");

            return;
        }


        // =================================================
        // CAMERA REGISTER
        // =================================================

        if (msg.type === "camera-register") {

            role = "camera";

            id = msg.cameraId ||
                "camera-" +
                Math.random()
                    .toString(36)
                    .substring(2, 10);


            // Close previous camera if necessary
            if (
                camera &&
                camera.ws !== ws
            ) {

                try {
                    camera.ws.close();
                } catch (e) {}

            }


            camera = {
                ws: ws,
                id: id
            };


            console.log(
                "Camera registered:",
                id
            );


            send(ws, {
                type: "camera-registered",
                cameraId: id
            });


            notifyCameraOnline();

            return;
        }


        // =================================================
        // VIEWER REGISTER
        // =================================================

        if (msg.type === "viewer-register") {

            role = "viewer";

            id = msg.viewerId ||
                "viewer-" +
                Math.random()
                    .toString(36)
                    .substring(2, 10);


            viewers.set(id, {
                ws: ws
            });


            console.log(
                "Viewer registered:",
                id
            );


            send(ws, {
                type: "viewer-registered",
                viewerId: id
            });


            // Tell viewer whether camera is already online
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


        // =================================================
        // VIEWER REQUESTS VIDEO
        // =================================================

        if (msg.type === "start-view") {

            if (!camera) {

                send(ws, {
                    type: "camera-offline"
                });

                return;
            }


            console.log(
                "Viewer requesting camera:",
                msg.viewerId
            );


            send(camera.ws, {
                type: "start-view",
                viewerId: msg.viewerId
            });


            return;
        }


        // =================================================
        // CAMERA OFFER -> VIEWER
        // =================================================

        if (msg.type === "offer") {

            const viewer =
                viewers.get(msg.viewerId);


            if (!viewer) {

                console.log(
                    "Viewer not found for offer"
                );

                return;
            }


            send(viewer.ws, {
                type: "offer",
                cameraId: camera
                    ? camera.id
                    : msg.cameraId,
                offer: msg.offer
            });


            return;
        }


        // =================================================
        // VIEWER ANSWER -> CAMERA
        // =================================================

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


        // =================================================
        // ICE CANDIDATE
        // =================================================

        if (msg.type === "ice") {

            // Camera -> Viewer
            if (
                role === "camera" &&
                msg.viewerId
            ) {

                const viewer =
                    viewers.get(msg.viewerId);


                if (viewer) {

                    send(viewer.ws, {
                        type: "ice",
                        cameraId: camera
                            ? camera.id
                            : msg.cameraId,
                        candidate: msg.candidate
                    });

                }

                return;
            }


            // Viewer -> Camera
            if (
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

        }


        // =================================================
        // FRONT / BACK CAMERA SWITCH
        // =================================================

        if (msg.type === "switch-camera") {

            if (!camera) {
                return;
            }


            console.log(
                "Camera switch request:",
                msg.facing
            );


            send(camera.ws, {
                type: "switch-camera",
                facing: msg.facing
            });


            return;
        }

    });


    // =====================================================
    // DISCONNECT
    // =====================================================

    ws.on("close", () => {

        console.log(
            "WebSocket client disconnected:",
            role,
            id
        );


        if (
            role === "camera" &&
            camera &&
            camera.ws === ws
        ) {

            camera = null;

            notifyCameraOffline();

        }


        if (
            role === "viewer" &&
            id
        ) {

            viewers.delete(id);

        }

    });


    ws.on("error", (error) => {

        console.log(
            "WebSocket error:",
            error.message
        );

    });

});


// =====================================================
// START SERVER
// =====================================================

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Server running on port ${PORT}`
    );

});
