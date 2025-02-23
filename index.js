import express from "express";
import { execSync } from "node:child_process";
import fs from "node:fs";
import session from "express-session";
import path from 'path';
import { dirname } from 'path';
import { createBareServer } from "@tomphttp/bare-server-node";
import { fileURLToPath } from 'url';
import {RedisStore} from "connect-redis";
import * as http from "node:http";
import * as https from "node:https";
import {createClient} from "redis"
import apiRoutes from './api.js';
import verifyUser from "./middleware/auth.js";
import moment from "moment";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const bareServer = createBareServer("/b/");
app.disable("x-powered-by");
let redisClient = createClient();
redisClient.connect().catch(console.error)
let redisStore = new RedisStore({
    client: redisClient,
    prefix: "myapp:",
})
app.set('trust proxy', 1)

app.use(session({
    store: redisStore,
    secret: process.env.EXPRESSJS_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true }
}));
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/uv/sw.js', (req, res) => {
    res.set('Service-Worker-Allowed', '/~/uv/');
    res.sendFile(__dirname + '/static/uv/sw.js'); // Adjust path to your sw.js file
});

app.get('/~/uv/uv/uv.bundle.js', (req, res) => {
    res.sendFile(__dirname + '/static/uv/uv.bundle.js'); // Adjust path to your sw.js file
});

app.get('/~/uv/uv/uv.config.js', (req, res) => {
    res.sendFile(__dirname + '/static/uv/uv.config.js'); // Adjust path to your sw.js file
});

app.get('/~/uv/uv/uv.handler.js', (req, res) => {
    res.sendFile(__dirname + '/static/uv/uv.handler.js'); // Adjust path to your sw.js file
});

app.get('/validate-domain', (req, res) => {
    res.status(200).send('OK');
});

app.get('/stats', verifyUser, (req, res) => {
    res.sendFile(path.join(__dirname + '/private/stats/index.html'));
});

app.get('/app/:route/:file', function(req , res){
        if (req.originalUrl.indexOf('app.js') > -1) {
            const apps = {
                discord: 'https://discord.com',
                geforce: 'https://www.nvidia.com/en-us/geforce-now/',
                reddit: 'https://reddit.com',
                chatgpt: 'https://chat.openai.com',
                xbox: "https://www.xbox.com/en-us/play",
                coolmath: 'https://www.coolmathgames.com/',
                crazygames: 'https://crazygames.com/',
                facebook: 'https://facebook.com/',
                nowgg: 'https://now.gg',
                poki: 'https://poki.com',
                snapchat: 'https://snapchat.com/',
                soundcloud: 'https://soundcloud.com/',
                thirty: 'https://thirtydollar.website',
                tiktok: 'https://tiktok.com',
                twitch: 'https://twitch.com',
                twitter: 'https://twitter.com/',
                spotify: 'https://accounts.spotify.com/en/login'
            };

            const jsFilePath = path.join(__dirname + '/static/app/app.js'); // Your base JS file
            fs.readFile(jsFilePath, 'utf8', (err, data) => {
                if (err) {
                    return res.status(500).send('Error reading JavaScript file');
                }

                // Replace a placeholder (e.g., 'APP_URL') in your JS with the dynamic appUrl
                const modifiedJs = data.replace('APP_URL', apps[req.params.route]);

                // Set the appropriate headers and send the modified JS file to the client
                res.setHeader('Content-Type', 'application/javascript');
                res.send(modifiedJs);
            });
        } else {
            res.sendFile(path.join(__dirname + '/static/app/' + req.params.file));
        }
});

app.get('/app/:route/', function(req , res){
    res.sendFile(path.join(__dirname + '/static/app/index.html'));
});

app.get('/', (req, res) => {
    const origin = req.get('host');
    console.log(origin)
    res.sendFile(path.join(__dirname + '/static/landing/index.html'));
});

app.get("/games/play/:game", (req , res) => {
    const name = req.query.name;
    const filePath = path.join(__dirname + '/static/games/play/index.html'); // Your base JS file
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading file');
        }
        console.log(name + ' ' + req.get('host'))

        if (req.get('host') === "canlite.org") {
            data = data.replace('<meta name="description" content="Play GAME_NAME online, free, un bl0ck3d on CanLite!">', '');
        }

        let modifiedFile = data.replaceAll('GAME_NAME', name).replaceAll('GAME_SHORT', req.params.game);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(modifiedFile);
    });
})

app.get("/proxe", function(req, res){
    res.sendFile(path.join(__dirname + '/dist/index.html'));
});

app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname + '/test.html'));
})

app.use(function (req, res, next) {
    if (req.path.endsWith(".png") || req.path.endsWith(".jpg") || req.path.endsWith(".jpeg") || req.path.endsWith(".gif")) {
        res.set('Cache-Control', 'public, max-age=31557600, immutable');
    } else {
        res.set('Cache-Control', 'max-age=600');
    }
    return next();
});

app.use('/api', apiRoutes); // Register API routes

app.use(express.static(__dirname + '/dist'))
app.use(express.static(__dirname + '/static'))

const server = http.createServer();

server.on("request", async (req, res) => {
    try {
        if (bareServer.shouldRoute(req)) {
            const { headers } = req;
            const domain = headers.host;
            const date = moment().format("YYYY-MM-DD");
            const key = `api_requests:${domain}:${date}`;

            await redisClient.incr(key);
            await redisClient.sAdd("tracked_domains", domain); // Store unique domains
            bareServer.routeRequest(req, res);
        } else {
            app(req, res);
        }
    } catch (error) {
        console.error("Request error:", error);
        res.statusCode = 200
        res.write(error)
        res.end();
    }
});

server.on("upgrade", async (req, socket, head) => {
    try {
        if (bareServer.shouldRoute(req)) {
            const { headers } = req;
            const domain = headers.host;
            const date = moment().format("YYYY-MM-DD");
            const key = `api_requests:${domain}:${date}`;

            await redisClient.incr(key);
            await redisClient.sAdd("tracked_domains", domain); // Store unique domains
            bareServer.routeUpgrade(req, socket, head);
        } else {
            socket.end();
        }
    } catch (error) {
        console.error("Upgrade error:", error);
        socket.end();
    }
});

// Error-handling middleware (add after your routes)
app.use((err, req, res, next) => {
    if (err && err.type === 'request.aborted') {
        console.warn('Request was aborted by the client:', err);
        // Optionally, send a specific response or simply return
        return;
    }
    next(err);
});

// app.error((req, res) => {
//     res.status(404);
//     res.sendFile("dist/index.html", { root: "." });
// });

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
    console.log("SIGTERM signal received: closing HTTP server");
    server.close();
    process.exit(0);
}

server.listen(9091, () => {
    console.log('Main server http://localhost:9091');
});

// app.listen(9092);
const verify = express();
verify.get('/validate-domain', (req, res) => {
    const requestedDomain = req.query.domain;
    if (requestedDomain.includes('104.36.85.249')) {
        res.status(403).send('Forbidden');
    } else {
        res.status(200).send('OK');
    }
});

verify.listen(4000, () => {
    console.log('Domain validation server running on http://localhost:4000');
});

const url = 'https://adbpage.com/adblock?v=3&format=js'; // Replace with the URL you want to fetch
const outputFile = path.join(__dirname, 'static/ads.js');
const fetchInterval = 5 * 60 * 1000; // 5 minutes in milliseconds

// Function to fetch the website content
function fetchWebsite() {
    https.get(url, (res) => {
        let data = '';

        // Collect chunks of data
        res.on('data', (chunk) => {
            data += chunk;
        });

        // Write data to file once it's completely received
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

// Fetch the website every 5 minutes
fetchWebsite(); // Initial fetch
setInterval(fetchWebsite, fetchInterval);
