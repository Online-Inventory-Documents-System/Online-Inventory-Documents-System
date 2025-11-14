// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System
// Adds Orders & Sales collections, Excel reports, PDF generation, and ZIP-all endpoint.

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

const OrderSchema = new Schema({
  orderNumber: { type: String, required: true },
  customerName: String,
  items: [{ sku: String, name: String, qty: Number, unitPrice: Number }],
  total: { type: Number, default: 0 },
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const SaleSchema = new Schema({
  invoice: { type: String, required: true },
  items: [{ sku: String, name: String, qty: Number, unitPrice: Number }],
  total: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SaleSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// ===== safer logActivity: suppress near-duplicate entries =====
const DUPLICATE_WINDOW_MS = 30 * 1000; // 30 seconds

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
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

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
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndUpdate(id, req.body, { new:true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
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

// ===== Orders CRUD =====
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    const normalized = orders.map(o => ({ ...o, id: o._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.post('/api/orders', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.orderNumber) payload.orderNumber = `ORD-${Date.now()}`;
    const order = await Order.create(payload);
    await logActivity(req.headers['x-username'], `Created order: ${order.orderNumber}`);
    return res.status(201).json({ ...order.toObject(), id: order._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.put('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if(!order) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Updated order: ${order.orderNumber}`);
    return res.json({ ...order.toObject(), id: order._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if(!order) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Deleted order: ${order.orderNumber}`);
    return res.status(204).send();
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Sales CRUD =====
app.get('/api/sales', async (req, res) => {
  try {
    const sales = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = sales.map(s => ({ ...s, id: s._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.post('/api/sales', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.invoice) payload.invoice = `INV-${Date.now()}`;
    const sale = await Sale.create(payload);
    await logActivity(req.headers['x-username'], `Recorded sale: ${sale.invoice}`);
    return res.status(201).json({ ...sale.toObject(), id: sale._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.put('/api/sales/:id', async (req, res) => {
  try {
    const sale = await Sale.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if(!sale) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'], `Updated sale: ${sale.invoice}`);
    return res.json({ ...sale.toObject(), id: sale._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.delete('/api/sales/:id', async (req, res) => {
  try {
    const sale = await Sale.findByIdAndDelete(req.params.id);
    if(!sale) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'], `Deleted sale: ${sale.invoice}`);
    return res.status(204).send();
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Inventory Report (generate XLSX - date only in header) =====
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
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
      ws_data.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
    });
    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    // Persist document record
    const doc = await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// ===== Orders Report (XLSX) =====
app.get('/api/orders/report', async (req, res) => {
  try {
    const orders = await Order.find({}).lean();
    const filenameBase = `Orders_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ["Orders Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Order #","Customer","Items (count)","Total","Status","Created At"]
    ];
    orders.forEach(o => {
      ws_data.push([o.orderNumber || '', o.customerName || '', (o.items||[]).length, Number(o.total||0).toFixed(2), o.status || '', new Date(o.createdAt).toLocaleString()]);
    });
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Orders Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    // persist
    const doc = await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders Report: ${filename}`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Orders report failed' }); }
});

// ===== Sales Report (XLSX) =====
app.get('/api/sales/report', async (req, res) => {
  try {
    const sales = await Sale.find({}).lean();
    const filenameBase = `Sales_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ["Sales Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Invoice","Items (count)","Total","Date"]
    ];
    sales.forEach(s => {
      ws_data.push([s.invoice || '', (s.items||[]).length, Number(s.total||0).toFixed(2), new Date(s.date).toLocaleString()]);
    });
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sales Report");
    const wb_out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
    const doc = await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales Report: ${filename}`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Sales report failed' }); }
});

// ===== PDF Endpoints =====
// /api/pdf/:type  where type = inventory | orders | sales
app.get('/api/pdf/:type', async (req, res) => {
  try {
    const type = (req.params.type || '').toLowerCase();
    const doc = new PDFDocument({ margin: 40 });
    const filename = `${type}_report_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.fontSize(18).text(`L&B Company - ${type.charAt(0).toUpperCase() + type.slice(1)} Report`, { align: 'center' });
    doc.moveDown();

    if (type === 'inventory') {
      const items = await Inventory.find({}).lean();
      doc.fontSize(12);
      doc.text(`Date: ${new Date().toISOString().slice(0,10)}`);
      doc.moveDown();
      items.forEach(it => {
        doc.text(`${it.sku || ''} — ${it.name || ''} — ${it.category || ''} — Qty: ${it.quantity || 0} — UnitCost: RM ${Number(it.unitCost||0).toFixed(2)}`);
      });
      await logActivity(req.headers['x-username'], `Generated Inventory PDF`);
    } else if (type === 'orders') {
      const orders = await Order.find({}).lean();
      doc.fontSize(12);
      doc.text(`Date: ${new Date().toISOString().slice(0,10)}`);
      doc.moveDown();
      orders.forEach(o => {
        doc.text(`${o.orderNumber} — ${o.customerName || ''} — Items: ${(o.items||[]).length} — Total: RM ${Number(o.total||0).toFixed(2)} — ${o.status}`);
      });
      await logActivity(req.headers['x-username'], `Generated Orders PDF`);
    } else if (type === 'sales') {
      const sales = await Sale.find({}).lean();
      doc.fontSize(12);
      doc.text(`Date: ${new Date().toISOString().slice(0,10)}`);
      doc.moveDown();
      sales.forEach(s => {
        doc.text(`${s.invoice} — Items: ${(s.items||[]).length} — Total: RM ${Number(s.total||0).toFixed(2)} — ${new Date(s.date).toLocaleString()}`);
      });
      await logActivity(req.headers['x-username'], `Generated Sales PDF`);
    } else {
      doc.text('Unknown report type');
    }

    doc.end();
    doc.pipe(res);
  } catch(err) {
    console.error('PDF generation error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// legacy convenience redirect endpoints used in client html
app.get('/api/inventory/report/pdf', (req, res) => res.redirect('/api/pdf/inventory'));
app.get('/api/orders/report/pdf', (req, res) => res.redirect('/api/pdf/orders'));
app.get('/api/sales/report/pdf', (req, res) => res.redirect('/api/pdf/sales'));

// ===== ZIP All Reports =====
app.get('/api/reports/zip', async (req, res) => {
  try {
    // create a zip stream
    res.setHeader('Content-Type', 'application/zip');
    const zipName = `All_Reports_${new Date().toISOString().slice(0,10)}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    // generate three xlsx buffers in-memory and append to zip
    // Inventory
    {
      const items = await Inventory.find({}).lean();
      const ws_data = [["Inventory Report"],["Date:", new Date().toISOString().slice(0,10)],[],["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]];
      items.forEach(it => {
        const qty = Number(it.quantity||0), uc = Number(it.unitCost||0), up = Number(it.unitPrice||0);
        ws_data.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), (qty*uc).toFixed(2), (qty*up).toFixed(2)]);
      });
      const ws = xlsx.utils.aoa_to_sheet(ws_data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Inventory");
      const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
      archive.append(buf, { name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    }

    // Orders
    {
      const orders = await Order.find({}).lean();
      const ws_data = [["Orders Report"],["Date:", new Date().toISOString().slice(0,10)],[],["Order #","Customer","Items","Total","Status","Created At"]];
      orders.forEach(o => ws_data.push([o.orderNumber, o.customerName, (o.items||[]).length, Number(o.total||0).toFixed(2), o.status, new Date(o.createdAt).toLocaleString()]));
      const ws = xlsx.utils.aoa_to_sheet(ws_data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Orders");
      const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
      archive.append(buf, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    }

    // Sales
    {
      const sales = await Sale.find({}).lean();
      const ws_data = [["Sales Report"],["Date:", new Date().toISOString().slice(0,10)],[],["Invoice","Items","Total","Date"]];
      sales.forEach(s => ws_data.push([s.invoice, (s.items||[]).length, Number(s.total||0).toFixed(2), new Date(s.date).toLocaleString()]));
      const ws = xlsx.utils.aoa_to_sheet(ws_data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, "Sales");
      const buf = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });
      archive.append(buf, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    }

    await archive.finalize();
  } catch(err) {
    console.error('ZIP creation failed', err);
    return res.status(500).json({ message: 'ZIP creation failed' });
  }
});

// ===== Documents =====
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/documents', async (req, res) => {
  try {
    const doc = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers['x-username'], `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: doc._id.toString() };
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
  if (filename.startsWith('Orders_Report')) {
    return res.redirect('/api/orders/report');
  }
  if (filename.startsWith('Sales_Report')) {
    return res.redirect('/api/sales/report');
  }
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// ===== Logs =====
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    // return ISO timestamps so client formats to local timezone
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Serve frontend =====
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ===== Startup helpers: create default admin if none, single system start log =====
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }
    // Write a single "server live" message (logActivity suppresses near-duplicates)
    await logActivity('System', `Server is live and listening on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

// ===== Start =====
(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log(`Starting server (no DB startup log written to ActivityLog)`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
