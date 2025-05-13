import express from "express";
import { execSync } from "node:child_process";
import fs from "node:fs";
import session from "express-session";
import path from "node:path";
import { dirname } from "node:path";
import { createBareServer } from "@tomphttp/bare-server-node";
import { fileURLToPath } from "node:url";
import * as http from "node:http";
import * as https from "node:https";
import { createClient } from "redis";
import apiRoutes from "./api.js";
import verifyUser from "./middleware/authAdmin.js";
import moment from "moment";
import { RedisStore } from "connect-redis";
import crypto from "crypto";

// Babel and Cheerio imports.
import babelParser from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ───────────────────────────────────────────────
// Main (decoded) app: routes send raw content.
const app = express();

// ───────────────────────────────────────────────
// The encrypted instance sits in front of app.
const encrypted = express();

const bareServer = createBareServer("/b/");
let games = [];
const gamesFilePath = path.join(__dirname, "end.json");
try {
    const data = fs.readFileSync(gamesFilePath, "utf8");
    games = JSON.parse(data);
} catch (err) {
    console.error("Failed to load games data:", err);
}

encrypted.disable("x-powered-by");
encrypted.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const reservedIdentifiers = new Set([
    "Infinity",
    "console",
    "require",
    "module",
    "exports",
    "navigator",
    "document",
    "window",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "Math",
    "Number",
    "String",
    "Array",
    "Object",
    "JSON",
    "Date",
    "RegExp",
    "Function"
]);

let redisClient = createClient();
redisClient.connect().catch(console.error);
let redisStore = new RedisStore({
    client: redisClient,
    prefix: "myapp:",
});

encrypted.use(
    session({
        // store: redisStore,
        secret: process.env.EXPRESSJS_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === "production" },
    })
);

encrypted.use(express.json({ limit: "50mb" }));
encrypted.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ───────────────────────────────────────────────
// Helper Functions

function getOrCreate(mapping, original, generator) {
    if (Object.prototype.hasOwnProperty.call(mapping, original)) {
        console.log("Mapping for " + original + " exists as " + mapping[original])
        return mapping[original];
    } else {
        const obfuscated = generator(original);
        mapping[original] = obfuscated;
        console.log("Mapping for " + original + " created as " + mapping[original])
        return obfuscated;
    }
}

function getOrCreateClass(mapping, className, sessionKey) {
    return getOrCreate(mapping, className, (name) =>
        deterministicScrambleClass(name, sessionKey)
    );
}

function getOrCreateId(mapping, idName, sessionKey) {
    return getOrCreate(mapping, idName, (name) =>
        scrambleIdentifier(name, sessionKey)
    );
}

function hashString(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

function scrambleIdentifier(name, sessionKey) {
    return "_" + sessionKey.slice(0, 5) + "_" +
        hashString("id:" + name + ":session:" + sessionKey).slice(0, 12);
}

// ───────────────────────────────────────────────
// Deterministic scramble for class names.
function deterministicScrambleClass(className, sessionKey) {
    return "_" + sessionKey.slice(0, 5) + "_" +
        crypto.createHash("md5")
            .update("class:" + className + ":session:" + sessionKey)
            .digest("hex")
            .slice(0, 12);
}

function scrambleLink(link, sessionKey) {
    return "_" + sessionKey.slice(0, 5) + "_" +
        hashString("link:" + link + ":session:" + sessionKey).slice(0, 12);
}

function obfuscateHTMLText(original, sessionKey) {
    if (original.length <= 1) return original;
    let pieces = [];
    let i = 0;
    while (i < original.length) {
        let chunkLength = Math.floor(Math.random() * 3) + 1;
        pieces.push(original.substr(i, chunkLength));
        i += chunkLength;
    }
    return pieces.join("<!-- -->");
}

// ───────────────────────────────────────────────
// Asset resolution helper (unchanged)
function resolveAssetPath(href) {
    console.log(href);
    href = decodeURI(href);
    console.log(href);
    const segments = href.split("/");
    const lastSegment = segments.pop() || "";
    if (lastSegment.indexOf(".") === -1) {
        return href;
    }
    const relativeHref = href.startsWith("/") ? href.slice(1) : href;
    const candidates = [
        { folder: "static", fullPath: path.join(__dirname, "static", relativeHref) },
        { folder: "dist", fullPath: path.join(__dirname, "dist", relativeHref) }
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate.fullPath)) {
            console.log(path.posix.join("/", candidate.folder, relativeHref));
            return path.posix.join("/", candidate.folder, relativeHref);
        }
    }
    console.log(href.startsWith("/") ? href : "/" + href);
    return href.startsWith("/") ? href : "/" + href;
}

// ───────────────────────────────────────────────
// Transformation Functions
//
// We assume HTML text nodes contain only static content.
// (UI text produced at runtime via concatenation in JS will not be touched by the Babel plugin.)
async function transformHTML(code, sessionMapping, sessionKey) {
    const $ = cheerio.load(code, { decodeEntities: false });
    const debug = true;
    const shouldRewrite = (url) =>
        url &&
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("//") &&
        !url.startsWith("data:") &&
        !url.startsWith("mailto:");

    $("*")
        .contents()
        .each(function () {
            const parentTag = this.parent && this.parent.tagName ? this.parent.tagName.toLowerCase() : "";
            if (parentTag === "script" || parentTag === "title" || parentTag === "style") return;
            if (this.type === "text") {
                let txt = $(this).text();
                if (txt.trim().length > 1) {
                    const obf = getOrCreate(sessionMapping.strings, txt, (str) => obfuscateHTMLText(str, sessionKey));
                    if (debug) console.debug("Rewriting text node:", txt, "->", obf);
                    $(this).replaceWith(obf);
                }
            }
        });

    // Process class attributes.
    $("[class]").each(function () {
        const origClasses = $(this)
            .attr("class")
            .trim()
            .split(/\s+/);
        const newClasses = origClasses.map((cls) =>
            cls === "material-symbols-outlined"
                ? cls
                : getOrCreateClass(sessionMapping.classnames, cls, sessionKey)
        );
        if (debug) console.debug("Rewriting class attribute:", $(this).attr("class"), "->", newClasses.join(" "));
        $(this).attr("class", newClasses.join(" "));
    });

    // Process id attributes.
    $("[id]").each(function () {
        const origId = $(this).attr("id").trim();
        const newId = getOrCreateId(sessionMapping.ids, origId, sessionKey);
        if (debug) console.debug("Rewriting id attribute:", origId, "->", newId);
        $(this).attr("id", newId);
    });

    // Rewrite src attributes (for images and scripts).
    $("[src]").each(function () {
        let src = $(this).attr("src");
        src = decodeURI(src);
        if (!src || !shouldRewrite(src)) return;
        let resolvedPath = resolveAssetPath(src);
        const ext = path.extname(resolvedPath);
        const obf = getOrCreate(sessionMapping.links, resolvedPath, (link) => scrambleLink(link, sessionKey));
        const newSrc = "/" + obf + ext;
        if (debug) console.debug(`Rewriting src on <${$(this).get(0).tagName}>: ${src} -> ${newSrc}`);
        $(this).attr("src", newSrc);
    });

    // Rewrite href attributes (for stylesheets, links, etc.).
    $("[href]").each(function () {
        let href = $(this).attr("href");
        if (!href || !shouldRewrite(href)) return;
        let resolvedPath = resolveAssetPath(href);
        const ext = path.extname(resolvedPath);
        if (debug) console.debug("Resolved href path:", resolvedPath);
        const obf = getOrCreate(sessionMapping.links, resolvedPath, (link) => scrambleLink(link, sessionKey));
        const newHref = "/" + obf + ext;
        if (debug) console.debug(`Rewriting href on <${$(this).get(0).tagName}>: ${href} -> ${newHref}`);
        $(this).attr("href", newHref);
    });

    return $.html();
}

async function transformCSS(code, sessionMapping, sessionKey) {
    code = code.replace(/(^|\s)\.([a-zA-Z0-9_-]+)/g, (match, prefix, origClass) => {
        const newClass = deterministicScrambleClass(origClass, sessionKey);
        return prefix + "." + newClass;
    });
    code = code.replace(/(["'])(.*?)\1/g, (match, quote, content) => {
        if (content.length > 1) {
            let pieces = [];
            let i = 0;
            while (i < content.length) {
                let chunkLength = Math.floor(Math.random() * 3) + 1;
                pieces.push(content.substr(i, chunkLength));
                i += chunkLength;
            }
            const obfContent = pieces.join("/* */");
            return quote + obfContent + quote;
        }
        return match;
    });
    return code;
}

// ───────────────────────────────────────────────
// Babel Plugin for JS Transformation
//
// We now add a check to skip obfuscation for short string literals (length < 4),
// which covers cases like "AM", "PM", etc.
function obfuscationPlugin(sessionMapping, sessionKey) {
    return {
        visitor: {
            Identifier(path) {
                // Do not change member expressions or keys.
                if (
                    path.parent &&
                    t.isMemberExpression(path.parent) &&
                    path.parent.property === path.node &&
                    !path.parent.computed
                ) {
                    return;
                }
                if (path.key === "key") return;
                const orig = path.node.name;
                if (reservedIdentifiers.has(orig)) return;
                const newName = getOrCreate(sessionMapping.identifiers, orig, (name) =>
                    scrambleIdentifier(name, sessionKey)
                );
                path.node.name = newName;
            },
            StringLiteral(path) {
                // Skip module specifiers.
                if (
                    path.parent &&
                    (
                        (path.parent.type === "ImportDeclaration" && path.key === "source") ||
                        (path.parent.type === "ExportNamedDeclaration" && path.key === "source") ||
                        (path.parent.type === "ExportAllDeclaration" && path.key === "source") ||
                        (path.parent.type === "CallExpression" && path.parent.callee.name === "require")
                    )
                ) {
                    return;
                }
                if (path.node._obfuscated) return;
                const orig = path.node.value;

                // **** FIX: Skip obfuscation for string literals that appear to be HTML markup.
                if (orig.includes("<") || orig.includes(">")) {
                    return;
                }

                // New check: skip short literals (likely runtime UI values like "AM"/"PM").
                if (orig.length < 4) {
                    return;
                }

                // Check for common DOM id lookups.
                if (
                    path.parent && path.parent.type === "CallExpression" &&
                    path.parent.callee &&
                    (
                        (path.parent.callee.type === "MemberExpression" &&
                            path.parent.callee.property &&
                            path.parent.callee.property.name === "getElementById") ||
                        (path.parent.callee.type === "MemberExpression" &&
                            path.parent.callee.property &&
                            path.parent.callee.property.name === "querySelector" &&
                            orig.startsWith("#"))
                    )
                ) {
                    let idValue = orig.startsWith("#") ? orig.slice(1) : orig;
                    const newId = getOrCreateId(sessionMapping.ids, idValue, sessionKey);
                    path.node.value = orig.startsWith("#") ? "#" + newId : newId;
                    return;
                }

                // For plain strings that match an ID pattern and exist in the mapping, use it.
                if (/^[a-zA-Z0-9_-]+$/.test(orig) && sessionMapping.ids[orig]) {
                    path.node.value = sessionMapping.ids[orig];
                    return;
                }

                // Otherwise, if the string is a valid class name, use the class mapping.
                if (/^[a-zA-Z0-9_-]+$/.test(orig)) {
                    path.node.value = getOrCreateClass(sessionMapping.classnames, orig, sessionKey);
                } else if (orig.length > 1) {
                    const obf = getOrCreate(sessionMapping.strings, orig, (str) => obfuscateJSString(str, sessionKey));
                    const parsed = babelParser.parseExpression(obf, { plugins: ["jsx"] });
                    parsed._obfuscated = true;
                    path.replaceWith(parsed);
                }
            },
        },
    };
}

function transformJS(code, sessionMapping, sessionKey) {
    const ast = babelParser.parse(code, { sourceType: "module", plugins: ["jsx"] });
    const traverseFn = typeof traverse === "function" ? traverse : traverse.default;
    traverseFn(ast, obfuscationPlugin(sessionMapping, sessionKey).visitor);
    return generate.default(ast, {}).code;
}

function obfuscateJSString(original, sessionKey) {
    if (original.length <= 1) return original;
    let pieces = [];
    let i = 0;
    while (i < original.length) {
        let chunkLength = Math.floor(Math.random() * 3) + 1;
        pieces.push(original.substr(i, chunkLength));
        i += chunkLength;
    }
    let expr = t.stringLiteral(pieces[0]);
    for (let j = 1; j < pieces.length; j++) {
        expr = t.binaryExpression("+", expr, t.stringLiteral(pieces[j]));
    }
    return generate.default(expr).code;
}

// ───────────────────────────────────────────────
// Static routes for UV files – read and send raw content.
const uvFiles = [
    { route: "/uv/sw.js", file: "static/uv/sw.js", type: "application/javascript" },
    { route: "/~/uv/uv/uv.bundle.js", file: "static/uv/uv.bundle.js", type: "application/javascript" },
    { route: "/~/uv/uv/uv.config.js", file: "static/uv/uv.config.js", type: "application/javascript" },
    { route: "/~/uv/uv/uv.handler.js", file: "static/uv/uv.handler.js", type: "application/javascript" }
];

uvFiles.forEach(({ route, file, type }) => {
    encrypted.get(route, async (req, res, next) => {
        try {
            const filePath = path.join(__dirname, file);
            const data = await fs.promises.readFile(filePath, "utf8");
            res.set("Content-Type", type);
            res.send(data);
        } catch (err) {
            next(err);
        }
    });
});

// ───────────────────────────────────────────────
// encoding function
async function encode(req, res, body) {
    console.log("Called encode")
    let transformed = body;
    const contentType = res.get("Content-Type") || "";
    console.log("Content type: " + contentType)
    if (typeof body === "string") {
        try {
            if (contentType.includes("text/html")) {
                transformed = await transformHTML(body, req.session.obfuscationMapping, req.session.sessionKey);
            } else if (contentType.includes("application/javascript")) {
                transformed = transformJS(body, req.session.obfuscationMapping, req.session.sessionKey);
            } else if (contentType.includes("text/css")) {
                transformed = await transformCSS(body, req.session.obfuscationMapping, req.session.sessionKey);
            }
            res.send(transformed);
        } catch (e) {
            console.error("Error encoding response:", e);
        }
    }
}

// ───────────────────────────────────────────────
// Landing page route
app.get("/", async (req, res, next) => {
    try {
        const filePath = path.join(__dirname, "static", "landing", "index.html");
        const data = await fs.promises.readFile(filePath, "utf8");
        res.set("Content-Type", "text/html");
        await encode(req, res, data);
    } catch (err) {
        next(err);
    }
});

app.get("/proxe", async (req, res, next) => {
    try {
        const filePath = path.join(__dirname, "dist", "index.html");
        const data = await fs.promises.readFile(filePath, "utf8");
        res.set("Content-Type", "text/html");
        await encode(req, res, data);
    } catch (err) {
        next(err);
    }
});

// Games list route
app.get("/games", async (req, res, next) => {
    try {
        console.log("Called games")
        const perPage = 100;
        let search = req.query.search || "";
        let page = parseInt(req.query.page) || 1;

        const filteredGames = games.filter((game) =>
            game.name.toLowerCase().includes(search.toLowerCase())
        );
        const total = filteredGames.length;
        const totalPages = Math.ceil(total / perPage);
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        const sortedGames = filteredGames.sort((a, b) => a.name.localeCompare(b.name));
        const startIndex = (page - 1) * perPage;
        const paginatedGames = sortedGames.slice(startIndex, startIndex + perPage);

        const obfuscateLink = (link) => {
            if (!req.session.obfuscationMapping.links[link]) {
                req.session.obfuscationMapping.links[link] = scrambleLink(link, req.session.sessionKey);
            }
            return req.session.obfuscationMapping.links[link];
        };
        console.log("Got to res render")
        res.render("games", { games: paginatedGames, currentPage: page, totalPages, obfuscateLink }, async (err, html) => {
            console.log("In res render")
            if (err) console.log("ERR " + err);
            if (err) return next(err);
            try {
                console.log("Trying to render")
                res.set("Content-Type", "text/html");
                await encode(req, res, html);
            } catch (encodingError) {
                console.log("Game error")
                next(encodingError);
            }
        });
    } catch (error) {
        next(error);
    }
});

// Play a game route
app.get("/play/:id", (req, res) => {
    const gameName = req.params.id;
    const game = games.find((g) => g.name === gameName);
    if (!game) {
        return res.status(404).send("Game not found");
    }
    const obfuscateLink = (link) => {
        if (!req.session.obfuscationMapping.links[link]) {
            req.session.obfuscationMapping.links[link] = scrambleLink(link, req.session.sessionKey);
        }
        return req.session.obfuscationMapping.links[link];
    };
    res.render("play", { game, obfuscateLink });
});

// ───────────────────────────────────────────────
// API Routes & static asset routes
app.use("/api", apiRoutes);

// Static asset handler (async)
app.get(["/:folder(static|dist)/*"], async (req, res, next) => {
    try {
        const folder = req.params.folder;
        const fileSubPath = req.params[0] || "";
        const filePath = path.join(__dirname, folder, fileSubPath);
        const ext = path.extname(filePath).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot"].includes(ext)) {
            const data = await fs.promises.readFile(filePath);
            const contentTypes = {
                ".png": "image/png",
                ".webp": "image/webp",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".gif": "image/gif",
                ".ico": "image/x-icon",
                ".svg": "image/svg+xml",
                ".woff": "font/woff",
                ".woff2": "font/woff2",
                ".ttf": "font/ttf",
                ".eot": "application/vnd.ms-fontobject"
            };
            res.set("Content-Type", contentTypes[ext] || "application/octet-stream");
            res.send(data);
        } else {
            const data = await fs.promises.readFile(filePath, "utf8");
            if (ext === ".js") {
                res.set("Content-Type", "application/javascript");
            } else if (ext === ".html") {
                res.set("Content-Type", "text/html");
            } else if (ext === ".css") {
                res.set("Content-Type", "text/css");
            } else {
                res.set("Content-Type", "text/plain");
            }
            await encode(req, res, data);
        }
    } catch (err) {
        next(err);
    }
});

app.use(express.static(__dirname + "/dist"));
app.use(express.static(__dirname + "/static"));

encrypted.use((req, res, next) => {
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
    next();
});

// ───────────────────────────────────────────────
// Obfuscation session mapping middleware (async)
encrypted.use((req, res, next) => {
    if (!req.session.obfuscationMapping) {
        req.session.obfuscationMapping = {
            identifiers: {},
            classnames: {},
            ids: {},
            strings: {},
            links: {},
        };
    }
    if (!req.session.sessionKey) {
        req.session.sessionKey = Math.random().toString(36).substring(2, 15);
    }
    next();
});

// ───────────────────────────────────────────────
// Encrypted wrapper middleware: decode incoming requests if needed,
// and override res.send so that every response passes through the encoding functions.
encrypted.use((req, res, next) => {
    let fullToken = req.path.slice(1); // remove leading '/'
    console.log("Got a request for " + fullToken);
    const dotIndex = fullToken.lastIndexOf(".");
    let tokenBase;
    if (dotIndex > -1) {
        tokenBase = fullToken.substring(0, dotIndex);
    } else {
        if(fullToken.endsWith('/')) {
            tokenBase = fullToken.slice(0, -1)
        } else {
            tokenBase = fullToken;
        }
    }
    const mapping = req.session && req.session.obfuscationMapping && req.session.obfuscationMapping.links;
    for (const key in mapping) {
        if (mapping[key] === tokenBase) {
            req.url = key;
            console.log("rewrote request for " + tokenBase + " as " + key);
            break;
        }
    }
    app(req, res);
});

// ───────────────────────────────────────────────
// Server setup: all requests go to the encrypted instance.
const server = http.createServer();

server.on("request", async (req, res) => {
    try {
        if (bareServer.shouldRoute(req)) {
            try {
                const { headers } = req;
                const domain = headers.host;
                const date = moment().format("YYYY-MM-DD");
                const key = `api_requests:${domain}:${date}`;
                await redisClient.incr(key);
                await redisClient.sAdd("tracked_domains", domain);
            } catch (e) {
                console.log(e);
            }
            bareServer.routeRequest(req, res);
        } else {
            encrypted(req, res);
        }
    } catch (error) {
        console.error("Request error:", error);
        res.statusCode = 500;
        res.write(error.toString());
        res.end();
    }
});

server.on("upgrade", async (req, socket, head) => {
    try {
        if (bareServer.shouldRoute(req)) {
            try {
                const { headers } = req;
                const domain = headers.host;
                const date = moment().format("YYYY-MM-DD");
                const key = `api_requests:${domain}:${date}`;
                await redisClient.incr(key);
                await redisClient.sAdd("tracked_domains", domain);
            } catch (error) {
                console.log(error);
            }
            bareServer.routeUpgrade(req, socket, head);
        } else {
            socket.end();
        }
    } catch (error) {
        console.error("Upgrade error:", error);
        socket.end();
    }
});

// Error-handling middleware.
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
    const requestedDomain = req.query.domain;
    if (requestedDomain.includes("104.36.85.249")) {
        res.status(403).send("Forbidden");
    } else {
        res.status(200).send("OK");
    }
});
verify.listen(4000, () => {
    console.log("Domain validation server running on http://localhost:4000");
});
