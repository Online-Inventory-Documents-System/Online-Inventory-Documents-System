// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');   // ✅ Added for PDF Reports

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Mongoose / Models =====
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set MONGODB_URI environment variable.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB Atlas'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model('Inventory', InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ===== safer logActivity =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action){
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || 'Unknown';
      const lastAction = last.action || '';
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) {
        return; // avoid duplicates
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ===== Health Check =====
app.get('/api/test', (req, res) =>
  res.json({ success:true, message:'API is up', time: new Date().toISOString() })
);

// ============================================================================
//                               AUTH SYSTEM
// ============================================================================
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return res.status(409).json({ success:false, message:'Username already exists' });

    await User.create({ username, password });
    await logActivity('System', `Registered new user: ${username}`);
    return res.json({ success:true, message:'Registration successful' });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ success:false, message:'Missing credentials' });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success:false, message:'Invalid credentials' });

    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch(err){
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const user = await User.findOne({ username });
    if (!user)
      return res.status(404).json({ message:'User not found' });

    user.password = newPassword;
    await user.save();
    await logActivity(username, 'Changed account password');
    return res.json({ success:true, message:'Password updated successfully' });
  } catch (err) {
    console.error('change password error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/account', async (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message:'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0)
      return res.status(404).json({ message:'User not found' });

    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                                 INVENTORY CRUD
// ============================================================================
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if (!item)
      return res.status(404).json({ message:'Item not found' });

    await logActivity(req.headers['x-username'], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item)
      return res.status(404).json({ message:'Item not found' });

    await logActivity(req.headers['x-username'], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                         PDF REPORT (NEW FEATURE)
// ============================================================================
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    // LEFT HEADER
    doc.fontSize(18).text("L&B Company");
    doc.fontSize(10).text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka");
    doc.text("Phone: 01133127622");
    doc.text("Email: lbcompany@gmail.com");

    // RIGHT HEADER
    doc.fontSize(16).text("INVENTORY SUMMARY", 350, 40);
    doc.fontSize(10).text(`Report #: REP-${Date.now()}`, 350);
    doc.text(`Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, 350);
    doc.text("Status: Generated", 350);

    doc.moveDown(2);

    // TABLE HEADER
    doc.fontSize(12).text("Item", 40, doc.y, { width:120 });
    doc.text("SKU", 160, doc.y, { width:60 });
    doc.text("Qty", 220, doc.y, { width:40 });
    doc.text("Unit Price", 260, doc.y, { width:80 });
    doc.text("Total", 340, doc.y, { width:80 });

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    let subtotal = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unitPrice || 0);
      const total = qty * price;
      subtotal += total;

      doc.fontSize(10);
      doc.text(it.name || "", 40, doc.y, { width:120 });
      doc.text(it.sku || "", 160, doc.y, { width:60 });
      doc.text(String(qty), 220, doc.y, { width:40 });
      doc.text(`RM ${price.toFixed(2)}`, 260, doc.y, { width:80 });
      doc.text(`RM ${total.toFixed(2)}`, 340, doc.y, { width:80 });

      doc.moveDown(0.3);
    });

    doc.moveDown(1);
    doc.fontSize(12).text(`Subtotal: RM ${subtotal.toFixed(2)}`, { align:"right" });

    doc.moveDown(2);
    doc.fontSize(10).text("Thank you for your business.", { align:"center" });
    doc.text("Generated by L&B Inventory System", { align:"center" });

    doc.end();

  } catch (err) {
    console.error('PDF generate error', err);
    return res.status(500).json({ message:"PDF generation failed" });
  }
});

// ============================================================================
//                               XLSX REPORT (UNCHANGED)
// ============================================================================
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`

    const filename = `${filenameBase}.xlsx`;
    const dateOnly = new Date().toISOString().slice(0,10);

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateOnly],
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
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: wb_out.length, date:new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);

  } catch(err){
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// ============================================================================
//                               DOCUMENTS CRUD
// ============================================================================
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date:-1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date:new Date() });
    await logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: doc._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.id);
    if (!doc)
      return res.status(404).json({ message:'Document not found' });

    await logActivity(req.headers['x-username'], `Deleted document metadata: ${doc.name}`);
    return res.status(204).send();
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    return res.redirect('/api/inventory/report');
  }
  return res.status(404).json({ message:"File not found or download unavailable on this mock server." });
});

// ============================================================================
//                                      LOGS
// ============================================================================
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time:-1 }).limit(500).lean();
    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    }));
    return res.json(formatted);
  } catch(err){
    console.error(err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ============================================================================
//                              SERVE FRONTEND
// ============================================================================
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ message:'API route not found' });

  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============================================================================
//                           Start Helpers + Server
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username:'admin', password:'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }

    await logActivity('System', `Server is live on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();

  console.log(`Starting server...`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
