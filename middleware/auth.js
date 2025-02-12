const pool = require('../db');

const verifyUser = async (req, res, next) => {
    const { email, token } = req.body;

    try {
        if (!email || !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Fetch user token and refresh time
        const result = await pool.query('SELECT token, refresh FROM users WHERE email = $1', [email]);

        if (result.rowCount === 0 || result.rows[0].token !== token) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        if (result.rows[0].refresh < Date.now() / 1000) {
            return res.status(403).json({ error: 'Token expired' });
        }

        next(); // User is verified, proceed to next route handler
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = verifyUser;
