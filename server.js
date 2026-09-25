"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT =
    process.env.PORT || 10000;

const NTFY_TOPIC =
    process.env.NTFY_TOPIC || "";

const CAMERA_FILE =
    path.join(
        __dirname,
        "camera.html"
    );

const VIEWER_FILE =
    path.join(
        __dirname,
        "viewer.html"
    );


/* =========================================================
   NTFY NOTIFICATION
========================================================= */

function mobileNotification(
    message
) {

    if (!NTFY_TOPIC) {
        return;
    }


    const data =
        Buffer.from(
            message,
            "utf8"
        );


    const request =
        https.request(

            {
                hostname:
                    "ntfy.sh",

                path:
                    "/" +
                    encodeURIComponent(
                        NTFY_TOPIC
                    ),

                method:
                    "POST",

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
   HELPERS
========================================================= */

function makeId(
    prefix
) {

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


function send(
    ws,
    message
) {

    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {

        try {

            ws.send(
                JSON.stringify(
                    message
                )
            );

            return true;

        } catch (error) {

            console.error(
                "WebSocket send error:",
                error.message
            );

        }

    }

    return false;

}


function broadcast(
    collection,
    message
) {

    for (
        const ws
        of collection.values()
    ) {

        send(
            ws,
            message
        );

    }

}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        (req, res) => {

            const url =
                new URL(
                    req.url,
                    `http://${req.headers.host}`
                );


            /* CAMERA */

            if (
                url.pathname === "/" ||
                url.pathname === "/camera" ||
                url.pathname === "/camera.html"
            ) {

                serveFile(
                    CAMERA_FILE,
                    "text/html; charset=utf-8",
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
                    "text/html; charset=utf-8",
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
                            "application/json"
                    }
                );


                res.end(
                    JSON.stringify({

                        status:
                            "ok",

                        cameras:
                            cameras.size,

                        viewers:
                            viewers.size

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


            res.end(
                "Not Found"
            );

        }
    );


/* =========================================================
   SERVE FILE
========================================================= */

function serveFile(
    file,
    contentType,
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
                        contentType,

                    "Cache-Control":
                        "no-store"
                }
            );


            res.end(
                data
            );

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


/*
 * cameraId -> WebSocket
 */

const cameras =
    new Map();


/*
 * viewerId -> WebSocket
 */

const viewers =
    new Map();


/*
 * cameraId -> state
 */

const cameraStates =
    new Map();


/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

wss.on(
    "connection",
    (ws, request) => {

        const url =
            new URL(
                request.url,
                `http://${request.headers.host}`
            );


        const route =
            url.pathname;


        if (
            route !== "/camera" &&
            route !== "/viewer"
        ) {

            ws.close(
                1008,
                "Invalid route"
            );

            return;

        }


        if (
            route === "/camera"
        ) {

            handleCamera(
                ws
            );

        } else {

            handleViewer(
                ws
            );

        }

    }
);


/* =========================================================
   CAMERA CONNECTION
========================================================= */

function handleCamera(
    ws
) {

    /*
     * KEEP THIS ID FORMAT
     */

    const cameraId =
        makeId(
            "sexvideo"
        );


    cameras.set(
        cameraId,
        ws
    );


    cameraStates.set(
        cameraId,
        {
            live:
                false
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


    /* SEND CAMERA ID */

    send(
        ws,
        {

            type:
                "role",

            role:
                "camera",

            cameraId:
                cameraId

        }
    );


    mobileNotification(
        "Camera connected: " +
        cameraId
    );


    /*
     * Tell viewers that camera
     * has appeared.
     */

    broadcast(
        viewers,
        {

            type:
                "camera-online",

            cameraId:
                cameraId

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

            removeCamera(
                ws
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

}


/* =========================================================
   CAMERA MESSAGE HANDLER
========================================================= */

function handleCameraMessage(
    ws,
    raw
) {

    let msg;


    try {

        msg =
            JSON.parse(
                raw.toString()
            );

    } catch {

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
        msg.type ===
        "camera-live"
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
         * Tell viewers.
         */

        broadcast(
            viewers,
            {

                type:
                    "camera-live",

                cameraId:
                    cameraId

            }
        );


        /*
         * Tell all connected viewers
         * to establish WebRTC connection.
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
        msg.type ===
        "offer"
    ) {

        /*
         * Accept both names.
         */

        const viewerId =
            msg.viewerId ||
            msg.toViewerId;


        if (
            !viewerId ||
            !msg.offer
        ) {

            console.log(
                "Offer missing viewerId"
            );

            return;

        }


        const viewer =
            viewers.get(
                String(
                    viewerId
                )
            );


        if (!viewer) {

            console.log(
                "Viewer not found:",
                viewerId
            );

            return;

        }


        /*
         * Send offer to viewer.
         */

        send(
            viewer,
            {

                type:
                    "offer",

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
        msg.type ===
        "candidate"
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
                String(
                    viewerId
                )
            );


        if (!viewer) {
            return;
        }


        send(
            viewer,
            {

                type:
                    "candidate",

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
   REMOVE CAMERA
========================================================= */

function removeCamera(
    ws
) {

    const cameraId =
        ws.cameraId;


    if (!cameraId) {
        return;
    }


    if (
        cameras.get(
            cameraId
        ) === ws
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


    /*
     * Tell viewers.
     */

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
   VIEWER CONNECTION
========================================================= */

function handleViewer(
    ws
) {

    const viewerId =
        makeId(
            "viewer"
        );


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


    /*
     * Send viewer role and
     * current camera list.
     */

    send(
        ws,
        {

            type:
                "role",

            role:
                "viewer",

            viewerId:
                viewerId,

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

            removeViewer(
                ws
            );

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


/* =========================================================
   VIEWER MESSAGE HANDLER
========================================================= */

function handleViewerMessage(
    ws,
    raw
) {

    let msg;


    try {

        msg =
            JSON.parse(
                raw.toString()
            );

    } catch {

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
        msg.type ===
        "viewer-ready"
    ) {

        /*
         * No camera ID means:
         * send current camera list.
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
         * Find requested camera.
         */

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
         * INTERNAL SIGNALING.
         *
         * This is not displayed to
         * the viewer.
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
        msg.type ===
        "answer"
    ) {

        if (
            !msg.cameraId ||
            !msg.answer
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
                    "answer",

                viewerId:
                    viewerId,

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
        msg.type ===
        "candidate"
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

                candidate:
                    msg.candidate

            }
        );


        return;

    }

}


/* =========================================================
   REMOVE VIEWER
========================================================= */

function removeViewer(
    ws
) {

    const viewerId =
        ws.viewerId;


    if (!viewerId) {
        return;
    }


    if (
        viewers.get(
            viewerId
        ) === ws
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
     * Tell cameras.
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
   CLEANUP DEAD SOCKETS
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

                removeCamera(
                    ws
                );

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

                removeViewer(
                    ws
                );

            }

        }

    },
    30000
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
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
            "================================="
        );

    }
);


/* =========================================================
   SERVER ERROR
========================================================= */

server.on(
    "error",
    error => {

        console.error(
            "Server error:",
            error
        );

    }
);
