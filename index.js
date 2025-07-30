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
import requestIp from'request-ip';
import geoip from 'geoip-lite';
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
    let e = 1
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

app.use((req, res, next) => {
  try {
    const clientIp = requestIp.getClientIp(req);

    // Skip local/internal IPs
    if (!clientIp || /(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2[0-9]\.)|(^172\.3[0-1]\.)|(^192\.168\.)/.test(clientIp)) {
      return next();
    }

    // Get geo info from IP
    const geo = geoip.lookup(clientIp);

    // Redirect if IP is from Israel
    if (geo && geo.country === 'IL') {
      return res.redirect('https://en.wikipedia.org/wiki/Gaza_genocide');
    }

    next(); // Continue for non-Israeli IPs
  } catch (e) {
    console.error('Geolocation error:', e);
    next(); // Fail open on errors
  }
});

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


app.get('/sitemap.xml', async (req, res) => {
  try {
    const sitemapPath = path.join(process.cwd(), 'static', 'sitemap.xml');
    const raw = await fs.promises.readFile(sitemapPath, 'utf8'); // ✅ using promises from fs

    const domain = req.hostname;
    const modified = raw.replace(/canlite\.org/g, domain);

    res.set('Content-Type', 'application/xml');
    res.send(modified);
  } catch (err) {
    console.error('Error reading sitemap:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get("/validate-domain", async (req, res) => {
  res.status(200).send("OK");
});

app.get("/allgames", async (req, res) => {
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
    hostname: req.hostname,
  });
});

app.get("/games", async (req, res) => {
  try {
    const topGames = await redisClient.zRange(
        "game_leaderboard",
        0,
        7,
        { REV: true, WITHSCORES: true }
    );

    const result = [];
    for (let i = 0; i < topGames.length; i += 1) {
      const gameName = topGames[i];
      const score = topGames[i + 1];

      const game = games.find(g => g.name === gameName);

      if (game) {
        result.push({
          ...game,
        });
      } else {
        console.warn(`Game not found in database: ${gameName}`);
      }
    }

    // Split into top 3 and next 5
    const topGamesFirst = result.slice(0, 3);
    const topGamesRest = result.slice(3, 8);
    const hostname = req.hostname

    res.render("gamesRemake", {
      topGamesFirst,
      topGamesRest,
      hostname
    });
  } catch (err) {
    console.error("Error fetching top games:", err);
    res.status(500).send("Internal Server Error");
  }
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

  if (!game) return res.status(404).send("Game not found");

  const counterKey = `games:${gameName}:counter`;

  // Use pipeline with correct commands
  const pipeline = redisClient.multi();
  pipeline.incr(counterKey);
  pipeline.zAdd('game_leaderboard', { score: 1, value: gameName }, { INCR: true });

  pipeline.exec()
      .catch((err) => console.error("Redis update error:", err));
  const hostname = req.hostname
  res.render("play", {
    game,
    hostname
  });
});

app.get("/", (req, res) => {
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
    let e = 1;
  });
  try {
    if (bareServer.shouldRoute(req)) {
      bareServer.routeRequest(req, res);
    } else {
      app(req, res);
    }
  } catch (error) {
    if (error.message && error.message.includes("aborted")) {
      return;
    }
    res.statusCode = 500;
    res.write(String(error));
    res.end();
  }
});

server.on("upgrade", async (req, socket, head) => {
  req.on("aborted", () => {
    let e = 1;
  });
  try {
    if (bareServer.shouldRoute(req)) {
      bareServer.routeUpgrade(req, socket, head);
    } else {
      socket.end();
    }
  } catch (error) {
    if (error.message && error.message.includes("aborted")) {
      socket.end();
      return;
    }
    socket.end();
  }
});

app.use((err, req, res, next) => {
  if (err && err.type === "request.aborted") {
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

if(process.env.environment === "testing") {
  server.listen(9908, () => {
    console.log("Main server http://localhost:9909");
  });
} else {
  server.listen(9909, () => {
    console.log("Main server http://localhost:9909");
  });
}

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

if(process.env.environment === "testing") {
  verify.listen(3999, () => {
    console.log("Domain validation server running on http://localhost:4000");
  });
} else {
  verify.listen(4000, () => {
    console.log("Domain validation server running on http://localhost:4000");
  });
}

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
