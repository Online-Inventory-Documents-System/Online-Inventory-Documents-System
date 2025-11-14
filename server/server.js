// server/server.js
// MongoDB (Mongoose) based server for Online Inventory, Orders & Sales + Reports (XLSX/PDF/ZIP)

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const mongoose = require('mongoose');
const path = require('path');
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

// --- user
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// --- inventory
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

// --- documents
const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

// --- activity log
const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// --- orders (new)
const OrderItemSchema = new Schema({
  sku: String,
  name: String,
  qty: Number,
  unitPrice: Number
}, { _id: false });

const OrdersSchema = new Schema({
  orderNumber: String,           // optional, auto or provided
  customerName: String,
  items: [OrderItemSchema],
  total: { type: Number, default: 0 },
  status: { type: String, default: 'pending' }, // pending, shipped, completed, cancelled
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrdersSchema);

// --- sales (new)
const SalesItemSchema = new Schema({
  sku: String,
  name: String,
  qty: Number,
  unitPrice: Number
}, { _id: false });

const SalesSchema = new Schema({
  invoiceNumber: String,
  items: [SalesItemSchema],
  total: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SalesSchema);

// ===== safer logActivity: suppress near-duplicate entries =====
const DUPLICATE_WINDOW_MS = 15 * 1000; // 15 seconds to avoid noisy duplicates

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

// ===== Orders CRUD (new) =====
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    const normalized = orders.map(o => ({ ...o, id: o._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const payload = req.body || {};
    // Calculate total if not provided
    let total = payload.total || 0;
    if ((!payload.total || payload.total === 0) && Array.isArray(payload.items)) {
      total = payload.items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unitPrice||0)), 0);
    }
    const order = await Order.create({ ...payload, total });
    await logActivity(req.headers['x-username'], `Created order for ${order.customerName || 'Unknown'}`);
    const normalized = { ...order.toObject(), id: order._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error('order create error', err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};
    if (payload.items && Array.isArray(payload.items) && (!payload.total || payload.total === 0)) {
      payload.total = payload.items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unitPrice||0)), 0);
    }
    const order = await Order.findByIdAndUpdate(id, payload, { new:true });
    if (!order) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Updated order ${order._id.toString()}`);
    return res.json({ ...order.toObject(), id: order._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const order = await Order.findByIdAndDelete(id);
    if (!order) return res.status(404).json({ message:'Order not found' });
    await logActivity(req.headers['x-username'], `Deleted order ${order._id.toString()}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Sales CRUD (new) =====
app.get('/api/sales', async (req, res) => {
  try {
    const sales = await Sale.find({}).sort({ createdAt: -1 }).lean();
    const normalized = sales.map(s => ({ ...s, id: s._id.toString() }));
    return res.json(normalized);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    const payload = req.body || {};
    let total = payload.total || 0;
    if ((!payload.total || payload.total === 0) && Array.isArray(payload.items)) {
      total = payload.items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unitPrice||0)), 0);
    }
    const sale = await Sale.create({ ...payload, total });
    await logActivity(req.headers['x-username'], `Recorded sale (invoice: ${sale.invoiceNumber || 'N/A'})`);
    const normalized = { ...sale.toObject(), id: sale._id.toString() };
    return res.status(201).json(normalized);
  } catch(err){ console.error('sale create error', err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/sales/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const payload = req.body || {};
    if (payload.items && Array.isArray(payload.items) && (!payload.total || payload.total === 0)) {
      payload.total = payload.items.reduce((s, it) => s + (Number(it.qty||0) * Number(it.unitPrice||0)), 0);
    }
    const sale = await Sale.findByIdAndUpdate(id, payload, { new:true });
    if (!sale) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'], `Updated sale ${sale._id.toString()}`);
    return res.json({ ...sale.toObject(), id: sale._id.toString() });
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/sales/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const sale = await Sale.findByIdAndDelete(id);
    if (!sale) return res.status(404).json({ message:'Sale not found' });
    await logActivity(req.headers['x-username'], `Deleted sale ${sale._id.toString()}`);
    return res.status(204).send();
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Report Helpers =====
function buildInventoryWorksheetData(items) {
  const header = ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"];
  const rows = [header];
  let totalValue = 0, totalRevenue = 0;
  items.forEach(it => {
    const qty = Number(it.quantity || 0);
    const uc = Number(it.unitCost || 0);
    const up = Number(it.unitPrice || 0);
    const invVal = qty * uc;
    const rev = qty * up;
    totalValue += invVal;
    totalRevenue += rev;
    rows.push([it.sku||'', it.name||'', it.category||'', qty, uc.toFixed(2), up.toFixed(2), invVal.toFixed(2), rev.toFixed(2)]);
  });
  rows.push([]);
  rows.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);
  return rows;
}

function buildOrdersWorksheetData(orders) {
  const rows = [
    ["Order #","Customer","Status","Items (SKU x qty)","Total","Created At"]
  ];
  orders.forEach(o => {
    const itemsText = (o.items || []).map(it => `${it.sku||it.name||''} x${it.qty||0}`).join('; ');
    rows.push([o.orderNumber || o._id.toString(), o.customerName||'', o.status||'', itemsText, Number(o.total||0).toFixed(2), (o.createdAt? new Date(o.createdAt).toISOString().slice(0,10):'')]);
  });
  return rows;
}

function buildSalesWorksheetData(sales) {
  const rows = [
    ["Invoice","Items (SKU x qty)","Total","Created At"]
  ];
  sales.forEach(s => {
    const itemsText = (s.items || []).map(it => `${it.sku||it.name||''} x${it.qty||0}`).join('; ');
    rows.push([s.invoiceNumber || s._id.toString(), itemsText, Number(s.total||0).toFixed(2), (s.createdAt? new Date(s.createdAt).toISOString().slice(0,10):'')]);
  });
  return rows;
}

function createXlsxBufferFromAOA(aoa, sheetName = 'Report') {
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

// ===== Inventory report (XLSX) - date-only header (already present earlier) =====
app.get('/api/inventory/report', async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;
    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const itemsData = buildInventoryWorksheetData(items);
    const full = ws_data.concat(itemsData);
    const wb_out = createXlsxBufferFromAOA(full, 'Inventory Report');

    // Persist document record
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Inventory Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('inventory report error', err);
    return res.status(500).json({ message:'Report generation failed' });
  }
});

// ===== Orders report (XLSX) =====
app.get('/api/orders/report', async (req, res) => {
  try {
    const orders = await Order.find({}).lean();
    const filenameBase = `Orders_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;

    const header = [
      ["L&B Company - Orders Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const rows = buildOrdersWorksheetData(orders);
    const aoa = header.concat(rows);
    const wb_out = createXlsxBufferFromAOA(aoa, 'Orders Report');

    // Persist doc
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Orders Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('orders report error', err);
    return res.status(500).json({ message:'Orders report generation failed' });
  }
});

// ===== Sales report (XLSX) =====
app.get('/api/sales/report', async (req, res) => {
  try {
    const sales = await Sale.find({}).lean();
    const filenameBase = `Sales_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;

    const header = [
      ["L&B Company - Sales Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const rows = buildSalesWorksheetData(sales);
    const aoa = header.concat(rows);
    const wb_out = createXlsxBufferFromAOA(aoa, 'Sales Report');

    // Persist doc
    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated and saved Sales Report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);
  } catch (err) {
    console.error('sales report error', err);
    return res.status(500).json({ message:'Sales report generation failed' });
  }
});

// ===== PDF generation helpers =====
function generateOrdersPdfBuffer(orders) {
  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];
  doc.on('data', chunk => buffers.push(chunk));
  doc.on('end', () => { /* handled by caller via promise */ });

  doc.fontSize(18).text('L&B Company - Orders Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Date: ${new Date().toISOString().slice(0,10)}`, { align: 'left' });
  doc.moveDown(0.5);

  orders.forEach((o, idx) => {
    doc.fontSize(12).text(`Order: ${o.orderNumber || o._id.toString()}  |  Customer: ${o.customerName || ''}  |  Status: ${o.status || ''}`);
    doc.fontSize(10);
    (o.items || []).forEach(it => {
      doc.text(`   - ${it.sku || it.name}  x${it.qty}  @ RM ${Number(it.unitPrice||0).toFixed(2)}`);
    });
    doc.text(`  Total: RM ${Number(o.total||0).toFixed(2)}`);
    if (idx < orders.length - 1) doc.moveDown();
  });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('finish', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);
  });
}

function generateSalesPdfBuffer(sales) {
  const doc = new PDFDocument({ margin: 40 });
  const buffers = [];
  doc.on('data', chunk => buffers.push(chunk));
  doc.on('end', () => { /* handled by caller via promise */ });

  doc.fontSize(18).text('L&B Company - Sales Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Date: ${new Date().toISOString().slice(0,10)}`, { align: 'left' });
  doc.moveDown(0.5);

  sales.forEach((s, idx) => {
    doc.fontSize(12).text(`Invoice: ${s.invoiceNumber || s._id.toString()}`);
    doc.fontSize(10);
    (s.items || []).forEach(it => {
      doc.text(`   - ${it.sku || it.name}  x${it.qty}  @ RM ${Number(it.unitPrice||0).toFixed(2)}`);
    });
    doc.text(`  Total: RM ${Number(s.total||0).toFixed(2)}`);
    if (idx < sales.length - 1) doc.moveDown();
  });

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('finish', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);
  });
}

// ===== PDF endpoints =====
app.get('/api/orders/report/pdf', async (req, res) => {
  try {
    const orders = await Order.find({}).lean();
    const filename = `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    const pdfBuffer = await generateOrdersPdfBuffer(orders);

    // Save doc meta for index (optional)
    await Doc.create({ name: filename, size: pdfBuffer.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Orders PDF: ${filename}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('orders pdf error', err);
    return res.status(500).json({ message: 'Failed to generate Orders PDF' });
  }
});

app.get('/api/sales/report/pdf', async (req, res) => {
  try {
    const sales = await Sale.find({}).lean();
    const filename = `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    const pdfBuffer = await generateSalesPdfBuffer(sales);

    await Doc.create({ name: filename, size: pdfBuffer.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated Sales PDF: ${filename}`);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('sales pdf error', err);
    return res.status(500).json({ message: 'Failed to generate Sales PDF' });
  }
});

// ===== ZIP all reports endpoint =====
app.get('/api/reports/zip', async (req, res) => {
  try {
    // Gather data and generate buffers
    const [inventoryItems, orders, sales] = await Promise.all([
      Inventory.find({}).lean(),
      Order.find({}).lean(),
      Sale.find({}).lean()
    ]);

    // Build XLSX buffers
    const inventoryAoaHeader = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const inventoryAoa = inventoryAoaHeader.concat(buildInventoryWorksheetData(inventoryItems));
    const inventoryXlsx = createXlsxBufferFromAOA(inventoryAoa, 'Inventory');

    const ordersAoaHeader = [
      ["L&B Company - Orders Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const ordersAoa = ordersAoaHeader.concat(buildOrdersWorksheetData(orders));
    const ordersXlsx = createXlsxBufferFromAOA(ordersAoa, 'Orders');

    const salesAoaHeader = [
      ["L&B Company - Sales Report"],
      ["Date:", new Date().toISOString().slice(0,10)],
      []
    ];
    const salesAoa = salesAoaHeader.concat(buildSalesWorksheetData(sales));
    const salesXlsx = createXlsxBufferFromAOA(salesAoa, 'Sales');

    // Build PDFs
    const [ordersPdf, salesPdf] = await Promise.all([
      generateOrdersPdfBuffer(orders),
      generateSalesPdfBuffer(sales)
    ]);

    // Create zip and stream to response
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="All_Reports_${new Date().toISOString().slice(0,10)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    // Append buffers with filenames
    archive.append(inventoryXlsx, { name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    archive.append(ordersXlsx, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx` });
    archive.append(salesXlsx, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx` });

    archive.append(ordersPdf, { name: `Orders_Report_${new Date().toISOString().slice(0,10)}.pdf` });
    archive.append(salesPdf, { name: `Sales_Report_${new Date().toISOString().slice(0,10)}.pdf` });

    await archive.finalize();

    // Persist docs metadata for the individual files (optional)
    await Doc.create({ name: `Inventory_Report_${new Date().toISOString().slice(0,10)}.xlsx`, size: inventoryXlsx.length, date: new Date() });
    await Doc.create({ name: `Orders_Report_${new Date().toISOString().slice(0,10)}.xlsx`, size: ordersXlsx.length, date: new Date() });
    await Doc.create({ name: `Sales_Report_${new Date().toISOString().slice(0,10)}.xlsx`, size: salesXlsx.length, date: new Date() });
    await logActivity(req.headers['x-username'], `Generated ZIP of all reports`);

    // response will be ended by archiver stream
  } catch (err) {
    console.error('zip reports error', err);
    return res.status(500).json({ message: 'Failed to generate ZIP of reports' });
  }
});

// ===== Documents endpoints (download helper) =====
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
