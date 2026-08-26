const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const cameras = new Map();
const viewers = new Map();

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
        } catch (err) {
            console.error("Send error:", err.message);
        }
    }
}

const server = http.createServer((req, res) => {

    let filename;

    if (req.url === "/" || req.url === "/camera.html") {
        filename = "camera.html";
    }

    else if (req.url === "/viewer.html") {
        filename = "viewer.html";
    }

    else {
        res.writeHead(404, {
            "Content-Type": "text/plain"
        });

        res.end("Not found");
        return;
    }

    const filePath = path.join(__dirname, filename);

    fs.readFile(filePath, (err, data) => {

        if (err) {

            console.error(
                "File error:",
                err.message
            );

            res.writeHead(500);
            res.end("Server file error");

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

wss.on("connection", (ws) => {

    console.log("WebSocket connected");

    ws.role = null;
    ws.id = null;

    ws.on("message", (raw) => {

        let msg;

        try {
            msg = JSON.parse(raw.toString());
        }

        catch {
            console.log("Invalid JSON");
            return;
        }

        /*
        ==========================================
        CAMERA REGISTER
        ==========================================
        */

        if (msg.type === "camera-register") {

            ws.role = "camera";
            ws.id = msg.cameraId;

            cameras.set(
                ws.id,
                ws
            );

            console.log(
                "CAMERA ONLINE:",
                ws.id
            );

            /*
            Tell every viewer
            */

            for (const viewer of viewers.values()) {

                send(viewer, {
                    type: "camera-online",
                    cameraId: ws.id
                });

            }

            return;
        }


        /*
        ==========================================
        VIEWER REGISTER
        ==========================================
        */

        if (msg.type === "viewer-register") {

            ws.role = "viewer";
            ws.id = msg.viewerId;

            viewers.set(
                ws.id,
                ws
            );

            console.log(
                "VIEWER ONLINE:",
                ws.id
            );

            /*
            Send all currently online cameras
            */

            for (
                const cameraId
                of cameras.keys()
            ) {

                send(ws, {
                    type: "camera-online",
                    cameraId: cameraId
                });

            }

            return;
        }


        /*
        ==========================================
        VIEWER -> CAMERA
        START VIEW
        ==========================================
        */

        if (msg.type === "start-view") {

            const camera =
                cameras.get(
                    msg.cameraId
                );

            if (!camera) {

                send(ws, {
                    type: "camera-offline",
                    cameraId: msg.cameraId
                });

                return;
            }

            send(camera, {
                type: "start-view",
                viewerId: msg.viewerId
            });

            return;
        }


        /*
        ==========================================
        VIEWER -> CAMERA
        FRONT / BACK
        ==========================================
        */

        if (msg.type === "switch-camera") {

            const camera =
                cameras.get(
                    msg.cameraId
                );

            if (!camera) {
                return;
            }

            send(camera, {
                type: "switch-camera",
                viewerId: msg.viewerId,
                facing: msg.facing
            });

            return;
        }


        /*
        ==========================================
        CAMERA -> VIEWER
        OFFER
        ==========================================
        */

        if (msg.type === "offer") {

            const viewer =
                viewers.get(
                    msg.viewerId
                );

            if (!viewer) {
                console.log(
                    "Viewer not found:",
                    msg.viewerId
                );

                return;
            }

            send(viewer, {
                type: "offer",
                cameraId: msg.cameraId,
                viewerId: msg.viewerId,
                offer: msg.offer
            });

            return;
        }


        /*
        ==========================================
        VIEWER -> CAMERA
        ANSWER
        ==========================================
        */

        if (msg.type === "answer") {

            const camera =
                cameras.get(
                    msg.cameraId
                );

            if (!camera) {
                return;
            }

            send(camera, {
                type: "answer",
                cameraId: msg.cameraId,
                viewerId: msg.viewerId,
                answer: msg.answer
            });

            return;
        }


        /*
        ==========================================
        ICE CANDIDATE
        ==========================================
        */

        if (msg.type === "ice") {

            /*
            CAMERA -> VIEWER
            */

            if (ws.role === "camera") {

                const viewer =
                    viewers.get(
                        msg.viewerId
                    );

                if (!viewer) {
                    return;
                }

                send(viewer, {
                    type: "ice",
                    cameraId: msg.cameraId,
                    viewerId: msg.viewerId,
                    candidate: msg.candidate
                });

                return;
            }


            /*
            VIEWER -> CAMERA
            */

            if (ws.role === "viewer") {

                const camera =
                    cameras.get(
                        msg.cameraId
                    );

                if (!camera) {
                    return;
                }

                send(camera, {
                    type: "ice",
                    cameraId: msg.cameraId,
                    viewerId: msg.viewerId,
                    candidate: msg.candidate
                });

                return;
            }
        }

    });


    /*
    ==========================================
    CONNECTION CLOSED
    ==========================================
    */

    ws.on("close", () => {

        if (ws.role === "
