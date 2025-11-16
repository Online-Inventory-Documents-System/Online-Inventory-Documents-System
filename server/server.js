// server/server.js
// Online Inventory & Document System (FINAL STABLE VERSION)

const express = require("express");
const cors = require("cors");
const xlsx = require("xlsx");
const mongoose = require("mongoose");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// -------------------------------------------------------------
// Middleware
// -------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------------
// MongoDB Connection
// -------------------------------------------------------------
if (!MONGODB_URI) {
  console.error("MONGODB_URI missing");
  process.exit(1);
}

mongoose.set("strictQuery", false);

mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error", err);
    process.exit(1);
  });

// -------------------------------------------------------------
// Schemas
// -------------------------------------------------------------
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true },
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

// -------------------------------------------------------------
// Activity Log (Duplicate Prevention)
// -------------------------------------------------------------
const DUPLICATE_WINDOW_MS = 30000;

async function logActivity(user, action) {
  try {
    const safeUser = user || "Unknown";
    const safeAction = action || "";
    const now = Date.now();

    const last = await ActivityLog.findOne().sort({ time: -1 }).lean();
    if (last) {
      const lastTime = new Date(last.time).getTime();
      if (
        last.user === safeUser &&
        last.action === safeAction &&
        now - lastTime <= DUPLICATE_WINDOW_MS
      ) {
        return;
      }
    }

    await ActivityLog.create({ user: safeUser, action: safeAction });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// -------------------------------------------------------------
// Health Check
// -------------------------------------------------------------
app.get("/api/test", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// -------------------------------------------------------------
// Auth System
// -------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: "Invalid security code" });

  if (!username || !password)
    return res.status(400).json({ message: "Missing data" });

  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ message: "Username exists" });

  await User.create({ username, password });
  await logActivity("System", `Registered user: ${username}`);

  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });

  if (!user) return res.status(401).json({ message: "Invalid login" });

  await logActivity(username, "Logged in");
  res.json({ success: true, user: username });
});

// -------------------------------------------------------------
// Inventory CRUD
// -------------------------------------------------------------
app.get("/api/inventory", async (req, res) => {
  const items = await Inventory.find().lean();
  res.json(items.map((i) => ({ ...i, id: i._id.toString() })));
});

app.post("/api/inventory", async (req, res) => {
  const item = await Inventory.create(req.body);
  await logActivity(req.headers["x-username"], `Added: ${item.name}`);
  res.status(201).json({ ...item.toObject(), id: item._id.toString() });
});

app.put("/api/inventory/:id", async (req, res) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
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
// -------------------------------------------------------------
// PDF REPORT — FINAL OPTIMIZED VERSION
// -------------------------------------------------------------
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find().lean();

    const now = new Date();
    const printDate = now.toLocaleString();
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";

    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}.pdf`;

    // PDF settings
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    // ===== HEADER (PAGE 1 ONLY) =====
    function drawHeader() {
      // Left
      doc.font("Helvetica-Bold").fontSize(22).text("L&B Company", 40, 40);
      doc.font("Helvetica").fontSize(10);
      doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
      doc.text("Phone: 01133127622", 40, 85);
      doc.text("Email: lbcompany@gmail.com", 40, 100);

      // Right block
      const x = 620;
      doc.font("Helvetica-Bold").fontSize(15).text("INVENTORY REPORT", x, 40);

      doc.font("Helvetica").fontSize(10);
      doc.text(`Print Date: ${printDate}`, x, 63);
      doc.text(`Report ID: ${reportId}`, x, 78);
      doc.text("Status: Generated", x, 93);
      doc.text(`Printed by: ${printedBy}`, x, 108);

      doc.moveTo(40, 130).lineTo(800, 130).stroke();
    }

    drawHeader();

    // ===== TABLE COLUMNS =====
    const rowHeight = 18;

    const cols = {
      sku: 40,
      name: 100,
      category: 260,
      qty: 340,
      cost: 400,
      price: 480,
      value: 560,
      revenue: 670,
    };

    const widths = {
      sku: 60,
      name: 160,
      category: 80,
      qty: 60,
      cost: 80,
      price: 80,
      value: 110,
      revenue: 120,
    };

    let y = 150;

    // ===== TABLE HEADER =====
    function drawTableHeader() {
      doc.font("Helvetica-Bold").fontSize(10);

      doc.rect(cols.sku, y, widths.sku, rowHeight).stroke();
      doc.rect(cols.name, y, widths.name, rowHeight).stroke();
      doc.rect(cols.category, y, widths.category, rowHeight).stroke();
      doc.rect(cols.qty, y, widths.qty, rowHeight).stroke();
      doc.rect(cols.cost, y, widths.cost, rowHeight).stroke();
      doc.rect(cols.price, y, widths.price, rowHeight).stroke();
      doc.rect(cols.value, y, widths.value, rowHeight).stroke();
      doc.rect(cols.revenue, y, widths.revenue, rowHeight).stroke();

      doc.text("SKU", cols.sku + 3, y + 4);
      doc.text("Product Name", cols.name + 3, y + 4);
      doc.text("Category", cols.category + 3, y + 4);
      doc.text("Quantity", cols.qty + 3, y + 4);
      doc.text("Unit Cost", cols.cost + 3, y + 4);
      doc.text("Unit Price", cols.price + 3, y + 4);
      doc.text("Total Inventory Value", cols.value + 3, y + 4);
      doc.text("Total Potential Revenue", cols.revenue + 3, y + 4);

      y += rowHeight;
      doc.font("Helvetica").fontSize(9);
    }

    drawTableHeader();

    // ===== TABLE ROWS =====
    let subtotalQty = 0;
    let totalValue = 0;
    let totalRevenue = 0;

    for (const it of items) {
      // Page overflow → new page
      if (y + rowHeight > 530) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        y = 40;
        drawTableHeader();
      }

      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);

      const val = qty * cost;
      const rev = qty * price;

      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;

      // Draw borders
      doc.rect(cols.sku, y, widths.sku, rowHeight).stroke();
      doc.rect(cols.name, y, widths.name, rowHeight).stroke();
      doc.rect(cols.category, y, widths.category, rowHeight).stroke();
      doc.rect(cols.qty, y, widths.qty, rowHeight).stroke();
      doc.rect(cols.cost, y, widths.cost, rowHeight).stroke();
      doc.rect(cols.price, y, widths.price, rowHeight).stroke();
      doc.rect(cols.value, y, widths.value, rowHeight).stroke();
      doc.rect(cols.revenue, y, widths.revenue, rowHeight).stroke();

      // Text
      doc.text(it.sku || "", cols.sku + 3, y + 4);
      doc.text(it.name || "", cols.name + 3, y + 4);
      doc.text(it.category || "", cols.category + 3, y + 4);
      doc.text(String(qty), cols.qty + 3, y + 4);
      doc.text(`RM ${cost.toFixed(2)}`, cols.cost + 3, y + 4);
      doc.text(`RM ${price.toFixed(2)}`, cols.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, cols.value + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, cols.revenue + 3, y + 4);

      y += rowHeight;
    }

    // ===== TOTALS BOX ON LAST PAGE =====
    function drawTotals() {
      const boxX = 560;
      const boxWidth = 230;
      const boxHeight = 68;

      let boxY = y + 15;
      if (boxY < 200) boxY = 200;

      doc.rect(boxX, boxY, boxWidth, boxHeight).stroke();

      doc.font("Helvetica-Bold").fontSize(10);

      doc.text(`Subtotal (Quantity): ${subtotalQty} units`, boxX + 10, boxY + 10);
      doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, boxX + 10, boxY + 28);
      doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, boxX + 10, boxY + 46);
    }

    drawTotals();

    // ===== FOOTER + PAGE NUMBERS =====
    const range = doc.bufferedPageRange();

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);

      // Page number (all pages)
      doc.font("Helvetica").fontSize(9);
      doc.text(`Page ${i + 1} of ${range.count}`, 0, doc.page.height - 30, {
        align: "center",
      });

      // Footer (all pages)
      doc.text("Generated by L&B Inventory System", 0, doc.page.height - 42, {
        align: "center",
      });
    }

    doc.end();
// -------------------------------------------------------------
// XLSX REPORT (unchanged, stable)
// -------------------------------------------------------------
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find().lean();

    const dateOnly = new Date().toISOString().slice(0, 10);
    const filename = `Inventory_Report_${dateOnly}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateOnly],
      [],
      [
        "SKU",
        "Name",
        "Category",
        "Quantity",
        "Unit Cost",
        "Unit Price",
        "Total Inventory Value",
        "Total Potential Revenue",
      ],
    ];

    let totalValue = 0;
    let totalRevenue = 0;

    items.forEach((it) => {
      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);

      const invVal = qty * cost;
      const rev = qty * price;

      totalValue += invVal;
      totalRevenue += rev;

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        cost.toFixed(2),
        price.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2),
      ]);
    });

    ws_data.push([]);
    ws_data.push([
      "",
      "",
      "",
      "Totals",
      "",
      "",
      totalValue.toFixed(2),
      totalRevenue.toFixed(2),
    ]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");

    const buffer = xlsx.write(wb, { bookType: "xlsx", type: "buffer" });

    await Doc.create({
      name: filename,
      size: buffer.length,
      date: new Date(),
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(buffer);
  } catch (err) {
    console.error("XLSX error:", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});

// -------------------------------------------------------------
// DOCUMENTS CRUD
// -------------------------------------------------------------
app.get("/api/documents", async (req, res) => {
  try {
    const docs = await Doc.find().sort({ date: -1 }).lean();
    res.json(docs.map((d) => ({ ...d, id: d._id.toString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/documents", async (req, res) => {
  try {
    const file = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers["x-username"], `Uploaded: ${file.name}`);

    res
      .status(201)
      .json({ ...file.toObject(), id: file._id.toString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/documents/:id", async (req, res) => {
  try {
    const file = await Doc.findByIdAndDelete(req.params.id);
    if (!file) return res.status(404).json({ message: "Not found" });

    await logActivity(req.headers["x-username"], `Deleted: ${file.name}`);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Allow XLSX re-download
app.get("/api/documents/download/:filename", (req, res) => {
  const file = req.params.filename;
  if (file.startsWith("Inventory_Report")) {
    return res.redirect("/api/inventory/report");
  }
  return res.status(404).json({ message: "File not stored on server" });
});

// -------------------------------------------------------------
// ACTIVITY LOGS
// -------------------------------------------------------------
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .sort({ time: -1 })
      .limit(500)
      .lean();

    const formatted = logs.map((l) => ({
      user: l.user,
      action: l.action,
      time: new Date(l.time).toISOString(),
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// -------------------------------------------------------------
// SERVE FRONTEND
// -------------------------------------------------------------
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "API route not found" });
  }
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
async function ensureDefaultAdmin() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin created");
    }
  } catch (err) {
    console.error("Startup error:", err);
  }
}

(async () => {
  await ensureDefaultAdmin();
  console.log("Starting server...");
  app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
  );
})();
