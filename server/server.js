// server.js
// Extended server: adds Orders, Sales, Company and PDFKit report routes
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Please set environment variable to connect to MongoDB.');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

// Schemas & Models
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

const DocSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

const CompanySchema = new Schema({
  name: String,
  address: String,
  phone: String,
  email: String,
  taxNumber: String,
  createdAt: { type: Date, default: Date.now }
});
const Company = mongoose.model('Company', CompanySchema);

const OrderItemSchema = new Schema({
  itemId: String,
  name: String,
  sku: String,
  qty: Number,
  unitPrice: Number
}, { _id: false });

const OrderSchema = new Schema({
  orderNo: String,
  date: { type: Date, default: Date.now },
  status: { type: String, default: 'Pending' },
  customer: { name: String, contact: String },
  items: [OrderItemSchema],
  subtotal: Number,
  tax: Number,
  total: Number,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const SaleSchema = new Schema({
  saleNo: String,
  date: { type: Date, default: Date.now },
  status: { type: String, default: 'Pending' },
  customer: { name: String, contact: String },
  items: [OrderItemSchema],
  subtotal: Number,
  tax: Number,
  total: Number,
  createdAt: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SaleSchema);

// Helpers
async function logActivity(user, action){
  try {
    const safeUser = (user || 'System').toString();
    const safeAction = (action || '').toString();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    const now = Date.now();
    if (last) {
      const lastUser = last.user || 'System';
      const lastAction = last.action || '';
      const lastTime = last.time ? new Date(last.time).getTime() : 0;
      if (lastUser === safeUser && lastAction === safeAction && (now - lastTime) <= 30*1000) {
        return;
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

function formatDateForPdf(date){
  const d = new Date(date || Date.now());
  const dd = ('0' + d.getDate()).slice(-2);
  const mm = ('0' + (d.getMonth()+1)).slice(-2);
  const yyyy = d.getFullYear();
  const hh = ('0' + d.getHours()).slice(-2);
  const min = ('0' + d.getMinutes()).slice(-2);
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

async function getCompanyOrDefault(){
  const company = await Company.findOne({}).lean();
  if (company) return company;
  return {
    name: 'L&B Company',
    address: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka',
    phone: '01133127622',
    email: 'lbcompany@gmail.com',
    taxNumber: ''
  };
}

// Express setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// Auth
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

// Inventory
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
    await logActivity(req.headers['x-username'] || 'System', `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndUpdate(id, req.body, { new:true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'System', `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Inventory.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'] || 'System', `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ date: -1 }).lean();
    const normalized = orders.map(o => ({ ...o, id: o._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const payload = req.body || {};
    const items = (payload.items || []).map(it => ({
      itemId: it.itemId,
      name: it.name,
      sku: it.sku,
      qty: Number(it.qty||0),
      unitPrice: Number(it.unitPrice||0)
    }));
    const missing = [];
    for (const it of items) {
      const found = await Inventory.findById(it.itemId).lean();
      if (!found) missing.push(it);
    }
    if (missing.length) return res.status(400).json({ message: 'Some items are not in inventory', missing });

    const subtotal = items.reduce((s,it) => s + (it.qty * it.unitPrice), 0);
    const tax = 0;
    const total = subtotal + tax;
    const orderNo = payload.orderNo || `ORD-${Math.floor(100000 + Math.random()*899999)}`;

    const order = await Order.create({
      orderNo,
      date: payload.date || new Date(),
      status: payload.status || 'Pending',
      customer: payload.customer || {},
      items,
      subtotal,
      tax,
      total
    });
    await logActivity(req.headers['x-username'] || 'System', `Created order: ${order.orderNo}`);
    return res.status(201).json({ ...order.toObject(), id: order._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};
    const items = (payload.items || []).map(it => ({
      itemId: it.itemId,
      name: it.name,
      sku: it.sku,
      qty: Number(it.qty||0),
      unitPrice: Number(it.unitPrice||0)
    }));
    const missing = [];
    for (const it of items) {
      const found = await Inventory.findById(it.itemId).lean();
      if (!found) missing.push(it);
    }
    if (missing.length) return res.status(400).json({ message: 'Some items are not in inventory', missing });

    const subtotal = items.reduce((s,it) => s + (it.qty * it.unitPrice), 0);
    const tax = 0;
    const total = subtotal + tax;

    const updated = await Order.findByIdAndUpdate(id, {
      date: payload.date || new Date(),
      status: payload.status || 'Pending',
      customer: payload.customer || {},
      items,
      subtotal,
      tax,
      total
    }, { new: true });
    if (!updated) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'] || 'System', `Updated order: ${updated.orderNo}`);
    return res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const result = await Order.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'] || 'System', `Deleted order: ${result.orderNo}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Sales
app.get('/api/sales', async (req, res) => {
  try {
    const sales = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = sales.map(s => ({ ...s, id: s._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    const payload = req.body || {};
    const items = (payload.items || []).map(it => ({
      itemId: it.itemId,
      name: it.name,
      sku: it.sku,
      qty: Number(it.qty||0),
      unitPrice: Number(it.unitPrice||0)
    }));
    const missing = [];
    for (const it of items) {
      const found = await Inventory.findById(it.itemId).lean();
      if (!found) missing.push(it);
    }
    if (missing.length) return res.status(400).json({ message: 'Some items are not in inventory', missing });

    const subtotal = items.reduce((s,it) => s + (it.qty * it.unitPrice), 0);
    const tax = 0;
    const total = subtotal + tax;
    const saleNo = payload.saleNo || `SAL-${Math.floor(100000 + Math.random()*899999)}`;

    // If status is Approved, reduce inventory atomically
    if ((payload.status || 'Pending') === 'Approved') {
      for (const it of items) {
        await Inventory.findByIdAndUpdate(it.itemId, { $inc: { quantity: -Math.abs(it.qty) } });
      }
    }

    const sale = await Sale.create({
      saleNo,
      date: payload.date || new Date(),
      status: payload.status || 'Pending',
      customer: payload.customer || {},
      items,
      subtotal,
      tax,
      total
    });
    await logActivity(req.headers['x-username'] || 'System', `Created sale: ${sale.saleNo}`);
    return res.status(201).json({ ...sale.toObject(), id: sale._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/sales/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};
    const items = (payload.items || []).map(it => ({
      itemId: it.itemId,
      name: it.name,
      sku: it.sku,
      qty: Number(it.qty||0),
      unitPrice: Number(it.unitPrice||0)
    }));
    const missing = [];
    for (const it of items) {
      const found = await Inventory.findById(it.itemId).lean();
      if (!found) missing.push(it);
    }
    if (missing.length) return res.status(400).json({ message: 'Some items are not in inventory', missing });

    // If changing status to Approved from non-Approved, reduce inventory
    const existing = await Sale.findById(id).lean();
    const prevStatus = existing ? existing.status : null;
    const newStatus = payload.status || prevStatus || 'Pending';

    if (prevStatus !== 'Approved' && newStatus === 'Approved') {
      for (const it of items) {
        await Inventory.findByIdAndUpdate(it.itemId, { $inc: { quantity: -Math.abs(it.qty) } });
      }
    }
    // If previously Approved and now changed to Cancelled or Pending, restore quantities
    if (prevStatus === 'Approved' && newStatus !== 'Approved') {
      for (const it of existing.items || []) {
        await Inventory.findByIdAndUpdate(it.itemId, { $inc: { quantity: Math.abs(it.qty) } });
      }
    }

    const subtotal = items.reduce((s,it) => s + (it.qty * it.unitPrice), 0);
    const tax = 0;
    const total = subtotal + tax;

    const updated = await Sale.findByIdAndUpdate(id, {
      date: payload.date || new Date(),
      status: newStatus,
      customer: payload.customer || {},
      items,
      subtotal,
      tax,
      total
    }, { new: true });
    if (!updated) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'] || 'System', `Updated sale: ${updated.saleNo}`);
    return res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const s = await Sale.findById(req.params.id).lean();
    if (!s) return res.status(404).json({ message:'Sale not found' });
    // If deleted and was Approved, restore stock
    if (s.status === 'Approved') {
      for (const it of s.items || []) {
        await Inventory.findByIdAndUpdate(it.itemId, { $inc: { quantity: Math.abs(it.qty) } });
      }
    }
    await Sale.findByIdAndDelete(req.params.id);
    await logActivity(req.headers['x-username'] || 'System', `Deleted sale: ${s.saleNo}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Company endpoints
app.get('/api/company', async (req, res) => {
  try {
    const company = await Company.findOne({}).lean();
    if (!company) return res.json({});
    return res.json(company);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/company', async (req, res) => {
  try {
    const body = req.body || {};
    let company = await Company.findOne({});
    if (!company) {
      company = await Company.create(body);
    } else {
      Object.assign(company, body);
      await company.save();
    }
    await logActivity(req.headers['x-username'] || 'System', `Updated company info`);
    return res.json(company);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Documents
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
    await logActivity(req.headers['x-username'] || 'System', `Uploaded document metadata: ${doc.name}`);
    const normalized = { ...doc.toObject(), id: doc._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    await logActivity(req.headers['x-username'] || 'System', `Deleted document metadata: ${doc.name}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.get('/api/documents/download/:filename', async (req, res) => {
  // This server stores only metadata; downloads are stubs or redirect to saved files in a real app.
  const filename = req.params.filename || '';
  return res.status(404).json({ message: "Download not available on this server (metadata-only)." });
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Inventory XLSX report (existing)
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

    const doc = await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'] || 'System', `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// Inventory PDF report (PDFKit)
app.get('/api/report/inventory/pdf', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const company = await getCompanyOrDefault();

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="inventory-report.pdf"`);
    doc.pipe(res);

    // Header left
    doc.fontSize(14).text(company.name || 'Company', 50, 40);
    doc.fontSize(10).text(company.address || '', 50, 60);
    doc.text(`Phone: ${company.phone || '-'}`, 50, 75);
    doc.text(`Email: ${company.email || '-'}`, 50, 90);

    // Title right box
    const startX = 350;
    doc.rect(startX - 10, 40, 220, 80).stroke();
    doc.fontSize(12).text('INVENTORY REPORT', startX, 50, { align: 'right' });
    doc.fontSize(10).text(`Date: ${formatDateForPdf(new Date())}`, startX, 70, { align: 'right' });

    doc.moveDown(3);

    // Table header
    const tableTop = doc.y + 10;
    doc.fontSize(10).text('Item', 50, tableTop);
    doc.text('SKU', 220, tableTop);
    doc.text('Qty', 320, tableTop, { width: 50, align: 'right' });
    doc.text('Unit Price', 380, tableTop, { width: 80, align: 'right' });
    doc.text('Total', 470, tableTop, { width: 80, align: 'right' });

    let y = tableTop + 20;
    let grandTotal = 0;
    items.forEach(it => {
      const total = Number(it.quantity || 0) * Number(it.unitPrice || 0);
      grandTotal += total;
      doc.fontSize(10).text(it.name || '-', 50, y);
      doc.text(it.sku || '-', 220, y);
      doc.text(String(it.quantity || 0), 320, y, { width: 50, align: 'right' });
      doc.text(Number(it.unitPrice || 0).toFixed(2), 380, y, { width: 80, align: 'right' });
      doc.text(total.toFixed(2), 470, y, { width: 80, align: 'right' });
      y += 20;
      if (y > 740) { doc.addPage(); y = 60; }
    });

    doc.moveDown(2);
    doc.fontSize(10).text('Grand Total', 380, doc.y, { width: 80, align: 'right' });
    doc.text(grandTotal.toFixed(2), 470, doc.y, { width: 80, align: 'right' });

    doc.moveDown(2);
    doc.fontSize(10).text('Generated by L&B Inventory System', 50, doc.y);
    doc.end();

  } catch(err){
    console.error('inventory pdf error', err);
    return res.status(500).json({ message:'Failed to generate PDF' });
  }
});

// Backwards-compatible route
app.get('/api/pdf/inventory', (req, res) => res.redirect('/api/report/inventory/pdf'));

// Order PDF
app.get('/api/report/order/:id/pdf', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message:'Order not found' });
    const company = await getCompanyOrDefault();

    const doc = new PDFDocument({ margin: 40, size:'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${order.orderNo || 'order'}.pdf"`);
    doc.pipe(res);

    // Header left
    doc.fontSize(14).text(company.name || 'Company', 50, 40);
    doc.fontSize(10).text(company.address || '', 50, 60);
    doc.text(`Phone: ${company.phone || '-'}`, 50, 75);
    doc.text(`Email: ${company.email || '-'}`, 50, 90);

    // Right meta box
    const startX = 350;
    doc.rect(startX - 10, 40, 220, 80).stroke();
    doc.fontSize(12).text('ORDER SUMMARY', startX, 50, { align: 'right' });
    doc.fontSize(10).text(`Order #: ${order.orderNo || ''}`, startX, 70, { align: 'right' });
    doc.text(`Date: ${formatDateForPdf(order.date)}`, startX, 84, { align: 'right' });
    doc.text(`Status: ${order.status || ''}`, startX, 98, { align: 'right' });

    doc.moveDown(3);

    // Customer
    if (order.customer && order.customer.name) {
      doc.fontSize(11).text('Bill To:', 50, doc.y);
      doc.fontSize(10).text(order.customer.name || '-', 50, doc.y + 14);
      if (order.customer.contact) doc.text('Contact: ' + order.customer.contact, 50, doc.y + 28);
      doc.moveDown();
    }

    // Items table
    let y = doc.y + 10;
    doc.fontSize(10).text('Item', 50, y);
    doc.text('SKU', 220, y);
    doc.text('Qty', 320, y, { width: 50, align: 'right' });
    doc.text('Unit Price', 380, y, { width: 80, align: 'right' });
    doc.text('Total', 470, y, { width: 80, align: 'right' });
    y += 20;

    (order.items || []).forEach(it => {
      const qty = Number(it.qty||0);
      const up = Number(it.unitPrice||0);
      const total = qty * up;
      doc.fontSize(10).text(it.name || '-', 50, y);
      doc.text(it.sku || '-', 220, y);
      doc.text(String(qty), 320, y, { width: 50, align: 'right' });
      doc.text(up.toFixed(2), 380, y, { width: 80, align: 'right' });
      doc.text(total.toFixed(2), 470, y, { width: 80, align: 'right' });
      y += 20;
      if (y > 740) { doc.addPage(); y = 60; }
    });

    // totals
    doc.moveDown(2);
    const rightEdge = 470;
    doc.fontSize(10).text('Subtotal', rightEdge - 90, doc.y, { align: 'right' });
    doc.text((order.subtotal||0).toFixed(2), rightEdge, doc.y, { width: 80, align: 'right' });
    doc.text('Tax', rightEdge - 90, doc.y + 15, { align: 'right' });
    doc.text((order.tax||0).toFixed(2), rightEdge, doc.y + 15, { width: 80, align: 'right' });
    doc.fontSize(12).text('Grand Total', rightEdge - 90, doc.y + 40, { align: 'right' });
    doc.text((order.total||0).toFixed(2), rightEdge, doc.y + 40, { width: 80, align: 'right' });

    doc.moveDown(4);
    doc.fontSize(10).text('Thank you for your business.', 50, doc.y);
    doc.text('Generated by L&B Inventory System', 50, doc.y + 15);

    doc.end();
  } catch(err){
    console.error('order pdf error', err);
    return res.status(500).json({ message:'Failed to generate order PDF' });
  }
});

// Sale PDF (Invoice)
app.get('/api/report/sale/:id/pdf', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) return res.status(404).json({ message:'Sale not found' });
    const company = await getCompanyOrDefault();

    const doc = new PDFDocument({ margin: 40, size:'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sale.saleNo || 'sale'}.pdf"`);
    doc.pipe(res);

    // Header left
    doc.fontSize(14).text(company.name || 'Company', 50, 40);
    doc.fontSize(10).text(company.address || '', 50, 60);
    doc.text(`Phone: ${company.phone || '-'}`, 50, 75);
    doc.text(`Email: ${company.email || '-'}`, 50, 90);

    // Right meta box
    const startX = 350;
    doc.rect(startX - 10, 40, 220, 80).stroke();
    doc.fontSize(12).text('INVOICE', startX, 50, { align: 'right' });
    doc.fontSize(10).text(`Invoice #: ${sale.saleNo || ''}`, startX, 70, { align: 'right' });
    doc.text(`Date: ${formatDateForPdf(sale.date)}`, startX, 84, { align: 'right' });
    doc.text(`Status: ${sale.status || ''}`, startX, 98, { align: 'right' });

    doc.moveDown(3);

    // Customer
    if (sale.customer && sale.customer.name) {
      doc.fontSize(11).text('Bill To:', 50, doc.y);
      doc.fontSize(10).text(sale.customer.name || '-', 50, doc.y + 14);
      if (sale.customer.contact) doc.text('Contact: ' + sale.customer.contact, 50, doc.y + 28);
      doc.moveDown();
    }

    // Items table
    let y = doc.y + 10;
    doc.fontSize(10).text('Item', 50, y);
    doc.text('SKU', 220, y);
    doc.text('Qty', 320, y, { width: 50, align: 'right' });
    doc.text('Unit Price', 380, y, { width: 80, align: 'right' });
    doc.text('Total', 470, y, { width: 80, align: 'right' });
    y += 20;

    (sale.items || []).forEach(it => {
      const qty = Number(it.qty||0);
      const up = Number(it.unitPrice||0);
      const total = qty * up;
      doc.fontSize(10).text(it.name || '-', 50, y);
      doc.text(it.sku || '-', 220, y);
      doc.text(String(qty), 320, y, { width: 50, align: 'right' });
      doc.text(up.toFixed(2), 380, y, { width: 80, align: 'right' });
      doc.text(total.toFixed(2), 470, y, { width: 80, align: 'right' });
      y += 20;
      if (y > 740) { doc.addPage(); y = 60; }
    });

    // totals
    doc.moveDown(2);
    const rightEdge = 470;
    doc.fontSize(10).text('Subtotal', rightEdge - 90, doc.y, { align: 'right' });
    doc.text((sale.subtotal||0).toFixed(2), rightEdge, doc.y, { width: 80, align: 'right' });
    doc.text('Tax', rightEdge - 90, doc.y + 15, { align: 'right' });
    doc.text((sale.tax||0).toFixed(2), rightEdge, doc.y + 15, { width: 80, align: 'right' });
    doc.fontSize(12).text('Grand Total', rightEdge - 90, doc.y + 40, { align: 'right' });
    doc.text((sale.total||0).toFixed(2), rightEdge, doc.y + 40, { width: 80, align: 'right' });

    doc.moveDown(4);
    doc.fontSize(10).text('Thank you for your business.', 50, doc.y);
    doc.text('Generated by L&B Inventory System', 50, doc.y + 15);

    doc.end();
  } catch(err){
    console.error('sale pdf error', err);
    return res.status(500).json({ message:'Failed to generate sale PDF' });
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public'))); // adjust path if your public folder is sibling

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Startup helpers
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created: admin/password');
    }
    await logActivity('System', `Server started at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
