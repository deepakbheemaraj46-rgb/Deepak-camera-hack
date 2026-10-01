"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

const CAMERA_FILE = path.join(
    __dirname,
    "camera.html"
);

const VIEWER_FILE = path.join(
    __dirname,
    "viewer.html"
);


/* =========================================================
   NTFY
========================================================= */

function mobileNotification(message) {

    if (!NTFY_TOPIC) {
        return;
    }

    const data = Buffer.from(
        message,
        "utf8"
    );

    const request = https.request(
        {
            hostname: "ntfy.sh",

            path:
                "/" +
                encodeURIComponent(NTFY_TOPIC),

            method: "POST",

            headers: {
                "Content-Type":
                    "text/plain; charset=utf-8",

                "Content-Length":
                    data.length,

                "Title":
                    "Camera Notification",

                "Priority":
                    "high"
            }
        },

        response => {

            response.on(
                "data",
                () => {}
            );

            response.on(
                "end",
                () => {}
            );
        }
    );

    request.on(
        "error",
        error => {

            console.error(
                "NTFY error:",
                error.message
            );
        }
    );

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


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(
    collection,
    message
) {

    for (
        const ws of collection.values()
    ) {

        send(
            ws,
            message
        );
    }
}


/* =========================================================
   CONNECTION MAPS
========================================================= */

const cameras = new Map();

const viewers = new Map();

const cameraStates = new Map();


/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer(
    (req, res) => {

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

            serveFile(
                CAMERA_FILE,
                res
            );

            return;
        }


        /* VIEWER */

        if (
            url.pathname === "/viewer" ||
            url.pathname === "/viewer.html"
        ) {

            serveFile(
                VIEWER_FILE,
                res
            );

            return;
        }


        /* HEALTH */

        if (
            url.pathname === "/health"
        ) {

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
                JSON.stringify(
                    {
                        status: "ok",

                        cameras:
                            cameras.size,

                        viewers:
                            viewers.size
                    }
                )
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

        res.end(
            "Not Found"
        );
    }
);


/* =========================================================
   SERVE HTML
========================================================= */

function serveFile(
    file,
    res
) {

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

                res.end(
                    "Server error"
                );

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

        maxPayload:
            1024 * 1024
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
            "WebSocket:",
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


    cameraStates.set(
        cameraId,
        {
            live: false
        }
    );


    ws.cameraId =
        cameraId;

    ws.cameraLive =
        false;


    console.log(
        "Camera connected:",
        cameraId
    );


    /* Send camera ID */

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


    /* Tell existing viewers */

    broadcast(
        viewers,
        {
            type: "camera-online",

            cameraId: cameraId
        }
    );


    /* Camera messages */

    ws.on(
        "message",
        raw => {

            handleCameraMessage(
                ws,
                raw
            );
        }
    );


    /* Camera closed */

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

function handleCameraMessage(
    ws,
    raw
) {

    let msg;

    try {

        msg = JSON.parse(
            raw.toString()
        );

    } catch {

        console.log(
            "Invalid camera message"
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


        const state =
            cameraStates.get(
                cameraId
            );


        if (state) {

            state.live =
                true;
        }


        console.log(
            "Camera LIVE:",
            cameraId
        );


        /*
         * Tell every viewer.
         */

        broadcast(
            viewers,
            {
                type: "camera-live",

                cameraId:
                    cameraId
            }
        );


        /*
         * Create WebRTC connection
         * for every existing viewer.
         */

        for (
            const viewerId
            of viewers.keys()
        ) {

            send(
                ws,
                {
                    type:
                        "viewer-ready",

                    viewerId:
                        viewerId
                }
            );
        }


        return;
    }


    /* =====================================================
       OFFER FROM CAMERA
    ===================================================== */

    if (
        msg.type === "offer"
    ) {

        const viewerId =
            msg.viewerId ||
            msg.toViewerId;


        if (
            !viewerId ||
            !msg.offer
        ) {

            console.log(
                "Invalid offer"
            );

            return;
        }


        const viewer =
            viewers.get(
                String(viewerId)
            );


        if (!viewer) {

            console.log(
                "Viewer not found:",
                viewerId
            );

            return;
        }


        send(
            viewer,
            {
                type: "offer",

                cameraId:
                    cameraId,

                offer:
                    msg.offer
            }
        );


        return;
    }


    /* =====================================================
       ICE FROM CAMERA
    ===================================================== */

    if (
        msg.type === "candidate"
    ) {

        const viewerId =
            msg.viewerId ||
            msg.toViewerId;


        if (
            !viewerId ||
            !msg.candidate
        ) {

            return;
        }


        const viewer =
            viewers.get(
                String(viewerId)
            );


        if (!viewer) {
            return;
        }


        send(
            viewer,
            {
                type: "candidate",

                cameraId:
                    cameraId,

                candidate:
                    msg.candidate
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


    cameraStates.delete(
        cameraId
    );


    console.log(
        "Camera disconnected:",
        cameraId
    );


    broadcast(
        viewers,
        {
            type:
                "camera-offline",

            cameraId:
                cameraId
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


    /* Send viewer role */

    send(
        ws,
        {
            type: "role",

            role: "viewer",

            viewerId:
                viewerId,

            cameras:
                Array.from(
                    cameras.keys()
                )
        }
    );


    /*
     * Send all currently connected
     * cameras.
     */

    for (
        const [
            cameraId,
            camera
        ]
        of cameras
    ) {

        send(
            ws,
            {
                type:
                    "camera-online",

                cameraId:
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

                    cameraId:
                        cameraId
                }
            );
        }
    }


    /* Viewer messages */

    ws.on(
        "message",
        raw => {

            handleViewerMessage(
                ws,
                raw
            );
        }
    );


    /* Viewer disconnected */

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

function handleViewerMessage(
    ws,
    raw
) {

    let msg;

    try {

        msg = JSON.parse(
            raw.toString()
        );

    } catch {

        console.log(
            "Invalid viewer message"
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
    ===================================================== */

    if (
        msg.type === "viewer-ready"
    ) {

        /*
         * Viewer is asking for all cameras.
         */

        if (!msg.cameraId) {

            for (
                const [
                    cameraId,
                    camera
                ]
                of cameras
            ) {

                send(
                    ws,
                    {
                        type:
                            "camera-online",

                        cameraId:
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

                            cameraId:
                                cameraId
                        }
                    );
                }
            }


            return;
        }


        /*
         * Viewer specifically selected
         * a camera.
         */

        const camera =
            cameras.get(
                String(
                    msg.cameraId
                )
            );


        if (!camera) {

            console.log(
                "Requested camera not found:",
                msg.cameraId
            );

            return;
        }


        /*
         * Tell camera to create offer.
         */

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
       ANSWER FROM VIEWER
    ===================================================== */

    if (
        msg.type === "answer"
    ) {

        if (
            !msg.cameraId ||
            !msg.answer
        ) {

            console.log(
                "Invalid answer"
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
       ICE FROM VIEWER
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
     * Tell cameras so they can
     * clean up their WebRTC peer.
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
   CLEAN DEAD CONNECTIONS
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
                ws.readyState ===
                WebSocket.CLOSED
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
                ws.readyState ===
                WebSocket.CLOSED
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
   START
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
