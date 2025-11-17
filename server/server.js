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

/ ============================================================================
//                 PDF REPORT — SAVE TO DOCUMENTS + LOG USER ACTION
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const now = new Date();
    const printDate = now.toLocaleString();
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";

    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    // ============================
    // Prepare PDF buffer collector
    // ============================
    let pdfChunks = [];
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true
    });

    // Capture PDF buffer
    doc.on("data", chunk => pdfChunks.push(chunk));
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(pdfChunks);

      // Save PDF record in Document database
      await Doc.create({
        name: filename,
        size: pdfBuffer.length,
        date: new Date()
      });

      // Log user action
      await logActivity(
        printedBy,
        `Generated Inventory Report PDF: ${filename}`
      );
    });

    // Also send PDF to user
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // =====================================================
    // HEADER (Only shown on First Page)
    // =====================================================
    doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, 40);
    doc.fontSize(10).font("Helvetica");
    doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
    doc.text("Phone: 01133127622", 40, 85);
    doc.text("Email: lbcompany@gmail.com", 40, 100);

    doc.font("Helvetica-Bold").fontSize(15)
       .text("INVENTORY REPORT", 620, 40);

    doc.font("Helvetica").fontSize(10);
    doc.text(`Print Date: ${printDate}`, 620, 63);
    doc.text(`Report ID: ${reportId}`, 620, 78);
    doc.text(`Status: Generated`, 620, 93);
    doc.text(`Printed by: ${printedBy}`, 620, 108);

    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    // =====================================================
    // TABLE SETTINGS
    // =====================================================
    const rowHeight = 18;
    const colX = {
      sku: 40, name: 100, category: 260, qty: 340,
      cost: 400, price: 480, value: 560, revenue: 670
    };
    const width = {
      sku: 60, name: 160, category: 80, qty: 60,
      cost: 80, price: 80, value: 110, revenue: 120
    };

    let y = 150;
    let rowsOnPage = 0;

    function drawHeader() {
      doc.font("Helvetica-Bold").fontSize(10);
      for (const col of Object.keys(colX)) {
        doc.rect(colX[col], y, width[col], rowHeight).stroke();
      }
      doc.text("SKU", colX.sku + 3, y + 4);
      doc.text("Product Name", colX.name + 3, y + 4);
      doc.text("Category", colX.category + 3, y + 4);
      doc.text("Quantity", colX.qty + 3, y + 4);
      doc.text("Unit Cost", colX.cost + 3, y + 4);
      doc.text("Unit Price", colX.price + 3, y + 4);
      doc.text("Total Inventory Value", colX.value + 3, y + 4);
      doc.text("Total Potential Revenue", colX.revenue + 3, y + 4);

      y += rowHeight;
      doc.font("Helvetica").fontSize(9);
    }

    drawHeader();

    let subtotalQty = 0, totalValue = 0, totalRevenue = 0;

    // =====================================================
    // TABLE ROWS — max 10 per page
    // =====================================================
    for (const it of items) {
      if (rowsOnPage === 10) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        y = 40;
        rowsOnPage = 0;
        drawHeader();
      }

      const qty = Number(it.quantity || 0);
      const cost = Number(it.unitCost || 0);
      const price = Number(it.unitPrice || 0);
      const val = qty * cost;
      const rev = qty * price;

      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;

      for (const col of Object.keys(colX)) {
        doc.rect(colX[col], y, width[col], rowHeight).stroke();
      }

      doc.text(it.sku || "", colX.sku + 3, y + 4);
      doc.text(it.name || "", colX.name + 3, y + 4);
      doc.text(it.category || "", colX.category + 3, y + 4);
      doc.text(String(qty), colX.qty + 3, y + 4);
      doc.text(`RM ${cost.toFixed(2)}`, colX.cost + 3, y + 4);
      doc.text(`RM ${price.toFixed(2)}`, colX.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, colX.value + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, colX.revenue + 3, y + 4);

      y += rowHeight;
      rowsOnPage++;
    }

    // =====================================================
    // TOTAL BOX (Last Page)
    // =====================================================
    const last = doc.bufferedPageRange().count - 1;
    doc.switchToPage(last);

    let boxY = y + 20;
    if (boxY > 480) boxY = 480;

    doc.rect(560, boxY, 230, 68).stroke();

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    doc.flushPages();

    // =====================================================
    // FOOTER + PAGE NUMBER
    // =====================================================
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text(
        "Generated by L&B Company Inventory System",
        0, doc.page.height - 40,
        { align: "center" }
      );
      doc.text(`Page ${i + 1} of ${pages.count}`,
        0, doc.page.height - 25,
        { align: "center" }
      );
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
