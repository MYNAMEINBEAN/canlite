import express from "express";
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import session from "express-session"
import axios from 'axios';
import path from 'path';
import { dirname } from 'path';
import { createBareServer } from "@tomphttp/bare-server-node";
import { fileURLToPath } from 'url';
import { hostname } from "node:os";
import fernet from 'fernet';
import { exec } from 'child_process';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!fs.existsSync("dist")) {
    console.log("No build folder found. Building...");
    execSync("npm run build");
    console.log("Built!");
}

const app = express();
app.use(cookieParser());

const port = process.env.PORT || 3000;
const bareServer = createBareServer("/b/");

app.disable("x-powered-by");

app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function landing(req, res) {
    console.log("called landing");
    var token = new fernet.Token({
        secret: new fernet.Secret(req.session.secret),
        time: Date.parse(req.session.date),
        iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    })
    let encodedContent = token.encode(fs.readFileSync(path.join(__dirname + '/static/landing/index.html'), 'utf8'));
    encodedContent = "<script src='encrypt/fernetBrowser.js'></script><script>document.open();document.write(new fernet.Token({secret:new fernet.Secret(decodeURI(document.cookie.split('; ').find(c=>c.startsWith('secret=')).split('=')[1])),token:'" + encodedContent + "',ttl:0}).decode());document.close();</script>"
    res.send(encodedContent);
}

function appDouble(req, res) {
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
}

function appSingle(req, res) {
    res.sendFile(path.join(__dirname + '/static/app/index.html'));
}

function gamePlay(req, res) {
    const name = req.query.name;
    const filePath = path.join(__dirname + '/static/games/play/index.html'); // Your base JS file
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading file');
        }
        console.log(name)
        console.log(req.params.game)

        let modifiedFile = data.replaceAll('GAME_NAME', name).replaceAll('GAME_SHORT', req.params.game);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(modifiedFile);
    });
}

function proxe(req, res) {
    res.sendFile(path.join(__dirname + '/dist/index.html'));
}

function setup(req, res) {
    exec('dd if=/dev/urandom bs=32 count=1 2>/dev/null | openssl base64', function(error, stdout, stderr){
        req.session.secret = stdout;
        req.session.date = Date.parse(1);
        var token = new fernet.Token({
            secret: new fernet.Secret(req.session.secret),
            time: req.session.date,
            iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
        });
        console.log(req.session.secret);
        console.log(req.session.token);
    });
}

app.get('*', function(req, res) {
    if(req.session.secret) {
        console.log('Yay')
        console.log(req.url)
        if (req.url == '/encrypt/fernetBrowser.js') {
            console.log('fernet')
            res.sendFile(path.join(__dirname + '/static/' + req.url));
        } else if (req.url=='/') {
            landing(req, res)
        } else {
            var token = new fernet.Token({
                secret: new fernet.Secret(req.session.secret),
                time: Date.parse(req.session.date),
                iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
            })

            fs.readFile(path.join(__dirname + '/static/' + req.url), 'utf8', (err, data) => {
                if (err) {
                    return res.status(500).send('Error reading JavaScript file');
                }

                // Replace a placeholder (e.g., 'APP_URL') in your JS with the dynamic appUrl
                let html = false;
                if(data.includes('html')) {
                    html = true;
                }
                let encodedContent = data;
                if(html) {
                    token.encode(data);
                    encodedContent = "<script src='encrypt/fernetBrowser.js'></script><script>document.open();document.write(new fernet.Token({secret:new fernet.Secret(decodeURI(document.cookie.split('; ').find(c=>c.startsWith('secret=')).split('=')[1])),token:'" + encodedContent + "',ttl:0}).decode());document.close();</script>"
                }

                // Set the appropriate headers and send the modified JS file to the client
                res.send(encodedContent);
            });
        }
    } else {
        console.log('bope')
        // setup(req, res)
        req.session.secret = 'tfDLyVSRhfThtBHIpbZIt+OiXGk8Q3oe1lCVu9Tg17M='
        res.cookie('secret',req.session.secret, { maxAge: 900000, httpOnly: false });
        req.session.date = Date.parse(1);
        res.cookie('date',req.session.date, { maxAge: 900000, httpOnly: false });
        landing(req, res)
    }
});

// app.get('/', (req, res) => home(req, res));
//
// app.get('/app/:route/:file', (req , res) => appDouble(req, res));
//
// app.get('/app/:route/', (req , res) => appSingle(res, req));
//
// app.get("/games/play/:game", (req , res) => gamePlay(req, res));
//
// app.get("/proxe", (req, res) => proxe(req, res));
//
// app.get('/uv/sw.js', (req, res) => {
//     res.set('Service-Worker-Allowed', '/~/uv/');
//     res.sendFile(__dirname + '/static/uv/sw.js'); // Adjust path to your sw.js file
// });
//
// app.get('/~/uv/uv/uv.bundle.js', (req, res) => {
//     res.sendFile(__dirname + '/static/uv/uv.bundle.js'); // Adjust path to your sw.js file
// });
//
// app.get('/~/uv/uv/uv.config.js', (req, res) => {
//     res.sendFile(__dirname + '/static/uv/uv.config.js'); // Adjust path to your sw.js file
// });
//
// app.get('/~/uv/uv/uv.handler.js', (req, res) => {
//     res.sendFile(__dirname + '/static/uv/uv.handler.js'); // Adjust path to your sw.js file
// });

// app.get('/home', (req, res) => {
//     res.sendFile(path.join(__dirname + '/static/cover2/index.html'));
// })

app.use(express.static(__dirname + '/dist'))
app.use(express.static(__dirname + '/static'))

const server = createServer();

server.on("request", (req, res) => {
    try {
        if (bareServer.shouldRoute(req)) {
            bareServer.routeRequest(req, res);
        } else {
            app(req, res);
        }
    } catch (error) {
        console.error("Request error:", error);
        res.status(500).send("Internal Server Error");
    }
});

server.on("upgrade", (req, socket, head) => {
    try {
        if (bareServer.shouldRoute(req)) {
            bareServer.routeUpgrade(req, socket, head);
        } else {
            socket.end();
        }
    } catch (error) {
        console.error("Upgrade error:", error);
        socket.end();
    }
});

// app.error((req, res) => {
//     res.status(404);
//     res.sendFile("dist/index.html", { root: "." });
// });

server.on("listening", () => {
    const address = server.address();

    // by default we are listening on 0.0.0.0 (every interface)
    // we just need to list a few
    console.log("Listening on:");
    console.log(`\thttp://localhost:${address.port}`);
    console.log(`\thttp://${hostname()}:${address.port}`);
    console.log(
        `\thttp://${address.family === "IPv6" ? `[${address.address}]` : address.address
        }:${address.port}`
    );
});

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
    console.log("SIGTERM signal received: closing HTTP server");
    server.close();
    process.exit(0);
}

server.listen({
    port,
});
