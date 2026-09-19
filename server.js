const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

/* =========================================
   NTFY
========================================= */

function mobileNotification(message) {

    const topic = NTFY_TOPIC.trim();

    if (!topic) {
        console.log("NTFY not configured");
        return;
    }

    const data = Buffer.from(message, "utf8");

    const req = https.request({
        hostname: "ntfy.sh",
        port: 443,
        path: "/" + encodeURIComponent(topic),
        method: "POST",

        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Length": data.length,
            "Title": "Camera Notification",
            "Priority": "high"
        }

    }, res => {

        console.log(
            "📱 ntfy status:",
            res.statusCode
        );

    });

    req.on("error", error => {

        console.error(
            "❌ ntfy error:",
            error.message
        );

    });

    req.write(data);
    req.end();
}


/* =========================================
   SEND
========================================= */

function send(ws, message) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        try {

            ws.send(
                JSON.stringify(message)
            );

            return true;

        } catch (error) {

            console.error(
                "Send error:",
                error.message
            );

        }

    }

    return false;
}


/* =========================================
   ID
========================================= */

function makeId() {

    return (
        Math.random()
            .toString(36)
            .slice(2, 10)
        +
        Date.now()
            .toString(36)
            .slice(-6)
    );

}


/* =========================================
   HTTP
========================================= */

const server =
    http.createServer((req, res) => {

        const routes = {

            "/": "camera.html",
            "/camera": "camera.html",
            "/camera.html": "camera.html",

            "/viewer": "viewer.html",
            "/viewer.html": "viewer.html"

        };

        let pathname;

        try {

            pathname =
                new URL(
                    req.url,
                    `http://${req.headers.host || "localhost"}`
                ).pathname;

        } catch {

            res.writeHead(400);

            return res.end(
                "Bad request"
            );

        }

        const file =
            routes[pathname];

        if (!file) {

            res.writeHead(404);

            return res.end(
                "Not found"
            );

        }

        fs.readFile(
            path.join(__dirname, file),
            (err, data) => {

                if (err) {

                    console.error(
                        "File error:",
                        err.message
                    );

                    res.writeHead(500);

                    return res.end(
                        "Server error"
                    );

                }

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html; charset=utf-8"
                    }
                );

                res.end(data);

            }
        );

    });


/* =========================================
   WEBSOCKET
========================================= */

const wss =
    new WebSocket.Server({
        server
    });


const cameras = new Map();
const viewers = new Map();


/* =========================================
   CONNECTION
========================================= */

wss.on(
    "connection",
    (ws, req) => {

        let pathname;

        try {

            pathname =
                new URL(
                    req.url,
                    "http://localhost"
                ).pathname;

        } catch {

            ws.close();

            return;

        }


        if (
            pathname !== "/camera" &&
            pathname !== "/viewer"
        ) {

            ws.close();

            return;

        }


        /* ===================================
           CAMERA
        =================================== */

        if (pathname === "/camera") {

            const cameraId =
                makeId();

            cameras.set(
                cameraId,
                ws
            );

            ws.cameraLive = false;

            console.log(
                "🟢 Camera connected:",
                cameraId
            );


            mobileNotification(
                `🟢 Camera connected.\nCamera ID: ${cameraId}`
            );


            send(
                ws,
                {
                    type: "role",
                    role: "camera",
                    cameraId
                }
            );


            /* Tell existing viewers */

            for (
                const viewer
                of viewers.values()
            ) {

                send(
                    viewer,
                    {
                        type: "camera-online",
                        cameraId
                    }
                );

            }


            /* ===============================
               CAMERA MESSAGES
            =============================== */

            ws.on(
                "message",
                raw => {

                    let msg;

                    try {

                        msg =
                            JSON.parse(
                                raw.toString()
                            );

                    } catch {

                        console.error(
                            "Invalid camera message"
                        );

                        return;

                    }


                    /* =========================
                       CAMERA LIVE
                    ========================= */

                    if (
                        msg.type ===
                        "camera-live"
                    ) {

                        const wasLive =
                            ws.cameraLive;

                        ws.cameraLive = true;


                        if (!wasLive) {

                            mobileNotification(
                                `🟢 Camera is LIVE.\nCamera ID: ${cameraId}`
                            );

                        }


                        for (
                            const [
                                viewerId,
                                viewer
                            ]
                            of viewers.entries()
                        ) {

                            send(
                                viewer,
                                {
                                    type:
                                        "camera-live",

                                    cameraId
                                }
                            );


                            send(
                                ws,
                                {
                                    type:
                                        "viewer-ready",

                                    viewerId
                                }
                            );

                        }

                        return;
                    }


                    /* =========================
                       CAMERA OFFLINE
                    ========================= */

                    if (
                        msg.type ===
                        "camera-offline"
                    ) {

                        console.log(
                            "Camera track offline:",
                            cameraId
                        );

                        return;
                    }


                    /* =========================
                       VIEWER OFFLINE
                    ========================= */

                    if (
                        msg.type ===
                        "viewer-offline"
                    ) {

                        console.log(
                            "Viewer offline:",
                            msg.viewerId
                        );

                        return;
                    }


                    /* =========================
                       WEBRTC TO VIEWER
                    ========================= */

                    if (
                        msg.toViewerId
                    ) {

                        const viewer =
                            viewers.get(
                                String(
                                    msg.toViewerId
                                )
                            );


                        if (!viewer) {
                            return;
                        }


                        send(
                            viewer,
                            {
                                ...msg,

                                cameraId,

                                viewerId:
                                    msg.toViewerId
                            }
                        );


                        return;
                    }

                }
            );


            /* ===============================
               CAMERA CLOSED
            =============================== */

            ws.on(
                "close",
                () => {

                    if (
                        cameras.get(cameraId)
                        !== ws
                    ) {

                        return;

                    }


                    cameras.delete(
                        cameraId
                    );


                    console.log(
                        "🔴 Camera disconnected:",
                        cameraId
                    );


                    for (
                        const viewer
                        of viewers.values()
                    ) {

                        send(
                            viewer,
                            {
                                type:
                                    "camera-offline",

                                cameraId
                            }
                        );

                    }


                    mobileNotification(
                        `🔴 Camera disconnected.\nCamera ID: ${cameraId}`
                    );

                }
            );


            ws.on(
                "error",
                error => {

                    console.error(
                        "Camera WebSocket error:",
                        error.message
                    );

                }
            );


            return;
        }


        /* ===================================
           VIEWER
        =================================== */

        const viewerId =
            makeId();

        viewers.set(
            viewerId,
            ws
        );


        console.log(
            "👁️ Viewer connected:",
            viewerId
        );


        /* ===============================
           SEND VIEWER ID
        =============================== */

        send(
            ws,
            {
                type: "role",
                role: "viewer",
                viewerId,

                cameras:
                    [...cameras.keys()]
            }
        );


        /* ===============================
           CURRENT CAMERAS
        =============================== */

        for (
            const [
                cameraId,
                camera
            ]
            of cameras.entries()
        ) {

            send(
                ws,
                {
                    type:
                        "camera-online",

                    cameraId
                }
            );


            if (
                camera.cameraLive
            ) {

                send(
                    ws,
                    {
                        type:
                            "camera-live",

                        cameraId
                    }
                );

            }

        }


        /* ===============================
           VIEWER MESSAGES
        =============================== */

        ws.on(
            "message",
            raw => {

                let msg;

                try {

                    msg =
                        JSON.parse(
                            raw.toString()
                        );

                } catch {

                    console.error(
                        "Invalid viewer message"
                    );

                    return;

                }


                /* =========================
                   VIEWER READY
                ========================= */

                if (
                    msg.type ===
                        "viewer-ready" &&
                    msg.cameraId
                ) {

                    const camera =
                        cameras.get(
                            String(
                                msg.cameraId
                            )
                        );


                    if (!camera) {

                        send(
                            ws,
                            {
                                type:
                                    "camera-offline",

                                cameraId:
                                    msg.cameraId
                            }
                        );

                        return;

                    }


                    send(
                        camera,
                        {
                            type:
                                "viewer-ready",

                            viewerId
                        }
                    );


                    return;
                }


                /* =========================
                   CAMERA SWITCH
                ========================= */

                if (
                    msg.type ===
                        "camera-switch" &&
                    msg.cameraId
                ) {

                    const camera =
                        cameras.get(
                            String(
                                msg.cameraId
                            )
                        );


                    if (!camera) {
                        return;
                    }


                    const mode =
                        msg.mode ===
                        "environment"
                            ? "environment"
                            : "user";


                    send(
                        camera,
                        {
                            type:
                                "switch-camera",

                            mode,

                            viewerId
                        }
                    );


                    return;
                }


                /* =========================
                   ANSWER / ICE
                ========================= */

                if (
                    msg.cameraId
                ) {

                    const camera =
                        cameras.get(
                            String(
                                msg.cameraId
                            )
                        );


                    if (!camera) {
                        return;
                    }


                    /*
                     * IMPORTANT:
                     *
                     * Add viewerId explicitly.
                     *
                     * The camera needs this ID
                     * to find the correct
                     * RTCPeerConnection.
                     */

                    send(
                        camera,
                        {
                            ...msg,

                            viewerId,

                            cameraId:
                                msg.cameraId
                        }
                    );


                    return;
                }

            }
        );


        /* ===============================
           VIEWER CLOSED
        =============================== */

        ws.on(
            "close",
            () => {

                if (
                    viewers.get(viewerId)
                    === ws
                ) {

                    viewers.delete(
                        viewerId
                    );

                }


                console.log(
                    "👁️ Viewer disconnected:",
                    viewerId
                );


                for (
                    const camera
                    of cameras.values()
                ) {

                    send(
                        camera,
                        {
                            type:
                                "viewer-offline",

                            viewerId
                        }
                    );

                }

            }
        );


        ws.on(
            "error",
            error => {

                console.error(
                    "Viewer WebSocket error:",
                    error.message
                );

            }
        );

    }
);


/* =========================================
   SERVER ERROR
========================================= */

server.on(
    "error",
    error => {

        console.error(
            "HTTP server error:",
            error.message
        );

    }
);


/* =========================================
   START
========================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 Server running on port ${PORT}`
        );

        console.log(
            "NTFY:",
            NTFY_TOPIC
                ? "configured"
                : "NOT CONFIGURED"
        );

    }
);
