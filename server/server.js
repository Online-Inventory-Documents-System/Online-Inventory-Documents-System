// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require("express");
const cors = require("cors");
const xlsx = require("xlsx");
const mongoose = require("mongoose");
const path = require("path");
const PDFDocument = require("pdfkit");
const fs = require("fs"); // required for saving files
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// =============================================================
// 🔥 CREATE generated_reports folder (PREVENTS ENOTDIR ERROR)
// =============================================================
const REPORTS_DIR = path.join(__dirname, "generated_reports");

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log("📁 created folder: generated_reports");
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== MongoDB Connection =====
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("MongoDB connect error:", err);
    process.exit(1);
  });

const { Schema } = mongoose;

// ===== Schemas =====
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  path: String, // NEW: save real file path
  date: { type: Date, default: Date.now },
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now },
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ===== Duplicate Log Protection =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action) {
  try {
    const safeUser = (user || "Unknown").toString();
    const safeAction = (action || "").toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || "Unknown";
      const lastAction = last.action || "";
      const lastTime = last.time ? new Date(last.time).getTime() : 0;

      if (
        lastUser === safeUser &&
        lastAction === safeAction &&
        now - lastTime <= DUPLICATE_WINDOW_MS
      ) {
        return;
      }
    }

    await ActivityLog.create({
      user: safeUser,
      action: safeAction,
      time: new Date(),
    });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// ============================================================================
//                               AUTH SYSTEM
// ============================================================================
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body || {};

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success: false, message: "Invalid security code" });

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing username or password" });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return res.status(409).json({ success: false, message: "Username already exists" });

    await User.create({ username, password });
    await logActivity("System", `Registered user: ${username}`);

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("register error", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing credentials" });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    await logActivity(username, "Logged in");
    res.json({ success: true, user: username });
  } catch (err) {
    console.error("login error", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============================================================================
//                                 INVENTORY CRUD
// ============================================================================
app.get("/api/inventory", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    res.json(items.map((i) => ({ ...i, id: i._id.toString() })));
  } catch (err) {
    console.error("inventory get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                           PDF REPORT GENERATION
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const user = req.headers["x-username"] || "System";

    // File name
    const fileName = `Inventory_Report_${Date.now()}.pdf`;
    const filePath = path.join(REPORTS_DIR, fileName);

    // Create PDF + Save to file
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream); // Save file
    doc.pipe(res); // Also send to client

    // PDF content
    doc.fontSize(20).text("L&B Company", { align: "left" });
    doc.moveDown();
    doc.fontSize(14).text("INVENTORY REPORT", { align: "left" });
    doc.moveDown();

    items.forEach((it) => {
      doc.fontSize(10).text(
        `${it.sku} | ${it.name} | Qty: ${it.quantity} | RM ${it.unitPrice}`,
        { align: "left" }
      );
    });

    doc.end();

    // Save metadata AFTER PDF saved
    stream.on("finish", async () => {
      await Doc.create({
        name: fileName,
        size: fs.statSync(filePath).size,
        path: filePath,
        date: new Date(),
      });

      await logActivity(user, `Generated PDF Report: ${fileName}`);
    });

    // Headers for browser download
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/pdf");
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// ============================================================================
//                       DOCUMENT DOWNLOAD ROUTE (FIXED)
// ============================================================================
app.get("/api/documents/download/:file", async (req, res) => {
  try {
    const file = req.params.file;
    const record = await Doc.findOne({ name: file }).lean();

    if (!record || !record.path || !fs.existsSync(record.path)) {
      return res.status(404).send("File not found");
    }

    res.download(record.path);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Download failed");
  }
});

// ============================================================================
//                           DOCUMENTS LIST & DELETE
// ============================================================================
app.get("/api/documents", async (req, res) => {
  const docs = await Doc.find({}).sort({ date: -1 }).lean();
  res.json(docs.map((d) => ({ ...d, id: d._id.toString() })));
});

app.delete("/api/documents/:id", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id).lean();
    if (!docu) return res.status(404).json({ message: "Not found" });

    // delete actual file
    if (docu.path && fs.existsSync(docu.path)) {
      fs.unlinkSync(docu.path);
    }

    await Doc.deleteOne({ _id: req.params.id });

    await logActivity(req.headers["x-username"], `Deleted document: ${docu.name}`);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                              ACTIVITY LOGS
// ============================================================================
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(
      logs.map((l) => ({
        user: l.user,
        action: l.action,
        time: l.time ? new Date(l.time).toISOString() : new Date().toISOString(),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                              SERVE FRONTEND
// ============================================================================
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ============================================================================
//                              START SERVER
// ============================================================================
async function ensureDefaultAdmin() {
  const count = await User.countDocuments();
  if (count === 0) {
    await User.create({ username: "admin", password: "password" });
    console.log("Default admin created");
  }
}

(async () => {
  await ensureDefaultAdmin();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
