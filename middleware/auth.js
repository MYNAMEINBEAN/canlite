import pool from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const verifyUser = async (req, res, next) => {

    try {
        if (!req.session.token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Fetch user token and refresh time
        const result = await pool.query('SELECT token, email FROM users WHERE token = $1', [req.session.token]);

        if (result.rowCount === 0 || result.rows[0].email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        next(); // User is verified, proceed to next route handler
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

export default verifyUser;
