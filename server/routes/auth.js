const express = require("express");
const fs = require("fs");
const router = express.Router();
const USERS_FILE = __dirname + "/../data/users.json";

// ✅ Register new account
router.post("/register", (req, res) => {
    const { username, password } = req.body;

    let users = [];
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE));
    }

    // check existing user
    if (users.find(u => u.username === username)) {
        return res.json({ success: false, message: "User already exists" });
    }

    // save new user
    users.push({ username, password });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    res.json({ success: true });
});

// ✅ Login
router.post("/login", (req, res) => {
    const { username, password } = req.body;

    let users = [];
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE));
    }

    const match = users.find(
        u => u.username === username && u.password === password
    );

    res.json({ success: !!match });
});

module.exports = router;
