// server/server.js
// Final server: MongoDB (Mongoose) + PDF generation (PDFKit) for Inventory, Orders, Sales.
// Keeps XLSX endpoints but primary requested outputs are PDF reports.

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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mongoose connection
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set MONGODB_URI environment variable.');
  process.exit(1);
}
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('Connected to MongoDB Atlas'))
  .catch(err => { console.error('MongoDB connect error:', err); process.exit(1); });

const { Schema } = mongoose;

// Schemas & Models
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin','staff'], default: 'admin' },
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

const CompanySchema = new Schema({
  name: { type: String, default: 'L&B Company' },
  address: { type: String, default: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka' },
  phone: { type: String, default: '01133127622' },
  email: { type: String, default: 'lbcompany@gmail.com' },
  taxPercent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
CompanySchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });
const Company = mongoose.model('Company', CompanySchema);

const SalesSchema = new Schema({
  invoice: { type: String, required: true, unique: true },
  product: String,
  productName: String,
  sku: String,
  quantity: Number,
  total: Number,
  date: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SalesSchema);

const OrderItemSchema = new Schema({
  sku: String,
  name: String,
  qty: Number,
  price: Number
}, { _id: false });

const OrderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true },
  customerName: String,
  contact: String,
  items: [OrderItemSchema],
  total: Number,
  status: { type: String, default: 'Pending' },
  date: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// Log helper (suppress near-duplicate)
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
        return;
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error('logActivity error:', err);
  }
}

// Company helper
async function fetchCompany() {
  let company = await Company.findOne({}).lean();
  if (!company) {
    company = await Company.create({});
  }
  return company;
}

// Health
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// Company endpoints
app.get('/api/company', async (req, res) => {
  try {
    const company = await fetchCompany();
    return res.json(company);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.post('/api/company', async (req, res) => {
  try {
    const existing = await Company.findOne({}).lean();
    if (existing) return res.status(409).json({ message: 'Company already exists. Use PUT to update.' });
    const payload = {
      name: req.body.name || 'L&B Company',
      address: req.body.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka',
      phone: req.body.phone || '01133127622',
      email: req.body.email || 'lbcompany@gmail.com',
      taxPercent: Number(req.body.taxPercent || 0)
    };
    const created = await Company.create(payload);
    await logActivity(req.headers['x-username'], 'Created company profile');
    return res.status(201).json(created);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.put('/api/company', async (req, res) => {
  try {
    const payload = {
      name: req.body.name,
      address: req.body.address,
      phone: req.body.phone,
      email: req.body.email,
      taxPercent: typeof req.body.taxPercent !== 'undefined' ? Number(req.body.taxPercent) : undefined,
      updatedAt: new Date()
    };
    let company = await Company.findOne({});
    if (!company) company = await Company.create(payload);
    else {
      Object.keys(payload).forEach(k => {
        if (typeof payload[k] !== 'undefined') company[k] = payload[k];
      });
      await company.save();
    }
    await logActivity(req.headers['x-username'], 'Updated company profile');
    return res.json(company);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

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
  } catch (err) { console.error(err); return res.status(500).json({ success:false, message:'Server error' }); }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success:false, message:'Missing credentials' });
  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user) return res.status(401).json({ success:false, message:'Invalid credentials' });
    await logActivity(username, 'Logged in');
    return res.json({ success:true, user: { username: user.username, role: user.role || 'admin' } });
  } catch(err){ console.error(err); return res.status(500).json({ success:false, message:'Server error' }); }
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
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/account', async (req, res) => {
  const { username, securityCode } = req.body || {};
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: 'Invalid Admin Security Code' });
  try {
    const result = await User.deleteOne({ username });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'User not found' });
    await logActivity('System', `Deleted account for user: ${username}`);
    return res.json({ success:true, message:'Account deleted successfully' });
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Inventory CRUD
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

// Inventory PDF (Advanced Report - Boxed Header)
app.get('/api/inventory/report/pdf', async (req, res) => {
  try {
    const company = await fetchCompany();
    const items = await Inventory.find({}).lean();
    const filename = `Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.pipe(res);

    // Boxed header
    const left = 40;
    const top = 40;
    const boxWidth = 510;
    const boxHeight = 70;
    doc.rect(left, top, boxWidth, boxHeight).lineWidth(1).strokeColor('#444444').stroke();

    doc.font('Helvetica-Bold').fontSize(14).text(company.name || 'L&B Company', left + 8, top + 8);
    doc.font('Helvetica').fontSize(10).text(company.address || '', left + 8, top + 28, { width: 260 });
    doc.text(`Phone: ${company.phone || ''}`, left + 8, top + 44);
    doc.text(`Email: ${company.email || ''}`, left + 8, top + 58);

    const rightX = left + boxWidth - 200;
    doc.font('Helvetica-Bold').fontSize(12).text('INVENTORY REPORT', rightX, top + 12);
    doc.font('Helvetica').fontSize(10).text(`Date: ${new Date().toISOString().slice(0,10)}`, rightX, top + 34);

    // Table
    const tableTop = top + boxHeight + 20;
    let y = tableTop;
    const startX = 40;
    const colWidths = { sku: 90, name: 170, category: 90, qty: 50, unitCost: 70, unitPrice: 70, total: 90 };

    doc.rect(startX, y - 6, 510, 20).fillColor('#f0f0f0').fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
    doc.text('SKU', startX + 6, y - 4, { width: colWidths.sku - 10 });
    doc.text('Name', startX + colWidths.sku + 6, y - 4, { width: colWidths.name - 10 });
    doc.text('Category', startX + colWidths.sku + colWidths.name + 6, y - 4, { width: colWidths.category - 10 });
    doc.text('Qty', startX + colWidths.sku + colWidths.name + colWidths.category + 6, y - 4, { width: colWidths.qty - 10, align: 'right' });
    doc.text('Unit Cost', startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + 6, y - 4, { width: colWidths.unitCost - 10, align: 'right' });
    doc.text('Unit Price', startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + colWidths.unitCost + 6, y - 4, { width: colWidths.unitPrice - 10, align: 'right' });
    doc.text('Total Value', startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + colWidths.unitCost + colWidths.unitPrice + 6, y - 4, { width: colWidths.total - 10, align: 'right' });

    y += 24;
    doc.font('Helvetica').fontSize(10);

    let grandTotalValue = 0;
    let grandPotentialRevenue = 0;

    for (const it of items) {
      if (y > 740) { doc.addPage(); y = 60; }

      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const totalValue = qty * uc;
      const potentialRevenue = qty * up;
      grandTotalValue += totalValue;
      grandPotentialRevenue += potentialRevenue;

      doc.text(it.sku || '', startX + 6, y, { width: colWidths.sku - 10 });
      doc.text(it.name || '', startX + colWidths.sku + 6, y, { width: colWidths.name - 10 });
      doc.text(it.category || '', startX + colWidths.sku + colWidths.name + 6, y, { width: colWidths.category - 10 });
      doc.text(String(qty), startX + colWidths.sku + colWidths.name + colWidths.category + 6, y, { width: colWidths.qty - 10, align: 'right' });
      doc.text(uc.toFixed(2), startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + 6, y, { width: colWidths.unitCost - 10, align: 'right' });
      doc.text(up.toFixed(2), startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + colWidths.unitCost + 6, y, { width: colWidths.unitPrice - 10, align: 'right' });
      doc.text(totalValue.toFixed(2), startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + colWidths.unitCost + colWidths.unitPrice + 6, y, { width: colWidths.total - 10, align: 'right' });

      y += 18;
    }

    if (y > 700) { doc.addPage(); y = 60; }
    doc.moveTo(startX, y).lineTo(startX + 510, y).strokeColor('#cccccc').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Totals', startX + colWidths.sku + colWidths.name - 10, y, { continued: false });
    doc.text(grandTotalValue.toFixed(2), startX + colWidths.sku + colWidths.name + colWidths.category + colWidths.qty + colWidths.unitCost + colWidths.unitPrice + 6, y, { width: colWidths.total - 10, align: 'right' });
    y += 20;

    doc.font('Helvetica').fontSize(10).text('Thank you for your business.', startX, y + 20, { align: 'center', width: 510 });
    doc.text('Generated by L&B Inventory System', startX, y + 36, { align: 'center', width: 510 });

    doc.end();

    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Inventory PDF: ${filename}`);
  } catch (err) {
    console.error('inventory pdf error', err);
    return res.status(500).json({ message: 'Inventory PDF generation failed' });
  }
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
    return res.redirect('/api/inventory/report/pdf');
  }
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// Sales endpoints & PDF
app.get('/api/sales', async (req, res) => {
  try {
    const rows = await Sale.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: r._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.post('/api/sales', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.invoice) payload.invoice = `INV-${Date.now()}`;
    const created = await Sale.create(payload);
    await logActivity(req.headers['x-username'], `Recorded sale: ${created.invoice}`);
    return res.status(201).json({ ...created.toObject(), id: created._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});
app.delete('/api/sales/:id', async (req, res) => {
  try {
    const result = await Sale.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'], `Deleted sale: ${result.invoice}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Sales PDF
app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const company = await fetchCompany();
    const rows = await Sale.find({}).lean();
    const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.pipe(res);

    // Boxed header
    const left = 40;
    const top = 40;
    const boxWidth = 510;
    const boxHeight = 70;
    doc.rect(left, top, boxWidth, boxHeight).lineWidth(1).strokeColor('#444444').stroke();
    doc.font('Helvetica-Bold').fontSize(14).text(company.name || 'L&B Company', left + 8, top + 8);
    doc.font('Helvetica').fontSize(10).text(company.address || '', left + 8, top + 28, { width: 260 });
    doc.text(`Phone: ${company.phone || ''}`, left + 8, top + 44);
    doc.text(`Email: ${company.email || ''}`, left + 8, top + 58);
    const rightX = left + boxWidth - 200;
    doc.font('Helvetica-Bold').fontSize(12).text('SALES REPORT', rightX, top + 12);
    doc.font('Helvetica').fontSize(10).text(`Date: ${new Date().toISOString().slice(0,10)}`, rightX, top + 34);

    doc.moveDown(3);
    let y = top + boxHeight + 20;
    const startX = 40;
    const col = { inv: 120, prod: 200, qty: 60, total: 120 };

    doc.rect(startX, y - 6, 510, 20).fillColor('#f0f0f0').fill();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(10);
    doc.text('Invoice', startX + 6, y - 4, { width: col.inv - 10 });
    doc.text('Product', startX + col.inv + 6, y - 4, { width: col.prod - 10 });
    doc.text('Qty', startX + col.inv + col.prod + 6, y - 4, { width: col.qty - 10, align: 'right' });
    doc.text('Total (RM)', startX + col.inv + col.prod + col.qty + 6, y - 4, { width: col.total - 10, align: 'right' });

    y += 24;
    doc.font('Helvetica').fontSize(10);
    let totalSum = 0;
    for (const r of rows) {
      if (y > 740) { doc.addPage(); y = 60; }
      doc.text(r.invoice || '', startX + 6, y, { width: col.inv - 10 });
      doc.text(r.productName || r.product || '', startX + col.inv + 6, y, { width: col.prod - 10 });
      doc.text(String(r.quantity || 0), startX + col.inv + col.prod + 6, y, { width: col.qty - 10, align: 'right' });
      doc.text((Number(r.total)||0).toFixed(2), startX + col.inv + col.prod + col.qty + 6, y, { width: col.total - 10, align: 'right' });
      y += 18;
      totalSum += Number(r.total || 0);
    }

    if (y > 700) { doc.addPage(); y = 60; }
    doc.moveTo(startX, y).lineTo(startX + 510, y).strokeColor('#cccccc').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).text('TOTAL SALES:', startX + 6, y);
    doc.text(`RM ${totalSum.toFixed(2)}`, startX + col.inv + col.prod + col.qty + 6, y, { width: col.total - 10, align: 'right' });

    doc.moveDown(6);
    doc.font('Helvetica').fontSize(10).text('Thank you for your business.', startX, doc.y, { align: 'center', width: 510 });
    doc.text('Generated by L&B Inventory System', startX, doc.y + 16, { align: 'center', width: 510 });

    doc.end();

    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales PDF: ${filename}`);
  } catch (err) {
    console.error('sales pdf error', err);
    return res.status(500).json({ message:'PDF generation failed' });
  }
});

// Orders endpoints & PDF
app.get('/api/orders', async (req, res) => {
  try {
    const rows = await Order.find({}).sort({ date: -1 }).lean();
    const normalized = rows.map(r => ({ ...r, id: r._id.toString() }));
    return res.json(normalized);
  } catch (err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.orderNumber) payload.orderNumber = `ORD-${Date.now()}`;
    if ((!payload.total || payload.total === 0) && Array.isArray(payload.items)) {
      payload.total = payload.items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.price||0)), 0);
    }
    const created = await Order.create(payload);
    await logActivity(req.headers['x-username'], `Created order: ${created.orderNumber}`);
    return res.status(201).json({ ...created.toObject(), id: created._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await Order.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Updated order: ${updated.orderNumber}`);
    return res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const result = await Order.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Deleted order: ${result.orderNumber}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Orders PDF report summary
app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const company = await fetchCompany();
    const rows = await Order.find({}).lean();
    const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.pipe(res);

    const left = 40;
    const top = 40;
    const boxWidth = 510;
    const boxHeight = 70;
    doc.rect(left, top, boxWidth, boxHeight).lineWidth(1).strokeColor('#444444').stroke();
    doc.font('Helvetica-Bold').fontSize(14).text(company.name || 'L&B Company', left + 8, top + 8);
    doc.font('Helvetica').fontSize(10).text(company.address || '', left + 8, top + 28, { width: 260 });
    doc.text(`Phone: ${company.phone || ''}`, left + 8, top + 44);
    doc.text(`Email: ${company.email || ''}`, left + 8, top + 58);
    const rightX = left + boxWidth - 200;
    doc.font('Helvetica-Bold').fontSize(12).text('ORDERS REPORT', rightX, top + 12);
    doc.font('Helvetica').fontSize(10).text(`Date: ${new Date().toISOString().slice(0,10)}`, rightX, top + 34);

    doc.moveDown(3);
    doc.font('Helvetica').fontSize(11);

    let y = top + boxHeight + 20;
    for (const order of rows) {
      if (y > 720) { doc.addPage(); y = 60; }
      doc.font('Helvetica-Bold').text(`Order: ${order.orderNumber}  |  Customer: ${order.customerName}  |  Status: ${order.status}`, 40, y);
      y = doc.y + 4;
      doc.font('Helvetica').fontSize(10).text(`Total: RM ${(Number(order.total)||0).toFixed(2)}  |  Items: ${Array.isArray(order.items)?order.items.length:0}`, 40, y);
      y = doc.y + 4;
      if (Array.isArray(order.items) && order.items.length > 0) {
        for (const it of order.items) {
          if (y > 720) { doc.addPage(); y = 60; }
          doc.text(`  • ${it.name} (SKU:${it.sku}) x${it.qty} @ RM ${Number(it.price).toFixed(2)}`, { indent: 10 });
          y = doc.y + 2;
        }
      }
      y = doc.y + 12;
    }

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(10).text('Thank you for your business.', 40, doc.y + 10, { align: 'center', width: 510 });
    doc.text('Generated by L&B Inventory System', 40, doc.y + 26, { align: 'center', width: 510 });

    doc.end();
    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders PDF: ${filename}`);
  } catch(err) {
    console.error('orders pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// Individual Order Invoice PDF endpoint (invoice-style)
app.get('/api/orders/:id/invoice', async (req, res) => {
  try {
    const orderId = req.params.id;
    let order = await Order.findById(orderId).lean();
    if (!order) order = await Order.findOne({ orderNumber: orderId }).lean();
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const company = await fetchCompany();
    const filename = `INVOICE_${order.orderNumber || order._id}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    doc.pipe(res);

    // Boxed header
    const left = 40;
    const top = 40;
    const boxWidth = 510;
    const boxHeight = 70;
    doc.rect(left, top, boxWidth, boxHeight).lineWidth(1).strokeColor('#444444').stroke();
    doc.font('Helvetica-Bold').fontSize(16).text(company.name || 'L&B Company', left + 8, top + 8);
    doc.font('Helvetica').fontSize(10).text(company.address || '', left + 8, top + 28, { width: 260 });
    doc.text(`Phone: ${company.phone || ''}`, left + 8, top + 44);
    doc.text(`Email: ${company.email || ''}`, left + 8, top + 58);

    const rightX = left + boxWidth - 230;
    doc.font('Helvetica-Bold').fontSize(14).text('INVOICE / ORDER SUMMARY', rightX, top + 12);
    doc.font('Helvetica').fontSize(10).text(`Order #: ${order.orderNumber || ''}`, rightX, top + 36);
    doc.text(`Date: ${order.date ? new Date(order.date).toLocaleString() : new Date().toLocaleString()}`, rightX, top + 52);
    doc.text(`Status: ${order.status || ''}`, rightX, top + 68);

    doc.moveDown(4);
    doc.font('Helvetica-Bold').fontSize(12).text('Bill To:');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).text(`Customer Name: ${order.customerName || ''}`);
    if (order.contact) doc.text(`Contact: ${order.contact}`);
    doc.moveDown(1);

    // Table header
    const tableTopY = doc.y;
    const col1 = 40;   // Item
    const col2 = 230;  // SKU
    const col3 = 330;  // Qty
    const col4 = 400;  // Unit Price
    const col5 = 480;  // Total

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Item', col1, tableTopY);
    doc.text('SKU', col2, tableTopY);
    doc.text('Qty', col3, tableTopY, { width: 40, align: 'right' });
    doc.text('Unit Price', col4, tableTopY, { width: 70, align: 'right' });
    doc.text('Total', col5, tableTopY, { width: 70, align: 'right' });

    doc.moveTo(40, doc.y + 15).lineTo(550, doc.y + 15).stroke();
    doc.moveDown(1);

    let subtotal = 0;
    doc.font('Helvetica').fontSize(11);
    if (Array.isArray(order.items) && order.items.length > 0) {
      for (const it of order.items) {
        if (doc.y > 730) doc.addPage();
        const lineTotal = Number(it.qty || 0) * Number(it.price || 0);
        subtotal += lineTotal;
        const currentY = doc.y;
        doc.text(it.name || '', col1, currentY, { width: col2 - col1 - 6 });
        doc.text(it.sku || '', col2, currentY);
        doc.text(String(it.qty || 0), col3, currentY, { width: 40, align: 'right' });
        doc.text(`RM ${(Number(it.price)||0).toFixed(2)}`, col4, currentY, { width: 70, align: 'right' });
        doc.text(`RM ${lineTotal.toFixed(2)}`, col5, currentY, { width: 70, align: 'right' });
        doc.moveDown(0.9);
      }
    } else {
      doc.text('(No items)', col1);
    }

    doc.moveDown(1.2);

    const taxPercent = Number(company.taxPercent || 0);
    const taxAmount = Number(((subtotal * taxPercent) / 100).toFixed(2));
    const grandTotal = Number((subtotal + taxAmount).toFixed(2));

    const totalsX = 350;
    doc.font('Helvetica-Bold').fontSize(12).text(`Subtotal: RM ${subtotal.toFixed(2)}`, totalsX, doc.y, { align: 'right' });
    if (taxPercent > 0) {
      doc.font('Helvetica').fontSize(11).text(`Tax (${taxPercent}%): RM ${taxAmount.toFixed(2)}`, totalsX, doc.y + 18, { align: 'right' });
    }
    doc.font('Helvetica-Bold').fontSize(13).text(`Grand Total: RM ${grandTotal.toFixed(2)}`, totalsX, doc.y + 36, { align: 'right' });

    doc.moveDown(3);
    doc.font('Helvetica').fontSize(10).text('Thank you for your business.', { align: 'center' });
    doc.text('Generated by L&B Inventory System', { align: 'center' });

    doc.end();
    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Invoice PDF: ${filename}`);
  } catch (err) {
    console.error('order invoice pdf error', err);
    return res.status(500).json({ message: 'Invoice PDF generation failed' });
  }
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));

// SPA & API fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Startup helpers: create default admin & company
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password', role: 'admin' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }
    let company = await Company.findOne({}).lean();
    if (!company) {
      await Company.create({});
      await logActivity('System', 'Default company profile created.');
      console.log('Default company profile created.');
    }
    await logActivity('System', `Server is live and listening on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

// Start
(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log(`Starting server (no DB startup log written to ActivityLog)`);
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
