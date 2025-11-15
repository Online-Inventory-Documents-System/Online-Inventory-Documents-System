const express = require("express");
const fs = require("fs");
const router = express.Router();

const USERS_FILE = __dirname + "/../data/users.json";
const SECURITY_CODE = "1234"; // company code for registration

// Load users
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }
    return JSON.parse(fs.readFileSync(USERS_FILE));
}

// Save users
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* ======================================================
   REGISTER NEW ACCOUNT
====================================================== */
router.post("/register", (req, res) => {
    const { username, password, securityCode, role } = req.body;

    if (!username || !password || !securityCode)
        return res.status(400).json({ success: false, message: "Missing fields" });

    if (securityCode !== SECURITY_CODE)
        return res.status(401).json({ success: false, message: "Invalid security code" });

    const users = loadUsers();

    if (users.find(u => u.username === username))
        return res.status(409).json({ success: false, message: "User already exists" });

    users.push({
        username,
        password,
        role: role || "user",   // default role
        createdAt: new Date().toISOString()
    });

    saveUsers(users);

    return res.json({ success: true, message: "Registration successful" });
});

/* ======================================================
   LOGIN
====================================================== */
router.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password)
        return res.status(400).json({ success: false, message: "Missing credentials" });

    const users = loadUsers();

    const user = users.find(u => u.username === username && u.password === password);

    if (!user)
        return res.status(401).json({ success: false, message: "Invalid username or password" });

    return res.json({
        success: true,
        message: "Login successful",
        user: {
            username: user.username,
            role: user.role
        }
    });
});

module.exports = router;
