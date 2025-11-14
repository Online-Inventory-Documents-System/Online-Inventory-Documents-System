// server/server.js
// Full production-ready server for Online Inventory & Documents System
// - Uses MongoDB (Mongoose)
// - XLSX report generation (xlsx)
// - Simple PDF reports (pdfkit) generated in-memory
// - Serves frontend from ../public
// Make sure `MONGODB_URI` and `SECRET_SECURITY_CODE` are set in env.

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Mongoose connection =====
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set it in environment variables.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB Atlas'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

const { Schema } = mongoose;

// ===== Schemas & Models =====
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

// Sales & Orders
const SalesSchema = new Schema({
  invoice: String,
  product: String,
  quantity: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  date: { type: Date, default: Date.now },
  note: String,
  createdAt: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SalesSchema);

const OrderSchema = new Schema({
  orderNumber: String,
  customer: String,
  items: [{ name: String, qty: Number, price: Number }],
  total: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  date: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// ===== Safer logActivity: suppress immediate duplicate noise =====
const DUPLICATE_WINDOW_MS = 30 * 1000; // 30s

async function logActivity(user, action) {
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = (last.user || 'Unknown').toString();
      const lastAction = (last.action || '').toString();
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && (now - lastTime) <= DUPLICATE_WINDOW_MS) {
        // skip noisy duplicate
        return;
      }
    }

    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// ===== Health check =====
app.get('/api/test', (req, res) => res.json({ success: true, message: 'API is up', time: new Date().toISOString() }));

// ===== Auth =====
app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ success:false, message:'Invalid security code' });
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing username or password' });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists) return res.status(409).json({ success:false, message:'Username already exists' });

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
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing credentials' });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success:false, message:'Invalid credentials' });
    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: username });
  } catch(err){
    console.error('login error', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.put('/api/account/password', async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });
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
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });

  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) {
    console.error('delete account error', err);
    return res.status(500).json({ message:'Server error' });
  }
});

// ===== Inventory CRUD =====
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: String(i._id) }));
    return res.json(normalized);
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: String(item._id) };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndUpdate(id, req.body, { new:true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: String(item._id) };
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Inventory Report (XLSX) - Date (no time) in header =====
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const dateOnly = new Date().toISOString().slice(0,10); // yyyy-mm-dd (no time)

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
      ws_data.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });
    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    // persist document record
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// ===== Documents =====
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: String(d._id) }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: String(doc._id) };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    await logActivity(req.headers['x-username'], `Deleted document metadata: ${doc.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  const filename = req.params.filename || '';
  if (filename.startsWith('Inventory_Report')) {
    return res.redirect('/api/inventory/report');
  }
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// ===== Sales & Orders =====
// Sales routes
app.get('/api/sales', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: String(r._id) }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    const s = await Sale.create({ ...req.body, date: req.body.date ? new Date(req.body.date) : new Date() });
    await logActivity(req.headers['x-username'], `Recorded sale: ${s.product || s.invoice || s._id}`);
    const normalized = { ...s.toObject(), id: String(s._id) };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Sales XLSX
app.get('/api/sales/report', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const filenameBase = `Sales_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ['L&B Company - Sales Report'],
      ['Date:', new Date().toISOString().slice(0,10)],
      [],
      ['Invoice','Product','Quantity','Total','Date','Note']
    ];
    let totalAll = 0;
    rows.forEach(r => {
      const qty = Number(r.quantity || 0);
      const tot = Number(r.total || 0);
      totalAll += tot;
      ws_data.push([r.invoice||'', r.product||'', qty, tot.toFixed(2), r.date ? new Date(r.date).toISOString().slice(0,10) : '', r.note||'']);
    });
    ws_data.push([]);
    ws_data.push(['', '', '', 'Grand Total', totalAll.toFixed(2), '']);
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, ws, 'Sales Report');
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales Report: ${filename}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(wb_out);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Report generation failed' }); }
});

// Sales PDF (simple)
app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const doc = new PDFDocument({ size:'A4', margin:40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;
      await Doc.create({ name: filename, size: pdfBuffer.length, date: new Date() });
      await logActivity(req.headers['x-username'], `Generated Sales PDF: ${filename}`);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(pdfBuffer);
    });
    // PDF content
    doc.fontSize(16).text('L&B - Sales Report', { align:'center' }).moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align:'right' }).moveDown(0.5);
    rows.forEach(r => {
      doc.fontSize(10).text(`${r.invoice||'-'}  |  ${r.product||'-'}  |  QTY: ${r.quantity||0}  |  RM ${Number(r.total||0).toFixed(2)}  |  ${r.date? new Date(r.date).toLocaleDateString() : ''}`);
      doc.moveDown(0.2);
    });
    doc.end();
  } catch (err) { console.error(err); return res.status(500).json({ message:'PDF generation failed' }); }
});

// Orders routes
app.get('/api/orders', async (req, res) => {
  try {
    const rows = await Order.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: String(r._id) }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const o = await Order.create({ ...req.body, date: req.body.date ? new Date(req.body.date) : new Date() });
    await logActivity(req.headers['x-username'], `Created order: ${o.orderNumber || o._id}`);
    const normalized = { ...o.toObject(), id: String(o._id) };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Orders XLSX
app.get('/api/orders/report', async (req, res) => {
  try {
    const rows = await Order.find({}).sort({ date: -1 }).lean();
    const filenameBase = `Orders_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ['L&B Company - Orders Report'],
      ['Date:', new Date().toISOString().slice(0,10)],
      [],
      ['Order #','Customer','Items','Total','Status','Date']
    ];
    let totalAll = 0;
    rows.forEach(r => {
      const itemsText = (r.items || []).map(it => `${it.name||''} x${it.qty||0}`).join('; ');
      totalAll += Number(r.total || 0);
      ws_data.push([r.orderNumber||'', r.customer||'', itemsText, Number(r.total||0).toFixed(2), r.status||'', r.date? new Date(r.date).toISOString().slice(0,10):'']);
    });
    ws_data.push([]);
    ws_data.push(['', '', '', 'Grand Total', totalAll.toFixed(2), '']);
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, ws, 'Orders Report');
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders Report: ${filename}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(wb_out);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Report generation failed' }); }
});

app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const rows = await Order.find({}).sort({ date: -1 }).lean();
    const doc = new PDFDocument({ size:'A4', margin:40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
      await Doc.create({ name: filename, size: pdfBuffer.length, date: new Date() });
      await logActivity(req.headers['x-username'], `Generated Orders PDF: ${filename}`);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(pdfBuffer);
    });
    doc.fontSize(16).text('L&B - Orders Report', { align:'center' }).moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString()}`, { align:'right' }).moveDown(0.5);
    rows.forEach(r => {
      const itemsText = (r.items||[]).map(i => `${i.name||''} x${i.qty||0}`).join(', ');
      doc.fontSize(10).text(`Order ${r.orderNumber||'-'} | ${r.customer||'-'} | ${itemsText} | RM ${Number(r.total||0).toFixed(2)} | ${r.status||''}`);
      doc.moveDown(0.2);
    });
    doc.end();
  } catch (err) { console.error(err); return res.status(500).json({ message:'PDF generation failed' }); }
});

// ===== Logs =====
// Return ISO timestamps — frontend will format into local timezone
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Serve frontend (public folder) =====
app.use(express.static(path.join(__dirname, '../public')));

// SPA fallback (non-API) — send index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== Start server =====
console.log('Starting server (no DB startup log written to ActivityLog)');
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
