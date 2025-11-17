// server/server.js
// Full server with GridFS for document storage (3-part file)

// ---------- requires ----------
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PDFDocument = require('pdfkit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ---------- middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- multer (disk storage to avoid memory pressure) ----------
const uploadsDir = path.join(os.tmpdir(), "uploads");
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsDir); },
  filename: function (req, file, cb) {
    // keep original name but prepend timestamp to avoid collisions
    const safe = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '_')}`;
    cb(null, safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB default limit (tweak as needed)

// ---------- mongoose connect ----------
if (!MONGODB_URI) {
  console.error("MONGODB_URI not set. Set env var and restart.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch(err => { console.error("Mongo connect error:", err); process.exit(1); });

const db = mongoose.connection;

// ---------- GridFS bucket (initialises once connection open) ----------
let gfsBucket = null;
db.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(db.db, { bucketName: 'uploads' });
  console.log("GridFSBucket ready");
});

// ---------- Schemas ----------
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const InventorySchema = new Schema({
  sku: String, name: String, category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model('Inventory', InventorySchema);

// Document schema: keep gridFsId when file stored in GridFS
const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  data: Buffer,              // optional (legacy small-file storage)
  contentType: String,
  gridFsId: Schema.Types.ObjectId // reference to GridFS file
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String, action: String, time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ---------- logActivity with duplicate suppression ----------
const DUPLICATE_WINDOW_MS = 30 * 1000;
async function logActivity(user, action) {
  try {
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    const now = Date.now();
    if (last && last.user === user && last.action === action && (now - new Date(last.time).getTime()) <= DUPLICATE_WINDOW_MS) {
      return;
    }
    await ActivityLog.create({ user: user || 'Unknown', action: action || '', time: new Date() });
  } catch (err) {
    console.error('logActivity error', err);
  }
}

// ---------- Health check ----------
app.get('/api/test', (req, res) => res.json({ success: true, time: new Date().toISOString() }));

// ---------- AUTH routes ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, securityCode } = req.body || {};
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid security code' });
    if (!username || !password) return res.status(400).json({ message: 'Missing username or password' });

    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ message: 'Username already exists' });

    await User.create({ username, password });
    await logActivity('System', `Registered user: ${username}`);
    res.json({ success: true, message: 'Registered' });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Missing credentials' });

    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    await logActivity(username, 'Logged in');
    res.json({ success: true, user: username });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---------- Inventory CRUD ----------
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'] || 'Unknown', `Added product: ${item.name}`);
    res.status(201).json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Updated product: ${item.name}`);
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    await logActivity(req.headers['x-username'] || 'Unknown', `Deleted product: ${item.name}`);
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});
// ========== PDF report (generate and store to GridFS) ==========
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();

    // Print date in Asia/Kuala_Lumpur
    const printDate = new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', hour12: true });

    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers['x-username'] || 'System';
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}_${Date.now()}.pdf`;

    // Create PDFDocument and capture chunks
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
    let chunks = [];
    doc.on('data', c => chunks.push(c));

    // When finished building PDF, write buffer to GridFS and DB, but streaming is necessary for client;
    doc.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);

        // Save to GridFS
        if (!gfsBucket) {
          console.warn('GridFS bucket not ready; saving buffer in Doc.data instead (legacy)');
          await Doc.create({ name: filename, size: buffer.length, date: new Date(), data: buffer, contentType: 'application/pdf' });
        } else {
          // upload buffer to GridFS
          const uploadStream = gfsBucket.openUploadStream(filename, { contentType: 'application/pdf' });
          uploadStream.end(buffer);
          uploadStream.on('finish', async (file) => {
            await Doc.create({ name: filename, size: buffer.length, date: new Date(), contentType: 'application/pdf', gridFsId: file._id });
            await logActivity(printedBy, `Generated PDF report: ${filename}`);
          });
          uploadStream.on('error', (err) => console.error('GridFS upload error (PDF):', err));
        }
      } catch (err) {
        console.error('Error saving PDF to DB:', err);
      }
    });

    // Stream PDF to client
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    // --- Render header ---
    doc.fontSize(20).font('Helvetica-Bold').text('L&B Company', 40, 40);
    doc.fontSize(10).font('Helvetica').text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 40, 68);
    doc.text('Phone: 01133127622', 40, 82);
    doc.text('Email: lbcompany@gmail.com', 40, 96);

    doc.fontSize(16).font('Helvetica-Bold').text('INVENTORY REPORT', 620, 40);
    doc.fontSize(10).font('Helvetica').text(`Print Date: ${printDate}`, 620, 66);
    doc.text(`Report ID: ${reportId}`, 620, 80);
    doc.text(`Status: Generated`, 620, 94);
    doc.text(`Printed by: ${printedBy}`, 620, 108);

    doc.moveTo(40, 130).lineTo(800, 130).stroke();

    // --- Table layout (compact, fixed widths) ---
    const rowH = 18;
    const colX = { sku: 40, name: 100, cat: 260, qty: 340, cost: 400, price: 480, val: 560, rev: 650 };
    const colW = { sku: 60, name: 160, cat: 80, qty: 60, cost: 80, price: 80, val: 90, rev: 100 };

    let y = 150;

    function drawHeader() {
      doc.font('Helvetica-Bold').fontSize(10);
      Object.keys(colX).forEach(k => doc.rect(colX[k], y, colW[k], rowH).stroke());
      doc.text('SKU', colX.sku + 3, y + 4);
      doc.text('Product Name', colX.name + 3, y + 4);
      doc.text('Category', colX.cat + 3, y + 4);
      doc.text('Quantity', colX.qty + 3, y + 4);
      doc.text('Unit Cost', colX.cost + 3, y + 4);
      doc.text('Unit Price', colX.price + 3, y + 4);
      doc.text('Total Inventory Value', colX.val + 3, y + 4);
      doc.text('Total Potential Revenue', colX.rev + 3, y + 4);
      y += rowH;
      doc.font('Helvetica').fontSize(9);
    }

    drawHeader();

    let subtotalQty = 0, totalValue = 0, totalRevenue = 0;
    let rowsOnCurrentPage = 0;
    for (const it of items) {
      // force new page after 10 rows (configurable)
      if (rowsOnCurrentPage === 10) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        // header only on page 1 required? you asked earlier: header only page 1 — but here we redraw table header to keep structure on additional pages
        y = 40;
        drawHeader();
        rowsOnCurrentPage = 0;
      }

      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const val = qty * uc;
      const rev = qty * up;

      subtotalQty += qty;
      totalValue += val;
      totalRevenue += rev;

      // draw row boxes
      Object.keys(colX).forEach(k => doc.rect(colX[k], y, colW[k], rowH).stroke());
      doc.text(it.sku || '', colX.sku + 3, y + 4);
      doc.text(it.name || '', colX.name + 3, y + 4);
      doc.text(it.category || '', colX.cat + 3, y + 4);
      doc.text(String(qty), colX.qty + 3, y + 4);
      doc.text(`RM ${uc.toFixed(2)}`, colX.cost + 3, y + 4);
      doc.text(`RM ${up.toFixed(2)}`, colX.price + 3, y + 4);
      doc.text(`RM ${val.toFixed(2)}`, colX.val + 3, y + 4);
      doc.text(`RM ${rev.toFixed(2)}`, colX.rev + 3, y + 4);

      y += rowH;
      rowsOnCurrentPage++;
    }

    // Totals box on last page (bottom-right)
    const lastPageIndex = doc.bufferedPageRange().count - 1;
    doc.switchToPage(lastPageIndex);
    let boxY = y + 20;
    if (boxY > 480) boxY = 480;
    doc.rect(560, boxY, 240, 72).stroke();
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
    doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
    doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);

    // Page numbers + footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(9).font('Helvetica').text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: 'center' });
      doc.text('Generated by L&B Company Inventory System', 0, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('PDF gen error', err);
    res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ========== XLSX report (generate & save to GridFS) ==========
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}_${Date.now()}.xlsx`;

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })],
      [],
      ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
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
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Save XLSX to GridFS if available or fallback to saving buffer in Doc.data
    if (gfsBucket) {
      const uploadStream = gfsBucket.openUploadStream(filename, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      uploadStream.end(buf);
      uploadStream.on('finish', async (file) => {
        await Doc.create({ name: filename, size: buf.length, date: new Date(), gridFsId: file._id, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await logActivity(req.headers['x-username'] || 'System', `Generated XLSX: ${filename}`);
      });
      uploadStream.on('error', err => console.error('GridFS upload error (XLSX):', err));
    } else {
      // fallback: store in Doc.data (not recommended for large files)
      await Doc.create({ name: filename, size: buf.length, date: new Date(), data: buf, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      await logActivity(req.headers['x-username'] || 'System', `Generated XLSX (stored inline): ${filename}`);
    }

    // send file to client
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);

  } catch (err) {
    console.error('XLSX error', err);
    res.status(500).json({ message: 'XLSX generation failed' });
  }
});
// ========== Document upload (file -> GridFS via disk file) ==========
app.post('/api/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Use form field 'file' to upload." });

    const uploadedPath = req.file.path;
    const originalName = req.body.name || req.file.originalname || path.basename(uploadedPath);
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileSize = req.file.size || (fs.existsSync(uploadedPath) ? fs.statSync(uploadedPath).size : 0);
    const username = req.headers['x-username'] || 'System';

    if (!gfsBucket) {
      // If GridFS not ready, fallback to read buffer and store in Doc.data (less ideal)
      const buffer = fs.readFileSync(uploadedPath);
      const doc = await Doc.create({ name: originalName, size: buffer.length, date: new Date(), data: buffer, contentType: mimeType });
      await logActivity(username, `Uploaded ${originalName} (inline)`);
      // remove temp file
      try { fs.unlinkSync(uploadedPath); } catch (e) {}
      return res.status(201).json({ id: doc._id.toString(), name: doc.name });
    }

    // Stream from disk into GridFS
    const readStream = fs.createReadStream(uploadedPath);
    const uploadStream = gfsBucket.openUploadStream(originalName, { contentType: mimeType });

    readStream.pipe(uploadStream)
      .on('error', err => {
        console.error('GridFS streaming error:', err);
        // remove temp file
        try { fs.unlinkSync(uploadedPath); } catch (e) {}
        return res.status(500).json({ message: 'Upload failed' });
      })
      .on('finish', async (file) => {
        try {
          const doc = await Doc.create({
            name: originalName,
            size: fileSize,
            date: new Date(),
            contentType: mimeType,
            gridFsId: file._id
          });
          await logActivity(username, `Uploaded ${originalName}`);
          // remove temp file
          try { fs.unlinkSync(uploadedPath); } catch (e) {}
          res.status(201).json({ id: doc._id.toString(), name: doc.name });
        } catch (err) {
          console.error('DB save error after GridFS upload:', err);
          try { fs.unlinkSync(uploadedPath); } catch (e) {}
          res.status(500).json({ message: 'Server error' });
        }
      });

  } catch (err) {
    console.error('POST /api/documents error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========== Document download (lookup Doc and stream from GridFS or send inline data) ==========
app.get('/api/documents/download/:filename', async (req, res) => {
  try {
    const fname = req.params.filename;
    // exact match required - clients must encodeURIComponent filename
    const doc = await Doc.findOne({ name: fname }).lean();
    if (!doc) {
      // fallback: maybe user requested latest generated report; try prefix match for Inventory_Report*
      if (fname.startsWith('Inventory_Report')) {
        // try to redirect to the main report route (which will generate & stream)
        return res.redirect('/api/inventory/report');
      }
      return res.status(404).json({ message: 'Document not found' });
    }

    if (doc.gridFsId && gfsBucket) {
      // stream from GridFS
      try {
        res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
        res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
        const _id = typeof doc.gridFsId === 'string' ? new mongoose.Types.ObjectId(doc.gridFsId) : doc.gridFsId;
        const downloadStream = gfsBucket.openDownloadStream(_id);
        downloadStream.on('error', err => {
          console.error('GridFS download error', err);
          res.status(500).end();
        });
        return downloadStream.pipe(res);
      } catch (err) {
        console.error('GridFS stream error', err);
        return res.status(500).json({ message: 'Download error' });
      }
    }

    // fallback: inline data field
    if (doc.data && doc.data.length) {
      res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
      res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
      return res.send(doc.data);
    }

    return res.status(404).json({ message: 'Document has no file data' });

  } catch (err) {
    console.error('download error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========== Document list & delete ==========
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    res.json(docs.map(d => ({ id: d._id.toString(), name: d.name, sizeBytes: d.size || 0, date: d.date, hasData: !!(d.data || d.gridFsId) })));
  } catch (err) {
    console.error('GET /api/documents err', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });

    // remove GridFS file if present
    if (doc.gridFsId && gfsBucket) {
      try {
        await gfsBucket.delete(doc.gridFsId);
      } catch (e) { console.warn('GridFS delete warn', e); }
    }

    await Doc.deleteOne({ _id: doc._id });
    await logActivity(req.headers['x-username'] || 'System', `Deleted document: ${doc.name}`);
    res.status(204).send();
  } catch (err) {
    console.error('DELETE /api/documents err', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========== Activity logs ==========
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(1000).lean();
    res.json(logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : null })));
  } catch (err) {
    console.error('logs err', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ========== Serve frontend & fallback ==========
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========== Startup helper & listen ==========
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
  await ensureDefaultAdmin();
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
