const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const cameras = new Map();
const viewers = new Map();


/*
==================================================
HTTP SERVER
==================================================
*/

const server = http.createServer((req, res) => {

    let file;

    /*
    ROOT LINK:
    https://x-video.onrender.com
    opens camera.html
    */

    if (
        req.url === "/" ||
        req.url === "/camera.html"
    ) {
        file = "camera.html";
    }

    /*
    VIEWER:
    https://x-video.onrender.com/viewer.html
    */

    else if (req.url === "/viewer.html") {
        file = "viewer.html";
    }

    else {
        res.writeHead(404, {
            "Content-Type": "text/plain"
        });

        res.end("Not found");
        return;
    }


    const filePath =
        path.join(__dirname, file);


    fs.readFile(filePath, (err, data) => {

        if (err) {

            console.error(
                "File error:",
                err
            );

            res.writeHead(500, {
                "Content-Type": "text/plain"
            });

            res.end("Server error");
            return;
        }


        res.writeHead(200, {
            "Content-Type":
                "text/html; charset=utf-8",

            "Cache-Control":
                "no-store, no-cache, must-revalidate"
        });

        res.end(data);

    });

});


/*
==================================================
WEBSOCKET SERVER
==================================================
*/

const wss =
    new WebSocket.Server({
        server
    });


/*
==================================================
SEND HELPER
==================================================
*/

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );

    }

}


/*
==================================================
WEBSOCKET CONNECTION
==================================================
*/

wss.on("connection", (ws) => {

    console.log(
        "WebSocket connected"
    );


    ws.role = null;
    ws.cameraId = null;
    ws.viewerId = null;


    /*
    ==============================================
    MESSAGE
    ==============================================
    */

    ws.on("message", (raw) => {

        let msg;

        try {

            msg =
                JSON.parse(
                    raw.toString()
                );

        }
        catch (error) {

            console.log(
                "Invalid JSON"
            );

            return;
        }


        /*
        ==========================================
        CAMERA REGISTER
        ==========================================
        */

        if (
            msg.type ===
            "register-camera"
        ) {

            ws.role = "camera";


            ws.cameraId =
                msg.cameraId ||
                (
                    "camera-" +
                    Math.random()
                        .toString(36)
                        .substring(2, 9)
                );


            cameras.set(
                ws.cameraId,
                ws
            );


            console.log(
                "CAMERA ONLINE:",
                ws.cameraId
            );


            /*
            Tell all viewers
            */

            for (
                const viewer
                of viewers.values()
            ) {

                send(viewer, {

                    type:
                        "camera-online",

                    cameraId:
                        ws.cameraId

                });

            }


            return;
        }


        /*
        ==========================================
        VIEWER REGISTER
        ==========================================
        */

        if (
            msg.type ===
            "register-viewer"
        ) {

            ws.role = "viewer";


            ws.viewerId =
                msg.viewerId ||
                (
                    "viewer-" +
                    Math.random()
                        .toString(36)
                        .substring(2, 9)
                );


            viewers.set(
                ws.viewerId,
                ws
            );


            console.log(
                "VIEWER ONLINE:",
                ws.viewerId
            );


            /*
            Send existing cameras
            */

            for (
                const cameraId
                of cameras.keys()
            ) {

                send(ws, {

                    type:
                        "camera-online",

                    cameraId:
                        cameraId

                });

            }


            return;
        }


        /*
        ==========================================
        VIEWER REQUESTS CAMERA
        ==========================================
        */

        if (
            msg.type ===
            "viewer-request"
        ) {

            const camera =
                cameras.get(
                    msg.cameraId
                );


            if (!camera) {

                send(ws, {

                    type:
                        "camera-error",

                    cameraId:
                        msg.cameraId,

                    message:
                        "Camera is offline"

                });

                return;
            }


            console.log(
                "VIEWER REQUEST:",
                msg.viewerId,
                "->",
                msg.cameraId
            );


            send(camera, {

                type:
                    "viewer-request",

                cameraId:
                    msg.cameraId,

                viewerId:
                    msg.viewerId

            });


            return;
        }


        /*
        ==========================================
        CAMERA OFFER -> VIEWER
        ==========================================
        */

        if (
            msg.type ===
            "offer"
        ) {

            const viewer =
                viewers.get(
                    msg.viewerId
                );


            if (!viewer) {
                return;
            }


            send(viewer, {

                type:
                    "offer",

                cameraId:
                    msg.cameraId,

                viewerId:
                    msg.viewerId,

                offer:
                    msg.offer,

                frontStreamId:
                    msg.frontStreamId,

                backStreamId:
                    msg.backStreamId

            });


            return;
        }


        /*
        ==========================================
        VIEWER ANSWER -> CAMERA
        ==========================================
        */

        if (
            msg.type ===
            "answer"
        ) {

            const camera =
                cameras.get(
                    msg.cameraId
                );


            if (!camera) {
                return;
            }


            send(camera, {

                type:
                    "answer",

                cameraId:
                    msg.cameraId,

                viewerId:
                    msg.viewerId,

                answer:
                    msg.answer

            });


            return;
        }


        /*
        ==========================================
        ICE CANDIDATE
        ==========================================
        */

        if (
            msg.type ===
            "ice-candidate"
        ) {


            /*
            CAMERA -> VIEWER
            */

            if (
                ws.role ===
                "camera"
            ) {

                const viewer =
                    viewers.get(
                        msg.viewerId
                    );


                if (!viewer) {
                    return;
                }


                send(viewer, {

                    type:
                        "ice-candidate",

                    cameraId:
                        msg.cameraId,

                    viewerId:
                        msg.viewerId,

                    candidate:
                        msg.candidate

                });

            }


            /*
            VIEWER -> CAMERA
            */

            else if (
                ws.role ===
                "viewer"
            ) {

                const camera =
                    cameras.get(
                        msg.cameraId
                    );


                if (!camera) {
                    return;
                }


                send(camera, {

                    type:
                        "ice-candidate",

                    cameraId:
                        msg.cameraId,

                    viewerId:
                        msg.viewerId,

                    candidate:
                        msg.candidate

                });

            }


            return;
        }

    });


    /*
    ==============================================
    DISCONNECT
    ==============================================
    */

    ws.on("close", () => {


        /*
        CAMERA LEFT
        */

        if (
            ws.role ===
            "camera"
        ) {

            cameras.delete(
                ws.cameraId
            );


            console.log(
                "CAMERA OFFLINE:",
                ws.cameraId
            );


            for (
                const viewer
                of viewers.values()
            ) {

                send(viewer, {

                    type:
                        "camera-offline",

                    cameraId:
                        ws.cameraId

                });

            }

        }


        /*
        VIEWER LEFT
        */

        if (
            ws.role ===
            "viewer"
        ) {

            viewers.delete(
                ws.viewerId
            );


            console.log(
                "VIEWER OFFLINE:",
                ws.viewerId
            );


            /*
            Tell all cameras
            */

            for (
                const camera
                of cameras.values()
            ) {

                send(camera, {

                    type:
                        "viewer-offline",

                    viewerId:
                        ws.viewerId

                });

            }

        }

    });


    ws.on("error", (error) => {

        console.log(
            "WebSocket error:",
            error.message
        );

    });

});


/*
==================================================
START
==================================================
*/

server.listen(
    PORT,
    () => {

        console.log(
            "Server running on port:",
            PORT
        );

    }
);
