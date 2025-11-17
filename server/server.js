// ============================================================================
//                          SERVER.JS - FULL COMPLETED
// ============================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
//                            MONGOOSE MODELS
// ============================================================================
const InventorySchema = new mongoose.Schema({
  sku: String,
  name: String,
  category: String,
  quantity: Number,
  unitCost: Number,
  unitPrice: Number
});

const DocSchema = new mongoose.Schema({
  name: String,
  size: Number,
  date: Date,
  data: Buffer,
  contentType: String
});

const ActivityLogSchema = new mongoose.Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
  username: String,
  password: String
});

const Inventory = mongoose.model('Inventory', InventorySchema);
const Doc = mongoose.model('Doc', DocSchema);
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);
const User = mongoose.model('User', UserSchema);

// ============================================================================
//                            MIDDLEWARE
// ============================================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer setup for any file type
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ============================================================================
//                          HELPER FUNCTIONS
// ============================================================================
async function logActivity(user, action) {
  await ActivityLog.create({ user, action, time: new Date() });
}

// ============================================================================
//                            INVENTORY ROUTES
// ============================================================================

// GET all inventory
app.get('/api/inventory', async (req, res) => {
  const items = await Inventory.find({}).lean();
  res.json(items);
});

// POST add inventory item
app.post('/api/inventory', async (req, res) => {
  const item = await Inventory.create(req.body);
  await logActivity(req.headers['x-username'] || 'System', `Added inventory item ${item.name}`);
  res.json(item);
});

// PUT update inventory item
app.put('/api/inventory/:id', async (req, res) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  await logActivity(req.headers['x-username'] || 'System', `Updated inventory item ${item.name}`);
  res.json(item);
});

// DELETE inventory item
app.delete('/api/inventory/:id', async (req, res) => {
  const item = await Inventory.findByIdAndDelete(req.params.id);
  await logActivity(req.headers['x-username'] || 'System', `Deleted inventory item ${item.name}`);
  res.json({ message: 'Deleted' });
});

// ============================================================================
//                   FILE UPLOAD / DOWNLOAD (ANY TYPE)
// ============================================================================

// Upload any file
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const doc = await Doc.create({
      name: req.file.originalname,
      size: req.file.size,
      date: new Date(),
      data: req.file.buffer,
      contentType: req.file.mimetype
    });
    await logActivity(req.headers['x-username'] || 'System', `Uploaded document: ${doc.name}`);
    res.json({ message: 'File uploaded', doc });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// Download file by ID
app.get('/api/documents/download/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
    res.setHeader('Content-Type', doc.contentType);
    res.send(doc.data);

    await logActivity(req.headers['x-username'] || 'System', `Downloaded document: ${doc.name}`);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ message: 'Download failed' });
  }
});

// ============================================================================
//                            PDF REPORT
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    let pdfChunks = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });
    doc.on("data", chunk => pdfChunks.push(chunk));
    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(pdfChunks);
        await Doc.create({ name: filename, size: pdfBuffer.length, date: new Date(), data: pdfBuffer, contentType: "application/pdf" });
        await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`);
      } catch (saveErr) {
        console.error("Failed to save PDF:", saveErr);
      }
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // HEADER
    doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, 40);
    doc.fontSize(10).font("Helvetica");
    doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
    doc.text("Phone: 01133127622", 40, 85);
    doc.text("Email: lbcompany@gmail.com", 40, 100);
    doc.font("Helvetica-Bold").fontSize(15).text("INVENTORY REPORT", 620, 40);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Print Date: ${printDate}`, 620, 63);
    doc.text(`Report ID: ${reportId}`, 620, 78);
    doc.text(`Status: Generated`, 620, 93);
    doc.text(`Printed by: ${printedBy}`, 620, 108);
    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    // TABLE SETTINGS
    const rowHeight = 18;
    const colX = { sku: 40, name: 100, category: 260, qty: 340, cost: 400, price: 480, value: 560, revenue: 670 };
    const width = { sku: 60, name: 160, category: 80, qty: 60, cost: 80, price: 80, value: 110, revenue: 120 };
    let y = 150;

    function drawHeader() {
      doc.font("Helvetica-Bold").fontSize(10);
      for (const col of Object.keys(colX)) doc.rect(colX[col], y, width[col], rowHeight).stroke();
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

      for (const col of Object.keys(colX)) doc.rect(colX[col], y, width[col], rowHeight).stroke();
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

    // TOTAL BOX
    const lastPageIndex = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPageIndex);
    let boxY = y + 20;
    if (boxY > 480) boxY = 480;
    doc.rect(560, boxY, 230, 68).stroke();
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    // FOOTER + PAGE NUMBERS
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).text("Generated by L&B Company Inventory System", 0, doc.page.height - 40, { align: "center" });
      doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: "center" });
    }

    doc.end();
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).json({ message: "PDF generation failed" });
  }
});

// ============================================================================
//                            XLSX REPORT
// ============================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0, 10)}`;
    const filename = `${filenameBase}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0, 10)],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0, totalRevenue = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;
      totalValue += invVal;
      totalRevenue += rev;
      ws_data.push([it.sku || "", it.name || "", it.category || "", qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    await Doc.create({ name: filename, size: wb_out.length, date: new Date(), data: wb_out, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await logActivity(req.headers["x-username"] || "System", `Generated Inventory Report XLSX`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(wb_out);
  } catch (err) {
    console.error("XLSX error", err);
    res.status(500).json({ message: "Report generation failed" });
  }
});

// ============================================================================
//                             ACTIVITY LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(1000).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : null })));
  } catch (err) {
    console.error('logs err', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================================
//                    SERVE FRONTEND & FALLBACK
// ============================================================================
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============================================================================
//                   STARTUP HELPER & SERVER LISTEN
// ============================================================================
async function ensureDefaultAdmin() {
  try {
    const count = await User.countDocuments();
    if (!count) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin created');
      console.log('Default admin created (admin/password)');
    }
  } catch (e) {
    console.error('ensureDefaultAdmin error', e);
  }
}

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/your_db_name', { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('MongoDB connected');
    await ensureDefaultAdmin();
    app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  } catch (err) {
    console.error('Server startup error:', err);
  }
})();
