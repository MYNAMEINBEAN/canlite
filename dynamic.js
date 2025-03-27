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

const reservedIdentifiers = new Set([
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

// Set cookie.secure to false in development (NODE_ENV not "production")
app.use(
    session({
        // store: redisStore,
        secret: process.env.EXPRESSJS_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === "production" },
    })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ───────────────────────────────────────────────
// OBFUSCATION SESSION MAPPING MIDDLEWARE
app.use((req, res, next) => {
    if (!req.session.obfuscationMapping) {
        req.session.obfuscationMapping = {
            identifiers: {},
            classnames: {},
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
// Helper Functions using crypto for unique hashes
function getOrCreate(mapping, original, generator) {
    if (Object.prototype.hasOwnProperty.call(mapping, original)) {
        return mapping[original];
    } else {
        const obfuscated = generator(original);
        mapping[original] = obfuscated;
        return obfuscated;
    }
}

function hashString(str) {
    return crypto.createHash("md5").update(str).digest("hex");
}

function scrambleIdentifier(name, sessionKey) {
    // Ensure the generated identifier starts with an underscore.
    return "_" + sessionKey.slice(0, 5) + "_" + hashString("id:" + name + ":session:" + sessionKey).slice(0, 12);
}

function scrambleClass(className, sessionKey) {
    // Ensure the generated class name starts with an underscore.
    return "_" + sessionKey.slice(0, 5) + "_" + hashString("class:" + className + ":session:" + sessionKey).slice(0, 12);
}

function scrambleLink(link, sessionKey) {
    // Ensure the generated link token starts with an underscore.
    return "_" + sessionKey.slice(0, 5) + "_" + hashString("link:" + link + ":session:" + sessionKey).slice(0, 12);
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
// Asset resolution helper: checks /static first then /dist
function resolveAssetPath(href) {
    href = decodeURI(href);
    // If the URL doesn’t contain a period in its last path segment, assume it's dynamic.
    const segments = href.split("/");
    const lastSegment = segments.pop() || "";
    if (lastSegment.indexOf(".") === -1) {
        // No file extension found; return href as-is.
        return href;
    }

    // Otherwise, try to resolve from /static then /dist.
    const relativeHref = href.startsWith("/") ? href.slice(1) : href;
    const candidates = [
        { folder: "static", fullPath: path.join(__dirname, "static", relativeHref) },
        { folder: "dist", fullPath: path.join(__dirname, "dist", relativeHref) }
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate.fullPath)) {
            console.log(path.posix.join("/", candidate.folder, relativeHref))
            return path.posix.join("/", candidate.folder, relativeHref);
        }
    }
    console.log(href.startsWith("/") ? href : "/" + href);
    return href.startsWith("/") ? href : "/" + href;
}

// ───────────────────────────────────────────────
// Transformation Functions
function transformHTML(code, sessionMapping, sessionKey) {
    const $ = cheerio.load(code, { decodeEntities: false });
    const debug = true;
    const shouldRewrite = (url) =>
        url &&
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("//") &&
        !url.startsWith("data:") &&
        !url.startsWith("mailto:") &&
        !url.startsWith("/o/");

    $("*")
        .contents()
        .each(function () {
            // Skip obfuscation if parent is <script> or <title>
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

    $("[class]").each(function () {
        // Skip obfuscation for classes matching "material-symbols-outlined"
        const origClasses = $(this)
            .attr("class")
            .trim()
            .split(/\s+/);
        const newClasses = origClasses.map((cls) =>
            cls === "material-symbols-outlined"
                ? cls
                : getOrCreate(sessionMapping.classnames, cls, (name) => scrambleClass(name, sessionKey))
        );
        if (debug) console.debug("Rewriting class attribute:", $(this).attr("class"), "->", newClasses.join(" "));
        $(this).attr("class", newClasses.join(" "));
    });

    $("[src]").each(function () {
        let src = $(this).attr("src");
        src = decodeURI(src);
        if (!src || !shouldRewrite(src)) return;
        let resolvedPath = resolveAssetPath(src);
        const obf = getOrCreate(sessionMapping.links, resolvedPath, (link) => scrambleLink(link, sessionKey));
        const newSrc = "/o/" + obf;
        if (debug) console.debug(`Rewriting src on <${$(this).get(0).tagName}>: ${src} -> ${newSrc}`);
        $(this).attr("src", newSrc);
    });

    $("[href]").each(function () {
        let href = $(this).attr("href");
        if (!href || !shouldRewrite(href)) return;
        let resolvedPath = resolveAssetPath(href);
        if (debug) console.debug("Resolved href path:", resolvedPath);
        const obf = getOrCreate(sessionMapping.links, resolvedPath, (link) => scrambleLink(link, sessionKey));
        const newHref = "/o/" + obf;
        if (debug) console.debug(`Rewriting href on <${$(this).get(0).tagName}>: ${href} -> ${newHref}`);
        $(this).attr("href", newHref);
    });

    return $.html();
}

function transformCSS(code, sessionMapping, sessionKey) {
    // Only replace class selectors outside url(...) constructs.
    code = code.replace(/(^|\s)\.([a-zA-Z0-9_-]+)/g, (match, prefix, origClass) => {
        const newClass = getOrCreate(sessionMapping.classnames, origClass, (name) => scrambleClass(name, sessionKey));
        return prefix + "." + newClass;
    });

    // Obfuscate string literals in CSS (e.g., font names) while preserving quotes.
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

function obfuscationPlugin(sessionMapping, sessionKey) {
    return {
        visitor: {
            Identifier(path) {
                // Skip member expressions and object keys.
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
                // Skip reserved identifiers.
                if (reservedIdentifiers.has(orig)) return;
                const newName = getOrCreate(sessionMapping.identifiers, orig, (name) =>
                    scrambleIdentifier(name, sessionKey)
                );
                path.node.name = newName;
            },
            StringLiteral(path) {
                // Skip module specifiers (import/export declarations or require calls)
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
                // Avoid transforming already-obfuscated nodes.
                if (path.node._obfuscated) return;

                const orig = path.node.value;
                // If the string looks like HTML (or contains tokens that may break valid JS), skip it.
                if (orig.includes("<") || orig.includes(">")) return;

                if (/^[a-zA-Z0-9_-]+$/.test(orig)) {
                    const newClass = getOrCreate(sessionMapping.classnames, orig, (name) => scrambleClass(name, sessionKey));
                    path.node.value = newClass;
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
    // Use traverse; ensure we use the correct function (default or not)
    const traverseFn = typeof traverse === "function" ? traverse : traverse.default;
    traverseFn(ast, obfuscationPlugin(sessionMapping, sessionKey).visitor);
    return generate.default(ast, {}).code;
}

// ───────────────────────────────────────────────
// STATIC ROUTES THAT SHOULD REMAIN UNCHANGED
app.get("/uv/sw.js", (req, res) => {
    res.set("Service-Worker-Allowed", "/~/uv/");
    res.sendFile(path.join(__dirname, "static/uv/sw.js"));
});
app.get("/~/uv/uv/uv.bundle.js", (req, res) => {
    res.sendFile(path.join(__dirname, "static/uv/uv.bundle.js"));
});
app.get("/~/uv/uv/uv.config.js", (req, res) => {
    res.sendFile(path.join(__dirname, "static/uv/uv.config.js"));
});
app.get("/~/uv/uv/uv.handler.js", (req, res) => {
    res.sendFile(path.join(__dirname, "static/uv/uv.handler.js"));
});
app.get("/validate-domain", (req, res) => {
    res.status(200).send("OK");
});
app.get("/stats", verifyUser, (req, res) => {
    res.sendFile(path.join(__dirname, "private/stats/index.html"));
});

// ───────────────────────────────────────────────
// MAIN APP ROUTES
app.get("/", (req, res, next) => {
    const filePath = path.join(__dirname, "static", "landing", "index.html");
    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) return next(err);
        const mapping = req.session.obfuscationMapping;
        const key = req.session.sessionKey;
        try {
            const transformed = transformHTML(data, mapping, key);
            res.set("Content-Type", "text/html");
            res.send(transformed);
        } catch (e) {
            next(e);
        }
    });
});

app.get("/games", (req, res, next) => {
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

    // Render the view to a string
    res.render("games", { games: paginatedGames, currentPage: page, totalPages, obfuscateLink }, (err, html) => {
        if (err) return next(err);
        try {
            const mapping = req.session.obfuscationMapping;
            const key = req.session.sessionKey;
            const transformed = transformHTML(html, mapping, key);
            res.send(transformed);
        } catch (e) {
            next(e);
        }
    });
});


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
// OBFUSCATED LINK HANDLING
app.get("/o/:obf", (req, res, next) => {
    console.log("Called /o route with", req.params.obf);
    console.log("Session ID:", req.session.id);
    const mapping = req.session.obfuscationMapping;
    // console.log("Mapping:", mapping.links);
    if (mapping && mapping.links) {
        const original = Object.keys(mapping.links).find((key) => mapping.links[key] === req.params.obf);
        if (original) {
            console.log("Found mapping:", original);
            req.url = original;
            console.log(req.url)
            return app(req, res);
        } else {
            console.log("No original found for obf:", req.params.obf);
        }
    } else {
        console.log("Mapping is not set correctly");
    }
    res.status(404).send("Not found");
});

// ───────────────────────────────────────────────
// API Routes & Cache Headers
app.use("/api", apiRoutes);

// ───────────────────────────────────────────────
// ROUTE HANDLING FOR ASSET OBFUSCATION
// ───────────────────────────────────────────────
// STATIC ASSET ROUTE (for /static and /dist)
app.get(["/:folder(static|dist)/*"], (req, res, next) => {
    const folder = req.params.folder;
    const fileSubPath = req.params[0] || "";
    const filePath = path.join(__dirname, folder, fileSubPath);
    const ext = path.extname(filePath).toLowerCase();
    const mapping = req.session.obfuscationMapping;
    const key = req.session.sessionKey;

    // List of extensions that should be read as binary (images, fonts, etc.)
    const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot"];

    if (binaryExtensions.includes(ext)) {
        fs.readFile(filePath, (err, data) => {
            if (err) return next(err);
            // Simple Content-Type mapping (consider using a MIME library for production)
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
        });
    } else {
        // For text-based files use UTF-8.
        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) return next(err);
            let transformed = data;
            try {
                if (ext === ".js") {
                    transformed = transformJS(data, mapping, key);
                    res.set("Content-Type", "application/javascript");
                } else if (ext === ".html") {
                    transformed = transformHTML(data, mapping, key);
                    res.set("Content-Type", "text/html");
                } else if (ext === ".css") {
                    transformed = transformCSS(data, mapping, key);
                    res.set("Content-Type", "text/css");
                } else {
                    res.set("Content-Type", "text/plain");
                }
                res.send(transformed);
            } catch (e) {
                next(e);
            }
        });
    }
});

app.use((req, res, next) => {
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
            app(req, res);
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
