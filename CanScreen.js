const express = require("express");
const path = require("path");
const fs = require("node:fs");
const crypto = require("crypto");
require("dotenv").config();

const router = express.Router();

router.use(express.json());

const ALLOWED_BOTS = [
    /googlebot/i,
    /bingbot/i,
    /slurp/i,
    /duckduckbot/i,
    /baiduspider/i,
    /yandexbot/i,
    /facebookexternalhit/i,
    /twitterbot/i,
    /linkedinbot/i,
    /pinterest/i,
    /applebot/i,
    /whatsapp/i,
    /discordbot/i,
    /telegrambot/i,
    /embedly/i,
    /quora link preview/i,
    /redditbot/i,
    /slackbot/i,
    /vkshare/i,
    /screaming frog/i,
    /semrushbot/i,
    /ahrefsbot/i
];

// Screen middleware function
function screen(req, res, next) {
    // Check if the request is for the screening page or its static files
    if (req.originalUrl.includes("/cnscrn") || req.originalUrl.includes("/static_files")) {
        return next();
    }
    // Check User-Agent for allowed bots
    const userAgent = req.get('User-Agent') || '';
    if (ALLOWED_BOTS.some(bot => bot.test(userAgent))) {
        return next();
    }
    // Check if session exists and has passed property
    if (req.session && req.session.passed) {
        return next();
    } else {
        return res.redirect("/cnscrn");
    }
}

// Generate a PoW challenge
function generateChallenge(difficulty = 4) {
    const randomString = crypto.randomBytes(16).toString('hex');
    return { challenge: randomString, difficulty};
}

// Verify PoW solution
function verifySolution(challenge, solution, difficulty) {
    const prefix = '0'.repeat(difficulty);
    const hash = crypto.createHash('sha256').update(challenge + solution).digest('hex');
    return hash.startsWith(prefix);
}

// Screening page route
router.get("/", (req, res) => {
    const { challenge, difficulty} = generateChallenge();
    req.session.challenge = challenge;
    req.session.difficulty = difficulty;

    // Save session explicitly
    req.session.save((err) => {
        if (err) {
            console.error("Error saving session:", err);
            return res.status(500).send("Internal server error");
        }

        try {
            return res.sendFile(path.join(__dirname, "/static/cnscrn/index.html"));
        } catch (error) {
            console.log(error);
            return res.status(500).send("Error loading screening page");
        }
    });
});

// Screening page route
router.get("/static_files/screener.js", (req, res) => {
    try {
        fs.readFile(path.join(__dirname, "/static/cnscrn/index_files/screener.js"), 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                return;
            }
            return res.send(data.replace("INSERTCHALLENGE", req.session.challenge).replace("INSERTDIFFICULTY", 4));
        });
    } catch (error) {
        console.log(error);
        return res.status(500).send("Error loading screening js");
    }
});

// Verification route
router.post("/verify", (req, res) => {
    const { solution } = req.body;
    const { challenge, difficulty } = req.session;

    if (!challenge || !difficulty) {
        return res.status(400).json({ error: "No active challenge" });
    }

    if (verifySolution(challenge, solution, difficulty)) {
        req.session.passed = true;
        req.session.save((err) => {
            if (err) {
                console.error("Error saving session:", err);
                return res.status(500).json({ error: "Internal server error" });
            }
            res.json({ success: true });
        });
    } else {
        res.status(400).json({ error: "Invalid solution" });
    }
});

router.use("/static_files", express.static(path.join(__dirname, "/static/cnscrn/index_files")));

exports.setupCanScreen = function(app) {
    app.use(screen);
    app.use("/cnscrn", router);
};