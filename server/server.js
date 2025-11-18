// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');   // PDF generator
// REMOVED: const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Specialized middleware for handling raw file uploads (replacement for Multer)
// Apply only on the upload route
const rawBodyMiddleware = express.raw({
  type: '*/*', // Accept all content types
  limit: '200mb' // increase limit if needed
});

// ===== MongoDB Connection =====
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch(err => {
  console.error("MongoDB connect error:", err);
  process.exit(1);
});

const { Schema } = mongoose;

// ===== Schemas =====
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  // Fields to store file content
  data: Buffer,       // Stores the file content as a Buffer
  contentType: String // Stores the file's MIME type
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
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
      time: new Date()
    });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// ===== Health Check =====
app.get("/api/test", (req, res) => {
  res.json({ success: true, message: "API is up", time: new Date().toISOString() });
});

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
    const normalized = items.map(i => ({
      ...i,
      id: i._id.toString()
    }));
    res.json(normalized);
  } catch (err) {
    console.error("inventory get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/inventory", async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers["x-username"], `Added: ${item.name}`);

    res.status(201).json({
      ...item.toObject(),
      id: item._id.toString()
    });

  } catch (err) {
    console.error("inventory post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item)
      return res.status(404).json({ message: "Item not found" });

    await logActivity(req.headers["x-username"], `Updated: ${item.name}`);
    res.json({
      ...item.toObject(),
      id: item._id.toString()
    });

  } catch (err) {
    console.error("inventory update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item)
      return res.status(404).json({ message: "Item not found" });

    await logActivity(req.headers["x-username"], `Deleted: ${item.name}`);
    res.status(204).send();

  } catch (err) {
    console.error("inventory delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    PDF REPORT — SAVE PDF BYTES + LOG + STREAM
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    let pdfChunks = [];

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40,
      bufferPages: true
    });

    doc.on("data", chunk => pdfChunks.push(chunk));

    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(pdfChunks);
        // Saving the buffer to the 'data' field
        await Doc.create({
          name: filename,
          size: pdfBuffer.length,
          date: new Date(),
          data: pdfBuffer,
          contentType: "application/pdf"
        });
        await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`);
      } catch (saveErr) {
        console.error("Failed to save PDF to documents collection:", saveErr);
      }
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // PDF Generation logic (preserve layout)
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

    const rowHeight = 18;
    const colX = { sku: 40, name: 100, category: 260, qty: 340, cost: 400, price: 480, value: 560, revenue: 670 };
    const width = { sku: 60, name: 160, category: 80, qty: 60, cost: 80, price: 80, value: 110, revenue: 120 };
    let y = 150;

    function drawHeader() {
      doc.font("Helvetica-Bold").fontSize(10);
      doc.rect(colX.sku, y, width.sku, rowHeight).stroke();
      doc.rect(colX.name, y, width.name, rowHeight).stroke();
      doc.rect(colX.category, y, width.category, rowHeight).stroke();
      doc.rect(colX.qty, y, width.qty, rowHeight).stroke();
      doc.rect(colX.cost, y, width.cost, rowHeight).stroke();
      doc.rect(colX.price, y, width.price, rowHeight).stroke();
      doc.rect(colX.value, y, width.value, rowHeight).stroke();
      doc.rect(colX.revenue, y, width.revenue, rowHeight).stroke();
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
    let subtotalQty = 0;
    let totalValue = 0;
    let totalRevenue = 0;
    let rowsOnPage = 0;

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

      doc.rect(colX.sku, y, width.sku, rowHeight).stroke();
      doc.rect(colX.name, y, width.name, rowHeight).stroke();
      doc.rect(colX.category, y, width.category, rowHeight).stroke();
      doc.rect(colX.qty, y, width.qty, rowHeight).stroke();
      doc.rect(colX.cost, y, width.cost, rowHeight).stroke();
      doc.rect(colX.price, y, width.price, rowHeight).stroke();
      doc.rect(colX.value, y, width.value, rowHeight).stroke();
      doc.rect(colX.revenue, y, width.revenue, rowHeight).stroke();
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

    const lastPageIndex = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPageIndex);
    let boxY = y + 20;
    if (boxY > 480) boxY = 480;
    doc.rect(560, boxY, 230, 68).stroke();
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    doc.flushPages();

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text( "Generated by L&B Company Inventory System", 0, doc.page.height - 40, { align: "center" });
      doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: "center" });
    }
    doc.end();

  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// ============================================================================
//                                   XLSX REPORT
// ============================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", now.toISOString().slice(0, 10)],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0;
    let totalRevenue = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        uc.toFixed(2),
        up.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2)
      ]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    await Doc.create({ 
      name: filename, 
      size: wb_out.length, 
      date: new Date(),
      data: wb_out,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    
    await logActivity(req.headers["x-username"], `Generated Inventory Report XLSX`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(wb_out);

  } catch (err) {
    console.error("XLSX error", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});

// ====================== Documents: Upload / List / Delete / Download (Robust) ======================
const { PassThrough } = require('stream'); // at top of file, already required? require again is idempotent

// Helper: normalize many binary shapes into Node Buffer
function normalizeToBuffer(dbData) {
  if (!dbData) return null;
  if (Buffer.isBuffer(dbData)) return dbData;
  // Mongoose Binary type sometimes has .buffer + byteLength
  if (dbData && dbData.buffer && typeof dbData.byteLength === 'number') {
    try { return Buffer.from(dbData.buffer, dbData.byteOffset || 0, dbData.byteLength); } catch (e) {}
  }
  if (dbData instanceof ArrayBuffer) return Buffer.from(new Uint8Array(dbData));
  try { return Buffer.from(dbData); } catch (e) { return null; }
}

function sanitizeFilename(name) {
  if (!name) return 'file';
  const sanitized = String(name).replace(/[\r\n"]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return sanitized.length > 200 ? sanitized.slice(-200) : sanitized;
}

// ------------------ Upload (rawBodyMiddleware must be applied to this route) ------------------
app.post("/api/documents", rawBodyMiddleware, async (req, res) => {
  try {
    // Normalize request body -> Node Buffer
    let fileBuffer = null;
    if (Buffer.isBuffer(req.body)) {
      fileBuffer = req.body;
    } else if (req.body instanceof ArrayBuffer) {
      fileBuffer = Buffer.from(new Uint8Array(req.body));
    } else if (req.body && req.body.buffer && typeof req.body.byteLength === 'number') {
      fileBuffer = Buffer.from(req.body.buffer, req.body.byteOffset || 0, req.body.byteLength);
    } else {
      try { fileBuffer = Buffer.from(req.body); } catch (e) { fileBuffer = null; }
    }

    const contentType = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const fileName = req.headers['x-file-name'] || req.headers['x-filename'] || `file_${Date.now()}`;
    const username = req.headers['x-username'] || 'Unknown';

    if (!fileBuffer || fileBuffer.length === 0) {
      console.warn("Upload: no fileBuffer or empty", { headers: req.headers, len: fileBuffer ? fileBuffer.length : 0 });
      return res.status(400).json({ message: "No file content received or file is empty. Ensure client sends raw bytes and 'X-File-Name' header." });
    }

    // save Buffer into DB
    const docu = await Doc.create({
      name: String(fileName),
      size: fileBuffer.length,
      date: new Date(),
      data: fileBuffer,          // guaranteed Buffer
      contentType: String(contentType)
    });

    console.log(`Upload: saved ${docu.name} size=${docu.size} bytes by user=${username}`);
    await logActivity(username, `Uploaded document: ${docu.name} (${contentType})`);

    return res.status(201).json([{ ...docu.toObject(), id: docu._id.toString() }]);
  } catch (err) {
    console.error("Document upload error:", err);
    return res.status(500).json({ message: "Server error during file storage." });
  }
});

// ------------------ Documents metadata list ------------------
app.get("/api/documents", async (req, res) => {
  try {
    const docs = await Doc.find({}).select('-data').sort({ date: -1 }).lean();
    res.json(docs.map(d => ({ ...d, id: d._id.toString() })));
  } catch (err) {
    console.error("GET /api/documents error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------------ Delete ------------------
app.delete("/api/documents/:id", async (req, res) => {
  try {
    const docu = await Doc.findByIdAndDelete(req.params.id).lean();
    if (!docu) return res.status(404).json({ message: "Document not found" });
    await logActivity(req.headers["x-username"] || 'Unknown', `Deleted document: ${docu.name}`);
    console.log(`Deleted doc ${docu.name} (${docu._id})`);
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/documents/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ------------------ Download by ID (streamed) ------------------
app.get("/api/documents/download/:id", async (req, res) => {
  try {
    const inline = String(req.query.inline || '') === '1';
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "Missing document id" });

    const docu = await Doc.findById(id).lean();
    if (!docu) return res.status(404).json({ message: "Document not found" });

    const buf = normalizeToBuffer(docu.data);
    if (!buf) {
      console.warn("Download: missing/invalid buffer for doc", { id, name: docu.name });
      return res.status(400).json({ message: "File content not present or invalid. Try re-uploading the file." });
    }

    const filename = sanitizeFilename(docu.name || `file-${docu._id}`);
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', docu.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-transform'); // help avoid proxies altering bytes

    // Use PassThrough to stream raw buffer (ensures exact bytes)
    const stream = new PassThrough();
    stream.end(buf);
    stream.pipe(res);

    console.log(`Download: streaming ${filename} size=${buf.length} bytes`);
    await logActivity(req.headers['x-username'] || 'Unknown', `Downloaded document: ${filename}`);
  } catch (err) {
    console.error("Document download error (stream):", err);
    return res.status(500).json({ message: "Server error during download" });
  }
});

// ------------------ Download by name (exact match) ------------------
app.get("/api/documents/download/name/:name", async (req, res) => {
  try {
    const rawName = req.params.name || '';
    const decoded = decodeURIComponent(rawName);
    const docu = await Doc.findOne({ name: decoded }).lean();
    if (!docu) return res.status(404).json({ message: "Document not found by name" });

    const buf = normalizeToBuffer(docu.data);
    if (!buf) {
      console.warn("Download by name: invalid buffer", { name: decoded, id: docu._id });
      return res.status(400).json({ message: "File content not present or invalid. Try re-uploading the file." });
    }

    const inline = String(req.query.inline || '') === '1';
    const filename = sanitizeFilename(docu.name || `file-${docu._id}`);
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', docu.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-transform');

    const stream = new PassThrough();
    stream.end(buf);
    stream.pipe(res);

    console.log(`Download by name: streaming ${filename} size=${buf.length} bytes`);
    await logActivity(req.headers['x-username'] || 'Unknown', `Downloaded document by name: ${filename}`);
  } catch (err) {
    console.error("Document download by name error:", err);
    return res.status(500).json({ message: "Server error during download by name" });
  }
});

// ------------------ Temporary debug route (call and remove later) ------------------
app.get('/debug/doc/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    const buf = normalizeToBuffer(doc.data);
    const firstHex = buf ? buf.slice(0, 32).toString('hex') : null;
    const firstAscii = buf ? buf.slice(0, 32).toString('utf8').replace(/[^\x20-\x7E]/g, '.') : null;
    const base64Preview = buf ? buf.slice(0, 128).toString('base64') : null;
    res.json({
      id: doc._id,
      name: doc.name,
      size: doc.size,
      contentType: doc.contentType,
      hasBuffer: !!buf,
      firstHex,
      firstAscii,
      base64Preview
    });
  } catch (e) {
    console.error('debug doc error', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================================
//                               ACTIVITY LOGS
// ============================================================================
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    })));
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
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ message: "API route not found" });

  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ============================================================================
//                        STARTUP HELPER + START SERVER
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin user created");
    }
    await logActivity("System", `Server started on port ${PORT}`);
  } catch (err) {
    console.error("Startup error:", err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log("Starting server...");
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
