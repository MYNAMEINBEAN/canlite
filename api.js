import express from "express";
import crypto from 'crypto';
import pool from './db.js';
import verifyUser from "./middleware/authAdmin.js";
import {createClient} from "redis";
import moment from "moment";
import path, { dirname } from "path";
import fs from "node:fs";
import { fileURLToPath } from "url";

let redisClientAPI = createClient();
redisClientAPI.connect().catch(console.error)
const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let games = [];
const gamesFilePath = path.join(__dirname, "end.json");
try {
    const data = fs.readFileSync(gamesFilePath, "utf8");
    games = JSON.parse(data);
} catch (err) {
    console.error("Failed to load games data:", err);
}

// Utility function to generate random strings
const generateRandomString = (length) => {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
};

router.post('/check', async (req, res) => {
    const { token } = req.body;
    try {
        const tokenResult = await pool.query('SELECT token, admin FROM users WHERE token = $1', [token]);

        if (tokenResult.rowCount === 0) {
            return res.status(400).json(false); // Account does not exist
        } else {
            req.session.token = tokenResult.rows[0].token;
            req.session.admin = tokenResult.rows[0].admin;
            return res.status(200).json(true);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})

// LOGIN Route
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Fetch salt for the given email
        const saltResult = await pool.query('SELECT salt, token FROM users WHERE email = $1', [email]);

        if (saltResult.rowCount === 0) {
            return res.send('acc'); // Account does not exist
        }

        const salt = saltResult.rows[0].salt;

        // Hash the provided password with the stored salt
        const hashedPass = crypto.createHash('sha256').update(password + salt).digest('hex');

        // Fetch stored password
        const passResult = await pool.query('SELECT password, admin FROM users WHERE email = $1', [email]);

        if (passResult.rows[0].password === hashedPass) {
            // Generate a new token
            req.session.token = saltResult.rows[0].token;
            req.session.admin = false;
            if(passResult.rows[0].admin) {
                req.session.admin = true;
            }
            return res.send(saltResult.rows[0].token);
        } else {
            return res.send('pass'); // Incorrect password
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// REGISTER Route
router.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if email already exists
        const emailCheck = await pool.query('SELECT email FROM users WHERE email = $1', [email]);

        if (emailCheck.rowCount !== 0) {
            return res.send('exists'); // Account already exists
        }

        // Generate salt and token
        const salt = generateRandomString(64);
        const token = generateRandomString(32);

        // Hash the password with the salt
        const hashedPass = crypto.createHash('sha256').update(password + salt).digest('hex');

        // Insert new user into database
        await pool.query(
            'INSERT INTO users (email, token, salt, password, verified, data, id, admin) VALUES ($1, $2, $3, $4, false, $5, $6, false)',
            [email, token, salt, hashedPass, "{}", Math.floor(Math.random() * (9000000000)) + 1000000000]
        );
        req.session.token = token;
        req.session.admin = false;
        return res.send(token);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.post('/loadGameData', async (req, res) => {
    const { result } = req.body;

    try {
        const user = await pool.query('SELECT data FROM users WHERE token = $1', [result]);

        if (user.rowCount === 0) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        res.json({ gameData: user.rows[0].data || '{}' }); // Return stored game data or empty object
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.post('/logout', async (req, res) => {
    const token = generateRandomString(32);

    // Update the user's token in the database
    try {
        await pool.query('UPDATE users SET token = $1 WHERE token = $2', [token, req.session.token]);
        req.session.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

// Save Game Data
router.post('/saveGameData', async (req, res) => {
    const { token, localStorageData } = req.body;

    try {
        const user = await pool.query('SELECT email FROM users WHERE token = $1', [token]);

        if (user.rowCount === 0) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        await pool.query('UPDATE users SET data = $1 WHERE token = $2', [localStorageData, token]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/img/:id', (req, res) => {
    const gameName = req.params.id;
    const game = games.find((g) => g.name === gameName);

    if(game.prev) {
        res.sendFile(__dirname + "/static" + game.prev)
    } else {
        res.sendFile(__dirname + "/static/d/" + game.name.replace(/\//g, '') + '.jpg')
    }
})

export default router;