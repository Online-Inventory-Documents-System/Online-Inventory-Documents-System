// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System
// Includes Orders & Sales collections, XLSX + PDF report generation, and ZIP-all-reports endpoint.

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const stream = require('stream');

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

// Orders: customerName, items (array {sku,name,qty,price}), total, status, orderNumber, date
const OrdersSchema = new Schema({
  orderNumber: { type: String, default: () => `ORD-${Date.now()}` },
  customerName: String,
  items: [{ sku: String, name: String, qty: Number, price: Number }],
  total: { type: Number, default: 0 },
  status: { type: String, default: 'Pending' }, // Pending / Approved / Cancelled
  date: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrdersSchema);

// Sales: invoice, product (SKU/Name), quantity, total, date
const SalesSchema = new Schema({
  invoice: { type: String, default: () => `INV-${Date.now()}` },
  sku: String,
  product: String,
  quantity: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SalesSchema);

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

// ===== Sales CRUD =====
app.get('/api/sales', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: r._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    const s = await Sale.create(req.body);
    await logActivity(req.headers['x-username'], `Recorded sale: ${s.product || s.invoice}`);
    return res.status(201).json({ ...s.toObject(), id: s._id.toString() });
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/sales/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const s = await Sale.findByIdAndUpdate(id, req.body, { new: true });
    if (!s) return res.status(404).json({ message: 'Sale not found' });
    await logActivity(req.headers['x-username'], `Updated sale: ${s.invoice}`);
    return res.json({ ...s.toObject(), id: s._id.toString() });
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const s = await Sale.findByIdAndDelete(req.params.id);
    if (!s) return res.status(404).json({ message: 'Sale not found' });
    await logActivity(req.headers['x-username'], `Deleted sale: ${s.invoice}`);
    return res.status(204).send();
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Orders CRUD =====
app.get('/api/orders', async (req, res) => {
  try {
    const rows = await Order.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: r._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    // ensure orderNumber uniqueness when created
    if (!body.orderNumber) body.orderNumber = `ORD-${Date.now()}`;
    const o = await Order.create(body);
    await logActivity(req.headers['x-username'], `Created order: ${o.orderNumber} (${o.customerName})`);
    return res.status(201).json({ ...o.toObject(), id: o._id.toString() });
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const o = await Order.findByIdAndUpdate(id, req.body, { new: true });
    if (!o) return res.status(404).json({ message: 'Order not found' });
    await logActivity(req.headers['x-username'], `Updated order: ${o.orderNumber}`);
    return res.json({ ...o.toObject(), id: o._id.toString() });
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const o = await Order.findByIdAndDelete(req.params.id);
    if (!o) return res.status(404).json({ message: 'Order not found' });
    await logActivity(req.headers['x-username'], `Deleted order: ${o.orderNumber}`);
    return res.status(204).send();
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Reports generation helpers =====

function buildInventoryXLSX(items) {
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
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx` };
}

function buildSalesXLSX(rows) {
  const dateOnly = new Date().toISOString().slice(0,10);
  const ws_data = [
    ["L&B Company - Sales Report"],
    ["Date:", dateOnly],
    [],
    ["Invoice","SKU","Product","Quantity","Total (RM)","Date"]
  ];
  let grandTotal = 0;
  rows.forEach(r => {
    ws_data.push([r.invoice||'', r.sku||'', r.product||'', r.quantity||0, (Number(r.total)||0).toFixed(2), r.date ? new Date(r.date).toLocaleString() : '']);
    grandTotal += Number(r.total || 0);
  });
  ws_data.push([]);
  ws_data.push(["", "", "", "Grand Total", grandTotal.toFixed(2)]);
  const ws = xlsx.utils.aoa_to_sheet(ws_data);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sales Report");
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: `Sales_Report_${dateOnly}.xlsx` };
}

function buildOrdersXLSX(rows) {
  const dateOnly = new Date().toISOString().slice(0,10);
  const ws_data = [
    ["L&B Company - Orders Report"],
    ["Date:", dateOnly],
    [],
    ["Order #","Customer","Items","Total (RM)","Status","Date"]
  ];
  rows.forEach(o => {
    const itemsSummary = (Array.isArray(o.items) ? o.items.map(i => `${i.name} x${i.qty}`).join('; ') : '');
    ws_data.push([o.orderNumber||'', o.customerName||'', itemsSummary, (Number(o.total)||0).toFixed(2), o.status||'', o.date ? new Date(o.date).toLocaleString() : '']);
  });
  const ws = xlsx.utils.aoa_to_sheet(ws_data);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Orders Report");
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: `Orders_Report_${dateOnly}.xlsx` };
}

async function generatePdfBufferFromRows(title, headers, rows, rowFormatter) {
  // Returns a Buffer of generated PDF
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const passthrough = new stream.PassThrough();
      const chunks = [];
      passthrough.on('data', chunk => chunks.push(chunk));
      passthrough.on('end', () => resolve(Buffer.concat(chunks)));
      passthrough.on('error', reject);

      doc.pipe(passthrough);

      // Header
      doc.fontSize(16).text(title, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
      doc.moveDown();

      // Table header
      const tableTop = doc.y + 5;
      doc.fontSize(10);
      // compute column widths evenly across page width (approx)
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = Math.floor(pageWidth / headers.length);

      // header row background
      headers.forEach((h, i) => {
        doc.rect(doc.x + (i * colWidth), doc.y, colWidth, 18).fill('#eeeeee').stroke();
      });
      doc.fillColor('black');

      headers.forEach((h, i) => {
        doc.text(h, doc.x + (i * colWidth) + 4, doc.y + 4, { width: colWidth - 6, align: 'left' });
      });
      doc.moveDown(1.5);

      // rows
      rows.forEach((r, idx) => {
        const yBefore = doc.y;
        const lineHeight = 14;
        const cells = rowFormatter(r);
        cells.forEach((c, i) => {
          doc.text(String(c), doc.x + (i * colWidth) + 4, yBefore, { width: colWidth - 6, align: 'left' });
        });
        doc.moveDown(1);
        // page break handling
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ===== Inventory Report endpoints (XLSX + PDF) =====
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const { buf, filename } = buildInventoryXLSX(items);
    // Persist document record
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  } catch (err) {
    console.error('inventory xlsx error', err);
    return res.status(500).json({ message: 'Report generation failed' });
  }
});

app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const title = "L&B Company - Inventory Report";
    const headers = ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Inventory Value"];
    const rows = items.map(it => ({
      sku: it.sku||'',
      name: it.name||'',
      category: it.category||'',
      qty: Number(it.quantity||0),
      unitCost: (Number(it.unitCost||0)).toFixed(2),
      unitPrice: (Number(it.unitPrice||0)).toFixed(2)
    }));
    const buf = await generatePdfBufferFromRows(title, headers, rows, r => [
      r.sku, r.name, r.category, r.qty, r.unitCost, r.unitPrice, (Number(r.qty) * Number(r.unitCost)).toFixed(2)
    ]);
    const filename = `Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory PDF: ${filename}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(buf);
  } catch (err) {
    console.error('inventory pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== Sales report endpoints =====
app.get('/api/sales/report', async (req, res) => {
  try {
    const rows = await Sale.find({}).lean();
    const { buf, filename } = buildSalesXLSX(rows);
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Sales Report: ${filename}`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  } catch (err) {
    console.error('sales xlsx error', err);
    return res.status(500).json({ message: 'Report generation failed' });
  }
});

app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const rows = await Sale.find({}).lean();
    const title = "L&B Company - Sales Report";
    const headers = ["Invoice","SKU","Product","Qty","Total (RM)","Date"];
    const buf = await generatePdfBufferFromRows(title, headers, rows, r => [
      r.invoice || '', r.sku || '', r.product || '', r.quantity || 0, (Number(r.total)||0).toFixed(2), r.date ? new Date(r.date).toLocaleString() : ''
    ]);
    const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Sales PDF: ${filename}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(buf);
  } catch (err) {
    console.error('sales pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== Orders report endpoints =====
app.get('/api/orders/report', async (req, res) => {
  try {
    const rows = await Order.find({}).lean();
    const { buf, filename } = buildOrdersXLSX(rows);
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Orders Report: ${filename}`);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buf);
  } catch (err) {
    console.error('orders xlsx error', err);
    return res.status(500).json({ message: 'Report generation failed' });
  }
});

app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const rows = await Order.find({}).lean();
    const title = "L&B Company - Orders Report";
    const headers = ["Order #","Customer","Items","Total (RM)","Status","Date"];
    const buf = await generatePdfBufferFromRows(title, headers, rows, r => {
      const itemsSummary = (Array.isArray(r.items) ? r.items.map(i => `${i.name} x${i.qty}`).join('; ') : '');
      return [ r.orderNumber || '', r.customerName || '', itemsSummary, (Number(r.total)||0).toFixed(2), r.status || '', r.date ? new Date(r.date).toLocaleString() : '' ];
    });
    const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    await Doc.create({ name: filename, size: buf.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Orders PDF: ${filename}`);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(buf);
  } catch (err) {
    console.error('orders pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== ZIP All Reports endpoint =====
app.get('/api/reports/zip', async (req, res) => {
  try {
    // Build three XLSX buffers in memory
    const items = await Inventory.find({}).lean();
    const salesRows = await Sale.find({}).lean();
    const ordersRows = await Order.find({}).lean();

    const inv = buildInventoryXLSX(items);
    const sales = buildSalesXLSX(salesRows);
    const orders = buildOrdersXLSX(ordersRows);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="All_Reports_${new Date().toISOString().slice(0,10)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 }});
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    archive.append(inv.buf, { name: inv.filename });
    archive.append(sales.buf, { name: sales.filename });
    archive.append(orders.buf, { name: orders.filename });

    await archive.finalize();
    await logActivity(req.headers['x-username'], `Generated ZIP containing all reports`);
  } catch (err) {
    console.error('zip error', err);
    return res.status(500).json({ message: 'ZIP generation failed' });
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
  } else if (filename.startsWith('Sales_Report')) {
    return res.redirect('/api/sales/report');
  } else if (filename.startsWith('Orders_Report')) {
    return res.redirect('/api/orders/report');
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
  console.log(`Starting server...`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
