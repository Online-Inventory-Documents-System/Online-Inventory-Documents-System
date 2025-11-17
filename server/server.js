// ============================================================================
// server/server.js  — FULL UPDATED VERSION (Render Single-Service Compatible)
// ============================================================================

const express = require("express");
const cors = require("cors");
const xlsx = require("xlsx");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ============================================================================
// MongoDB Connection
// ============================================================================
if (!MONGODB_URI) {
  console.error("❌ ERROR: Missing MONGODB_URI in Render Environment");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB ERROR:", err);
    process.exit(1);
  });

const { Schema } = mongoose;

// ============================================================================
// Schemas
// ============================================================================
const UserSchema = new Schema({
  username: String,
  password: String,
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: Number,
  unitCost: Number,
  unitPrice: Number,
  createdAt: { type: Date, default: Date.now },
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now },
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ============================================================================
// Ensure report folder exists
// ============================================================================
const REPORT_DIR = path.join(__dirname, "generated_reports");

if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  console.log("📁 created:", REPORT_DIR);
}

// ============================================================================
// Middleware
// ============================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// Log System (duplicate protection)
// ============================================================================
const DUP_WINDOW = 30_000;

async function logActivity(user, action) {
  const safeUser = user || "System";
  const safeAction = action || "";

  const last = await ActivityLog.findOne().sort({ time: -1 }).lean();
  const now = Date.now();

  if (last) {
    const tooSoon = now - new Date(last.time).getTime() <= DUP_WINDOW;
    if (last.user === safeUser && last.action === safeAction && tooSoon) return;
  }

  await ActivityLog.create({ user: safeUser, action: safeAction });
}

// ============================================================================
// AUTH
// ============================================================================
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success: false, message: "Invalid security code" });

  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ success: false, message: "User exists" });

  await User.create({ username, password });
  await logActivity("System", `Registered new user ${username}`);

  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username, password });
  if (!user)
    return res.status(401).json({ success: false, message: "Invalid login" });

  await logActivity(username, "Logged in");
  res.json({ success: true, user: username });
});

// ============================================================================
// INVENTORY CRUD
// ============================================================================
app.get("/api/inventory", async (req, res) => {
  const items = await Inventory.find({}).lean();
  res.json(items.map((i) => ({ ...i, id: i._id.toString() })));
});

app.post("/api/inventory", async (req, res) => {
  const item = await Inventory.create(req.body);
  await logActivity(req.headers["x-username"], `Added: ${item.name}`);
  res.json({ ...item.toObject(), id: item._id.toString() });
});

app.put("/api/inventory/:id", async (req, res) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) return res.status(404).json({ message: "Not found" });

  await logActivity(req.headers["x-username"], `Updated: ${item.name}`);
  res.json({ ...item.toObject(), id: item._id.toString() });
});

app.delete("/api/inventory/:id", async (req, res) => {
  const item = await Inventory.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: "Not found" });

  await logActivity(req.headers["x-username"], `Deleted: ${item.name}`);
  res.status(204).send();
});

// ============================================================================
// PDF REPORT (with save + download)
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;
    const filePath = path.join(REPORT_DIR, filename);

    let chunks = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", bufferPages: true });

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", async () => {
      const buffer = Buffer.concat(chunks);

      // Save to server folder
      fs.writeFileSync(filePath, buffer);

      // Save metadata to DB
      await Doc.create({
        name: filename,
        size: buffer.length,
        date: new Date(),
      });

      await logActivity(req.headers["x-username"], `Generated PDF: ${filename}`);
    });

    // Send file to browser
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // === PDF CONTENT ===
    doc.fontSize(20).text("L&B Company — Inventory Report", 40, 40);
    doc.fontSize(10).text("Generated on: " + now.toLocaleString(), 40, 65);

    let y = 110;

    doc.fontSize(12).text("SKU", 40, y);
    doc.text("Name", 120, y);
    doc.text("Category", 300, y);
    doc.text("Qty", 420, y);
    doc.text("Cost", 500, y);
    doc.text("Price", 580, y);
    doc.text("Value", 660, y);

    y += 25;

    items.forEach((it) => {
      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);
      const val = qty * cost;

      doc.fontSize(10).text(it.sku, 40, y);
      doc.text(it.name, 120, y);
      doc.text(it.category, 300, y);
      doc.text(String(qty), 420, y);
      doc.text("RM " + cost.toFixed(2), 500, y);
      doc.text("RM " + price.toFixed(2), 580, y);
      doc.text("RM " + val.toFixed(2), 660, y);

      y += 20;
    });

    // FOOTER
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).text(
        "Generated by L&B Company Inventory System",
        0,
        doc.page.height - 40,
        { align: "center" }
      );
      doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 28, {
        align: "center",
      });
    }

    doc.end();
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// ============================================================================
// XLSX REPORT
// ============================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const filename = `Inventory_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const ws_data = [
      ["Inventory Report"],
      ["Generated On", new Date().toLocaleString()],
      [],
      [
        "SKU",
        "Name",
        "Category",
        "Quantity",
        "Unit Cost",
        "Unit Price",
        "Total Value",
      ],
    ];

    items.forEach((it) => {
      const qty = Number(it.quantity);
      const cost = Number(it.unitCost);
      const price = Number(it.unitPrice);

      ws_data.push([
        it.sku,
        it.name,
        it.category,
        qty,
        cost.toFixed(2),
        price.toFixed(2),
        (qty * cost).toFixed(2),
      ]);
    });

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Report");

    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    // Save to DB
    await Doc.create({
      name: filename,
      size: buffer.length,
      date: new Date(),
    });

    // Log
    await logActivity(req.headers["x-username"], `Generated XLSX Report`);

    // Send file
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("XLSX Error:", err);
    res.status(500).json({ message: "XLSX generation failed" });
  }
});

// ============================================================================
// DOCUMENTS
// ============================================================================
app.get("/api/documents", async (req, res) => {
  const docs = await Doc.find({}).sort({ date: -1 }).lean();
  res.json(docs.map((d) => ({ ...d, id: d._id.toString() })));
});

// Download saved PDFs
app.get("/api/documents/download/:name", (req, res) => {
  const name = req.params.name;
  const filePath = path.join(REPORT_DIR, name);

  if (!fs.existsSync(filePath))
    return res.status(404).json({ message: "File not found" });

  res.download(filePath);
});

// Delete metadata
app.delete("/api/documents/:id", async (req, res) => {
  await Doc.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

// ============================================================================
// ACTIVITY LOGS
// ============================================================================
app.get("/api/logs", async (req, res) => {
  const logs = await ActivityLog.find().sort({ time: -1 }).limit(500).lean();
  res.json(
    logs.map((l) => ({
      user: l.user,
      action: l.action,
      time: l.time,
    }))
  );
});

// ============================================================================
// STATIC FRONTEND SERVE
// ============================================================================
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
