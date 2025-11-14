// server/server.js
// MongoDB (Mongoose) + XLSX + PDF + ZIP support for Online Inventory & Documents System

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

// --- New: Sales and Orders schemas ---
const SalesSchema = new Schema({
  invoice: { type: String, required: true, unique: true },
  product: String,
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
  items: [OrderItemSchema],
  total: Number,
  status: { type: String, default: 'Pending' },
  date: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// utility to log, suppress near-duplicate entries
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

// ===== Health check =====
app.get('/api/test', (req, res) => res.json({ success:true, message:'API is up', time: new Date().toISOString() }));

// ===== Auth (unchanged) =====
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

// ===== Inventory CRUD & Report (unchanged behavior; date-only in header) =====
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
  return res.status(404).json({ message: "File not found or download unavailable on this mock server." });
});

// ===== Sales endpoints =====
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
    // simple invoice auto if not provided
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

// Sales reports: XLSX
app.get('/api/sales/report', async (req, res) => {
  try {
    const rows = await Sale.find({}).lean();
    const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const ws_data = [
      ["L&B Company - Sales Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Invoice","Product","Quantity","Total","Date"]
    ];
    let totalSum = 0;
    rows.forEach(r => {
      ws_data.push([r.invoice||'', r.product||'', r.quantity||0, (Number(r.total)||0).toFixed(2), (r.date? new Date(r.date).toISOString().slice(0,10):'')]);
      totalSum += Number(r.total||0);
    });
    ws_data.push([]);
    ws_data.push(["", "", "Totals", totalSum.toFixed(2), ""]);
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sales Report");
    const out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    const doc = await Doc.create({ name: filename, size: out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(out);
  } catch (err) {
    console.error('sales report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// Sales PDF generator (uses pdfkit)
app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const rows = await Sale.find({}).lean();
    const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    doc.fontSize(18).text('L&B Company - Sales Report', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(10).text(`Date: ${new Date().toISOString().slice(0,10)}`, { align: 'right' });
    doc.moveDown(1);

    // Table header
    doc.fontSize(11).text('Invoice', 40, doc.y, { width: 100 });
    doc.text('Product', 140, doc.y - 14, { width: 160 });
    doc.text('Qty', 300, doc.y - 14, { width: 40, align: 'right' });
    doc.text('Total (RM)', 340, doc.y - 14, { width: 80, align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    let totalSum = 0;
    rows.forEach(r => {
      const yBefore = doc.y + 6;
      doc.fontSize(10).text(r.invoice || '', 40, yBefore, { width: 100 });
      doc.text(r.product || '', 140, yBefore, { width: 160 });
      doc.text(String(r.quantity || 0), 300, yBefore, { width: 40, align: 'right' });
      doc.text((Number(r.total||0)).toFixed(2), 340, yBefore, { width: 80, align: 'right' });
      doc.moveDown(0.8);
      totalSum += Number(r.total||0);
    });

    doc.moveDown(0.5);
    doc.fontSize(11).text(`TOTAL SALES: RM ${totalSum.toFixed(2)}`, { align: 'right' });
    doc.end();

    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales PDF: ${filename}`);
  } catch (err) {
    console.error('sales pdf error', err);
    return res.status(500).json({ message:'PDF generation failed' });
  }
});

// ===== Orders endpoints (advanced multi-item) =====
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
    // generate orderNumber if missing
    if (!payload.orderNumber) payload.orderNumber = `ORD-${Date.now()}`;
    // compute total if items present and total missing
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

// Orders XLSX report
app.get('/api/orders/report', async (req, res) => {
  try {
    const rows = await Order.find({}).lean();
    const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx`;
    const ws_data = [
      ["L&B Company - Orders Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      [],
      ["Order #","Customer","Items (count)","Total","Status","Date"]
    ];
    let grandTotal = 0;
    rows.forEach(r => {
      ws_data.push([r.orderNumber||'', r.customerName||'', (Array.isArray(r.items)? r.items.length : 0), (Number(r.total)||0).toFixed(2), r.status||'', (r.date? new Date(r.date).toISOString().slice(0,10):'')]);
      grandTotal += Number(r.total||0);
    });
    ws_data.push([]);
    ws_data.push(["", "", "Grand Total", grandTotal.toFixed(2), "", ""]);
    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Orders Report");
    const out = xlsx.write(wb, { type:'buffer', bookType:'xlsx' });

    await Doc.create({ name: filename, size: out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(out);
  } catch (err) {
    console.error('orders report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// Orders PDF generator (pdfkit)
app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const rows = await Order.find({}).lean();
    const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    doc.fontSize(18).text('L&B Company - Orders Report', { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(10).text(`Date: ${new Date().toISOString().slice(0,10)}`, { align: 'right' });
    doc.moveDown(1);

    rows.forEach(order => {
      doc.fontSize(12).text(`Order: ${order.orderNumber}  |  Customer: ${order.customerName}  |  Status: ${order.status}`);
      doc.fontSize(10).text(`Total: RM ${(Number(order.total)||0).toFixed(2)}  |  Items: ${Array.isArray(order.items)?order.items.length:0}`);
      if(Array.isArray(order.items) && order.items.length > 0) {
        order.items.forEach(it => {
          doc.text(`  • ${it.name} (SKU:${it.sku}) x${it.qty} @ RM ${Number(it.price).toFixed(2)}`);
        });
      }
      doc.moveDown(0.6);
    });

    doc.end();
    await Doc.create({ name: filename, size: 0, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders PDF: ${filename}`);
  } catch(err) {
    console.error('orders pdf error', err);
    return res.status(500).json({ message: 'PDF generation failed' });
  }
});

// ===== ZIP all reports endpoint: /api/reports/zip =====
app.get('/api/reports/zip', async (req, res) => {
  try {
    // Generate the three XLSX reports in-memory and ZIP them
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Disposition', `attachment; filename="All_Reports_${new Date().toISOString().slice(0,10)}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    archive.pipe(res);

    // Inventory XLSX
    const invItems = await Inventory.find({}).lean();
    const inv_ws = [["L&B Company - Inventory Report"], ["Date:", new Date().toISOString().slice(0,10)], [], ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]];
    invItems.forEach(it => {
      const qty = Number(it.quantity || 0);
      inv_ws.push([it.sku||'', it.name||'', it.category||'', qty, Number(it.unitCost||0).toFixed(2), Number(it.unitPrice||0).toFixed(2), (qty*Number(it.unitCost||0)).toFixed(2), (qty*Number(it.unitPrice||0)).toFixed(2)]);
    });
    const inv_wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(inv_wb, xlsx.utils.aoa_to_sheet(inv_ws), 'Inventory');
    const inv_buf = xlsx.write(inv_wb, { type:'buffer', bookType:'xlsx' });
    archive.append(inv_buf, { name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx` });

    // Sales XLSX
    const saleRows = await Sale.find({}).lean();
    const sales_ws = [["L&B Company - Sales Report"], ["Date:", new Date().toISOString().slice(0,10)], [], ["Invoice","Product","Quantity","Total","Date"]];
    saleRows.forEach(r => sales_ws.push([r.invoice||'', r.product||'', r.quantity||0, (Number(r.total)||0).toFixed(2), (r.date? new Date(r.date).toISOString().slice(0,10):'')]));
    const sales_wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(sales_wb, xlsx.utils.aoa_to_sheet(sales_ws), 'Sales');
    const sales_buf = xlsx.write(sales_wb, { type:'buffer', bookType:'xlsx' });
    archive.append(sales_buf, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx` });

    // Orders XLSX
    const orderRows = await Order.find({}).lean();
    const order_ws = [["L&B Company - Orders Report"], ["Date:", new Date().toISOString().slice(0,10)], [], ["Order #","Customer","Items","Total","Status","Date"]];
    orderRows.forEach(o => order_ws.push([o.orderNumber||'', o.customerName||'', (Array.isArray(o.items)?o.items.length:0), (Number(o.total)||0).toFixed(2), o.status||'', (o.date? new Date(o.date).toISOString().slice(0,10):'')]));
    const order_wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(order_wb, xlsx.utils.aoa_to_sheet(order_ws), 'Orders');
    const order_buf = xlsx.write(order_wb, { type:'buffer', bookType:'xlsx' });
    archive.append(order_buf, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx` });

    archive.finalize();
    await logActivity(req.headers['x-username'], 'Generated ZIP of all reports');
  } catch (err) {
    console.error('zip error', err);
    return res.status(500).json({ message:'Failed to create ZIP' });
  }
});

// ===== Logs =====
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
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
