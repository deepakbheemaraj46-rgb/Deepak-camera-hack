"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

const CAMERA_FILE = path.join(__dirname, "camera.html");
const VIEWER_FILE = path.join(__dirname, "viewer.html");


/* =========================================================
   NTFY
========================================================= */

function mobileNotification(message) {
    if (!NTFY_TOPIC) {
        return;
    }

    const data = Buffer.from(message, "utf8");

    const request = https.request(
        {
            hostname: "ntfy.sh",

            path: "/" + encodeURIComponent(NTFY_TOPIC),

            method: "POST",

            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Length": data.length,
                "Title": "Camera Notification",
                "Priority": "high"
            }
        },
        response => {
            response.on("data", () => {});
            response.on("end", () => {});
        }
    );

    request.on("error", error => {
        console.error("NTFY error:", error.message);
    });

    request.write(data);
    request.end();
}


/* =========================================================
   ID
========================================================= */

function makeId(prefix) {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
            .toString(36)
            .substring(2, 10)
    );
}


/* =========================================================
   SEND
========================================================= */

function send(ws, message) {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {
        return false;
    }

    try {
        ws.send(JSON.stringify(message));
        return true;

    } catch (error) {
        console.error(
            "WebSocket send error:",
            error.message
        );

        return false;
    }
}


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(collection, message) {

    for (const ws of collection.values()) {
        send(ws, message);
    }
}


/* =========================================================
   CONNECTION MAPS
========================================================= */

const cameras = new Map();
const viewers = new Map();


/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {

    let url;

    try {
        url = new URL(
            req.url,
            `http://${req.headers.host}`
        );

    } catch {
        res.writeHead(400);
        res.end("Bad Request");
        return;
    }


    /* CAMERA */

    if (
        url.pathname === "/" ||
        url.pathname === "/camera" ||
        url.pathname === "/camera.html"
    ) {
        serveFile(CAMERA_FILE, res);
        return;
    }


    /* VIEWER */

    if (
        url.pathname === "/viewer" ||
        url.pathname === "/viewer.html"
    ) {
        serveFile(VIEWER_FILE, res);
        return;
    }


    /* HEALTH */

    if (url.pathname === "/health") {

        res.writeHead(
            200,
            {
                "Content-Type":
                    "application/json",

                "Cache-Control":
                    "no-store"
            }
        );

        res.end(
            JSON.stringify({
                status: "ok",
                cameras: cameras.size,
                viewers: viewers.size
            })
        );

        return;
    }


    res.writeHead(
        404,
        {
            "Content-Type":
                "text/plain"
        }
    );

    res.end("Not Found");
});


/* =========================================================
   SERVE FILE
========================================================= */

function serveFile(file, res) {

    fs.readFile(
        file,
        (error, data) => {

            if (error) {

                console.error(
                    "File error:",
                    error
                );

                res.writeHead(
                    500,
                    {
                        "Content-Type":
                            "text/plain"
                    }
                );

                res.end("Server error");

                return;
            }

            res.writeHead(
                200,
                {
                    "Content-Type":
                        "text/html; charset=utf-8",

                    "Cache-Control":
                        "no-store"
                }
            );

            res.end(data);
        }
    );
}


/* =========================================================
   WEBSOCKET SERVER
========================================================= */

const wss =
    new WebSocket.Server({
        server,
        maxPayload: 1024 * 1024
    });


/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

wss.on(
    "connection",
    (ws, request) => {

        let url;

        try {

            url = new URL(
                request.url,
                `http://${request.headers.host}`
            );

        } catch {

            ws.close(
                1008,
                "Invalid request"
            );

            return;
        }


        const route =
            url.pathname;


        console.log(
            "WebSocket connected:",
            route
        );


        if (route === "/camera") {
            handleCamera(ws);
            return;
        }


        if (route === "/viewer") {
            handleViewer(ws);
            return;
        }


        ws.close(
            1008,
            "Invalid route"
        );
    }
);


/* =========================================================
   CAMERA
========================================================= */

function handleCamera(ws) {

    const cameraId =
        makeId("camera");


    cameras.set(
        cameraId,
        ws
    );


    ws.cameraId =
        cameraId;

    ws.cameraLive =
        false;


    console.log(
        "Camera connected:",
        cameraId
    );


    /* Give camera its ID */

    send(
        ws,
        {
            type: "role",
            role: "camera",
            cameraId: cameraId
        }
    );


    mobileNotification(
        "Camera connected: " +
        cameraId
    );


    /* Tell viewers */

    broadcast(
        viewers,
        {
            type: "camera-online",
            cameraId: cameraId
        }
    );


    ws.on(
        "message",
        raw => {
            handleCameraMessage(
                ws,
                raw
            );
        }
    );


    ws.on(
        "close",
        () => {
            removeCamera(ws);
        }
    );


    ws.on(
        "error",
        error => {
            console.error(
                "Camera socket error:",
                error.message
            );
        }
    );
}


/* =========================================================
   CAMERA MESSAGE
========================================================= */

function handleCameraMessage(ws, raw) {

    let msg;

    try {

        msg = JSON.parse(
            raw.toString()
        );

    } catch {

        console.log(
            "Invalid camera JSON"
        );

        return;
    }


    const cameraId =
        ws.cameraId;


    if (!cameraId) {
        return;
    }


    /* =====================================================
       CAMERA LIVE
    ===================================================== */

    if (
        msg.type === "camera-live"
    ) {

        ws.cameraLive =
            true;


        console.log(
            "Camera is LIVE:",
            cameraId
        );


        /*
         * Tell every connected viewer
         * that the camera is live.
         */

        broadcast(
            viewers,
            {
                type: "camera-live",
                cameraId: cameraId
            }
        );


        /*
         * AUTOMATIC WEBRTC START
         *
         * Tell every existing viewer
         * to start WebRTC with this camera.
         */

        for (
            const viewerId of viewers.keys()
        ) {

            send(
                ws,
                {
                    type: "viewer-ready",
                    viewerId: viewerId
                }
            );

            console.log(
                "AUTO viewer-ready:",
                cameraId,
                "->",
                viewerId
            );
        }


        return;
    }


    /* =====================================================
       CAMERA OFFER -> VIEWER
    ===================================================== */

    if (
        msg.type === "offer"
    ) {

        const viewerId =
            String(
                msg.viewerId ||
                msg.toViewerId ||
                ""
            );


        if (
            !viewerId ||
            !msg.offer
        ) {

            console.log(
                "Invalid camera offer"
            );

            return;
        }


        const viewer =
            viewers.get(
                viewerId
            );


        if (!viewer) {

            console.log(
                "Viewer not found:",
                viewerId
            );

            return;
        }


        console.log(
            "Offer:",
            cameraId,
            "->",
            viewerId
        );


        send(
            viewer,
            {
                type: "offer",
                cameraId: cameraId,
                offer: msg.offer
            }
        );


        return;
    }


    /* =====================================================
       CAMERA ICE -> VIEWER
    ===================================================== */

    if (
        msg.type === "candidate"
    ) {

        const viewerId =
            String(
                msg.viewerId ||
                msg.toViewerId ||
                ""
            );


        if (
            !viewerId ||
            !msg.candidate
        ) {
            return;
        }


        const viewer =
            viewers.get(
                viewerId
            );


        if (!viewer) {
            return;
        }


        send(
            viewer,
            {
                type: "candidate",
                cameraId: cameraId,
                candidate: msg.candidate
            }
        );


        return;
    }
}


/* =========================================================
   CAMERA DISCONNECT
========================================================= */

function removeCamera(ws) {

    const cameraId =
        ws.cameraId;


    if (!cameraId) {
        return;
    }


    if (
        cameras.get(cameraId) === ws
    ) {

        cameras.delete(
            cameraId
        );
    }


    console.log(
        "Camera disconnected:",
        cameraId
    );


    broadcast(
        viewers,
        {
            type: "camera-offline",
            cameraId: cameraId
        }
    );


    mobileNotification(
        "Camera disconnected: " +
        cameraId
    );
}


/* =========================================================
   VIEWER
========================================================= */

function handleViewer(ws) {

    const viewerId =
        makeId("viewer");


    viewers.set(
        viewerId,
        ws
    );


    ws.viewerId =
        viewerId;


    console.log(
        "Viewer connected:",
        viewerId
    );


    /* Send viewer information */

    send(
        ws,
        {
            type: "role",
            role: "viewer",
            viewerId: viewerId,

            cameras:
                Array.from(
                    cameras.keys()
                )
        }
    );


    /*
     * Send existing cameras.
     */

    for (
        const [
            cameraId,
            camera
        ]
        of cameras
    ) {

        /* Tell viewer camera exists */

        send(
            ws,
            {
                type: "camera-online",
                cameraId: cameraId
            }
        );


        /*
         * If camera is already LIVE,
         * automatically start WebRTC.
         */

        if (
            camera.cameraLive
        ) {

            send(
                ws,
                {
                    type: "camera-live",
                    cameraId: cameraId
                }
            );


            /*
             * THIS IS THE IMPORTANT PART.
             *
             * No manual viewer-ready is required.
             */

            send(
                camera,
                {
                    type: "viewer-ready",
                    viewerId: viewerId
                }
            );


            console.log(
                "AUTO START:",
                cameraId,
                "->",
                viewerId
            );
        }
    }


    ws.on(
        "message",
        raw => {

            handleViewerMessage(
                ws,
                raw
            );
        }
    );


    ws.on(
        "close",
        () => {
            removeViewer(ws);
        }
    );


    ws.on(
        "error",
        error => {

            console.error(
                "Viewer socket error:",
                error.message
            );
        }
    );
}


/* =========================================================
   VIEWER MESSAGE
========================================================= */

function handleViewerMessage(ws, raw) {

    let msg;

    try {

        msg = JSON.parse(
            raw.toString()
        );

    } catch {

        console.log(
            "Invalid viewer JSON"
        );

        return;
    }


    const viewerId =
        ws.viewerId;


    if (!viewerId) {
        return;
    }


    /* =====================================================
       VIEWER READY

       Kept as a backup in case viewer.html
       still sends viewer-ready.
    ===================================================== */

    if (
        msg.type === "viewer-ready"
    ) {

        if (!msg.cameraId) {

            for (
                const [
                    cameraId,
                    camera
                ]
                of cameras
            ) {

                if (
                    camera.cameraLive
                ) {

                    send(
                        camera,
                        {
                            type:
                                "viewer-ready",

                            viewerId:
                                viewerId
                        }
                    );
                }
            }


            return;
        }


        const camera =
            cameras.get(
                String(
                    msg.cameraId
                )
            );


        if (!camera) {

            console.log(
                "Camera not found:",
                msg.cameraId
            );

            return;
        }


        send(
            camera,
            {
                type:
                    "viewer-ready",

                viewerId:
                    viewerId
            }
        );


        return;
    }


    /* =====================================================
       ANSWER VIEWER -> CAMERA
    ===================================================== */

    if (
        msg.type === "answer"
    ) {

        if (
            !msg.cameraId ||
            !msg.answer
        ) {

            console.log(
                "Invalid viewer answer"
            );

            return;
        }


        const camera =
            cameras.get(
                String(
                    msg.cameraId
                )
            );


        if (!camera) {
            return;
        }


        console.log(
            "Answer:",
            viewerId,
            "->",
            msg.cameraId
        );


        send(
            camera,
            {
                type:
                    "answer",

                viewerId:
                    viewerId,

                cameraId:
                    msg.cameraId,

                answer:
                    msg.answer
            }
        );


        return;
    }


    /* =====================================================
       ICE VIEWER -> CAMERA
    ===================================================== */

    if (
        msg.type === "candidate"
    ) {

        if (
            !msg.cameraId ||
            !msg.candidate
        ) {
            return;
        }


        const camera =
            cameras.get(
                String(
                    msg.cameraId
                )
            );


        if (!camera) {
            return;
        }


        send(
            camera,
            {
                type:
                    "candidate",

                viewerId:
                    viewerId,

                cameraId:
                    msg.cameraId,

                candidate:
                    msg.candidate
            }
        );


        return;
    }
}


/* =========================================================
   VIEWER DISCONNECT
========================================================= */

function removeViewer(ws) {

    const viewerId =
        ws.viewerId;


    if (!viewerId) {
        return;
    }


    if (
        viewers.get(viewerId) === ws
    ) {

        viewers.delete(
            viewerId
        );
    }


    console.log(
        "Viewer disconnected:",
        viewerId
    );


    /*
     * Tell all cameras to close
     * the WebRTC connection for
     * this viewer.
     */

    for (
        const camera
        of cameras.values()
    ) {

        send(
            camera,
            {
                type:
                    "viewer-offline",

                viewerId:
                    viewerId
            }
        );
    }
}


/* =========================================================
   CLEAN CLOSED SOCKETS
========================================================= */

setInterval(
    () => {

        for (
            const [
                cameraId,
                ws
            ]
            of cameras
        ) {

            if (
                ws.readyState === WebSocket.CLOSED ||
                ws.readyState === WebSocket.CLOSING
            ) {

                removeCamera(ws);
            }
        }


        for (
            const [
                viewerId,
                ws
            ]
            of viewers
        ) {

            if (
                ws.readyState === WebSocket.CLOSED ||
                ws.readyState === WebSocket.CLOSING
            ) {

                removeViewer(ws);
            }
        }

    },
    30000
);


/* =========================================================
   SERVER ERROR
========================================================= */

server.on(
    "error",
    error => {

        console.error(
            "SERVER ERROR:",
            error
        );
    }
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "Camera server started"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Camera: /camera"
        );

        console.log(
            "Viewer: /viewer"
        );

        console.log(
            "Health: /health"
        );

        console.log(
            "WebSocket camera: /camera"
        );

        console.log(
            "WebSocket viewer: /viewer"
        );

        console.log(
            "NTFY:",
            NTFY_TOPIC
                ? "Enabled"
                : "Disabled"
        );

        console.log(
            "================================"
        );
    }
);
