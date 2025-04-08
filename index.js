import express from "express";
import { execSync } from "node:child_process";
import fs from "node:fs";
import session from "express-session";
import path from "path";
import { dirname } from "path";
import { createBareServer } from "@tomphttp/bare-server-node";
import { fileURLToPath } from "url";
import * as http from "node:http";
import * as https from "node:https";
import { createClient } from "redis";
import apiRoutes from "./api.js";
import verifyUser from "./middleware/authAdmin.js";
import moment from "moment";
import { RedisStore } from "connect-redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const bareServer = createBareServer("/b/");

let games = [];
const gamesFilePath = path.join(__dirname, "end.json");
try {
  const data = fs.readFileSync(gamesFilePath, "utf8");
  games = JSON.parse(data);
} catch (err) {
  console.error("Failed to load games data:", err);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use((req, res, next) => {
  req.on("aborted", () => {
    console.warn("Request aborted by client:", req.url);
  });
  next();
});

let redisClient = createClient();
redisClient.connect().catch(console.error);

let redisStore = new RedisStore({
  client: redisClient,
  prefix: "myapp:",
});

app.use(
    session({
      store: redisStore,
      secret: process.env.EXPRESSJS_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true },
    })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// In-memory API tracking buffer
const apiStats = new Map();

app.get("/uv/sw.js", (req, res) => {
  res.set("Service-Worker-Allowed", "/~/uv/");
  res.sendFile(__dirname + "/static/uv/sw.js");
});

app.get("/~/uv/uv/uv.bundle.js", (req, res) => {
  res.sendFile(__dirname + "/static/uv/uv.bundle.js");
});

app.get("/~/uv/uv/uv.config.js", (req, res) => {
  res.sendFile(__dirname + "/static/uv/uv.config.js");
});

app.get("/~/uv/uv/uv.handler.js", (req, res) => {
  res.sendFile(__dirname + "/static/uv/uv.handler.js");
});

app.get("/validate-domain", (req, res) => {
  res.status(200).send("OK");
});

app.get("/stats", verifyUser, (req, res) => {
  res.sendFile(path.join(__dirname, "/private/stats/index.html"));
});

app.get("/games", (req, res) => {
  const perPage = 100;
  let search = req.query.search || "";
  let page = parseInt(req.query.page) || 1;

  const filteredGames = games.filter((game) =>
      game.name.toLowerCase().includes(search)
  );

  const total = filteredGames.length;
  const totalPages = Math.ceil(total / perPage);
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const sortedGames = filteredGames.sort((a, b) => a.name.localeCompare(b.name));
  const startIndex = (page - 1) * perPage;
  const paginatedGames = sortedGames.slice(startIndex, startIndex + perPage);

  res.render("games", {
    games: paginatedGames,
    currentPage: page,
    totalPages: totalPages,
  });
});

app.get("/d/:gameName.jpg", (req, res) => {
  const gameName = req.params.gameName;
  const filePath = path.join(__dirname, "static/d/", `${gameName}.jpg`);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.sendFile(path.join(__dirname, "static", "logo.png"));
  }
});

app.get("/play/:id", (req, res) => {
  const gameName = req.params.id;
  const game = games.find((g) => g.name === gameName);
  if (!game) {
    return res.status(404).send("Game not found");
  }
  res.render("play", { game });
});

app.get("/", (req, res) => {
  const origin = req.get("host");
  console.log(origin);
  res.sendFile(path.join(__dirname + "/static/landing/index.html"));
});

app.get("/proxe", function (req, res) {
  res.sendFile(path.join(__dirname + "/dist/index.html"));
});

app.use(function (req, res, next) {
  if (
      req.path.endsWith(".png") ||
      req.path.endsWith(".jpg") ||
      req.path.endsWith(".jpeg") ||
      req.path.endsWith(".gif")
  ) {
    res.set("Cache-Control", "public, max-age=31557600, immutable");
  } else {
    res.set("Cache-Control", "max-age=600");
  }
  return next();
});

app.use("/api", apiRoutes);
app.use(express.static(__dirname + "/dist"));
app.use(express.static(__dirname + "/static"));

const server = http.createServer();

server.on("request", async (req, res) => {
  req.on("aborted", () => {
    console.warn("Underlying request aborted:", req.url);
  });
  try {
    if (bareServer.shouldRoute(req)) {
      try {
        const { headers } = req;
        const domain = headers.host;
        const date = moment().format("YYYY-MM-DD");
        const key = `api_requests:${domain}:${date}`;
        apiStats.set(key, (apiStats.get(key) || 0) + 1);
        redisClient.sAdd("tracked_domains", domain).catch(console.error);
      } catch (e) {
        console.log(e);
      }
      bareServer.routeRequest(req, res);
    } else {
      app(req, res);
    }
  } catch (error) {
    if (error.message && error.message.includes("aborted")) {
      console.warn("Request aborted by client during processing:", error);
      return;
    }
    console.error("Request error:", error);
    res.statusCode = 500;
    res.write(String(error));
    res.end();
  }
});

server.on("upgrade", async (req, socket, head) => {
  req.on("aborted", () => {
    console.warn("Upgrade request aborted:", req.url);
  });
  try {
    if (bareServer.shouldRoute(req)) {
      try {
        const { headers } = req;
        const domain = headers.host;
        const date = moment().format("YYYY-MM-DD");
        const key = `api_requests:${domain}:${date}`;
        apiStats.set(key, (apiStats.get(key) || 0) + 1);
        redisClient.sAdd("tracked_domains", domain).catch(console.error);
      } catch (error) {
        console.log(error);
      }
      bareServer.routeUpgrade(req, socket, head);
    } else {
      socket.end();
    }
  } catch (error) {
    if (error.message && error.message.includes("aborted")) {
      console.warn("Upgrade aborted by client:", error);
      socket.end();
      return;
    }
    console.error("Upgrade error:", error);
    socket.end();
  }
});

// Flush local API stats to Redis every 5 seconds
setInterval(async () => {
  if (apiStats.size === 0) return;

  const pipeline = redisClient.multi();
  for (const [key, count] of apiStats.entries()) {
    pipeline.incrBy(key, count);
    pipeline.expire(key, 60*60*24*31);
  }

  apiStats.clear();

  try {
    await pipeline.exec();
    console.log(`Flushed API stats to Redis at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('Redis flush error:', err);
  }
}, 5000);

app.use((err, req, res, next) => {
  if (err && err.type === "request.aborted") {
    console.warn("Request was aborted by the client:", err);
    return;
  }
  next(err);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  process.exit(0);
}

server.listen(9091, () => {
  console.log("Main server http://localhost:9091");
});

const verify = express();
verify.get("/validate-domain", (req, res) => {
  try {
    const requestedDomain = req.query.domain;
    if (requestedDomain.includes("104.36.85.249")) {
      res.status(403).send("Forbidden");
    } else {
      res.status(200).send("OK");
    }
  } catch (error) {
    console.log("Verify error " + error);
  }
});

verify.listen(4000, () => {
  console.log("Domain validation server running on http://localhost:4000");
});

const url = 'https://adbpage.com/adblock?v=3&format=js';
const outputFile = path.join(__dirname, 'static/ads.js');
const fetchInterval = 5 * 60 * 1000;

function fetchWebsite() {
  https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      fs.writeFile(outputFile, data, (err) => {
        if (err) {
          console.error('Error writing to file:', err);
        } else {
          console.log(`Content fetched and saved to ${outputFile} at ${new Date().toISOString()}`);
        }
      });
    });
  }).on('error', (err) => {
    console.error('Error fetching the website:', err);
  });
}

fetchWebsite();
setInterval(fetchWebsite, fetchInterval);
