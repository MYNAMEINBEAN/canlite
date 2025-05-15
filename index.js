import express from "express";
import session from "express-session";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";
import fs from "node:fs/promises";
import path from "path";
import helmet from "helmet";
import compression from "compression";
import apiRoutes from "./api.js";
import verifyUser from "./middleware/authAdmin.js";
import { createBareServer } from "@tomphttp/bare-server-node";
import http from "node:http";
import https from "node:https";
import dotenv from 'dotenv';
import { fileURLToPath } from "url";

dotenv.config();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 6676;
const VERIFY_PORT = process.env.VERIFY_PORT || 4000;

// Initialize Express
const app = express();
const bareServer = createBareServer("/b/");

// Middleware
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet());
app.use(compression());

// Body parsers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Session store
const redisClient = createClient();
redisClient.connect().catch(() => {});
const redisStore = new RedisStore({ client: redisClient, prefix: "myapp:" });
app.use(
  session({
    store: redisStore,
    secret: process.env.EXPRESSJS_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 3600000 },
  })
);

// Load games data
let games = [];
(async () => {
  try {
    const data = await fs.readFile(path.join(__dirname, "end.json"), "utf8");
    games = JSON.parse(data);
  } catch {
    // silent failure
  }
})();

// Universal abort handler
app.use((req, res, next) => {
  req.on("aborted", () => {});
  next();
});

// Static assets
app.use(
  ['/static', '/dist'],
  express.static(path.join(__dirname), {
    maxAge: '1d',
    setHeaders: (res, file) => {
      if (!file.endsWith('.html')) res.set('Cache-Control', 'public, max-age=31557600, immutable');
    }
  })
);
app.use('/~/uv', express.static(path.join(__dirname, 'static/uv'), { maxAge: '1d' }));

// Service Worker
app.get('/uv/sw.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/~/uv/');
  res.sendFile(path.join(__dirname, 'static/uv/sw.js'));
});

// Health check
app.get('/validate-domain', (req, res) => res.sendStatus(200));

// API routes
app.use('/api', apiRoutes);

// Web routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'static/landing/index.html')));
app.get('/games', (req, res) => {
  const { search = '', page = 1 } = req.query;
  const filtered = games.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
  const perPage = 100;
  const totalPages = Math.max(Math.ceil(sorted.length / perPage), 1);
  const currentPage = Math.min(Math.max(parseInt(page), 1), totalPages);
  const paginated = sorted.slice((currentPage - 1) * perPage, currentPage * perPage);
  res.render('games', { games: paginated, currentPage, totalPages });
});
app.get('/play/:id', (req, res) => {
  const game = games.find(g => g.name === req.params.id);
  return game ? res.render('play', { game }) : res.status(404).end();
});
app.get('/d/:gameName.jpg', (req, res) => {
  const file = path.join(__dirname, 'static/d', `${req.params.gameName}.jpg`);
  res.sendFile(file, err => {
    if (err) res.sendFile(path.join(__dirname, 'static', 'logo.png'));
  });
});
app.get('/stats', verifyUser, (req, res) => res.sendFile(path.join(__dirname, 'private/stats/index.html')));
app.get('/proxe', (req, res) => res.sendFile(path.join(__dirname, 'dist/index.html')));

// Domain validation microservice
const verifyApp = express();
verifyApp.get('/validate-domain', (req, res) => {
  const { domain } = req.query;
  return domain.includes('104.36.85.249') ? res.sendStatus(403) : res.sendStatus(200);
});
verifyApp.listen(VERIFY_PORT, () => {});

// HTTP server with bareServer
const server = http.createServer((req, res) => {
  if (bareServer.shouldRoute(req)) return bareServer.routeRequest(req, res);
  app(req, res);
});
server.on('upgrade', (req, socket, head) => {
  if (bareServer.shouldRoute(req)) bareServer.routeUpgrade(req, socket, head);
  else socket.end();
});
server.listen(PORT, () => {});

// Ads fetcher
const url = 'https://adbpage.com/adblock?v=3&format=js';
const outputFile = path.join(__dirname, 'static/ads.js');
const fetchInterval = 5 * 60 * 1000;
function fetchAds() {
  https.get(url, res => {
    let data = '';
    res.on('data', chunk => (data += chunk));
    res.on('end', () => fs.writeFile(outputFile, data));
  }).on('error', () => {});
}
fetchAds();
setInterval(fetchAds, fetchInterval);

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(sig =>
  process.on(sig, async () => {
    server.close(() => process.exit(0));
  })
);
