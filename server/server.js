// server/server.js
// FINAL FULL VERSION
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// DB
if (!MONGODB_URI) { console.error("MONGODB_URI missing"); process.exit(1); }
mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error(err));

const { Schema } = mongoose;

// Schemas
const UserSchema = new Schema({ username: { type: String, unique: true }, password: { type: String } });
const User = mongoose.model("User", UserSchema);

const CompanySchema = new Schema({
  name: { type: String, default: "L&B Company" },
  address: { type: String, default: "Melaka, Malaysia" },
  phone: { type: String, default: "0123456789" },
  email: { type: String, default: "admin@lb.com" }
});
const Company = mongoose.model("Company", CompanySchema);

const InventorySchema = new Schema({
  sku: String, name: String, category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const PurchaseSchema = new Schema({
  purchaseId: String, supplier: String, purchaseDate: Date, notes: String,
  items: [{ sku: String, productName: String, quantity: Number, purchasePrice: Number, totalAmount: Number }],
  totalAmount: Number, createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", PurchaseSchema);

const SalesSchema = new Schema({
  salesId: String, customer: String, salesDate: Date, notes: String,
  items: [{ sku: String, productName: String, quantity: Number, salePrice: Number, totalAmount: Number }],
  totalAmount: Number, createdAt: { type: Date, default: Date.now }
});
const Sales = mongoose.model("Sales", SalesSchema);

const FolderSchema = new Schema({ name: String, parentFolder: { type: Schema.Types.ObjectId, default: null }, createdBy: String });
const Folder = mongoose.model("Folder", FolderSchema);

const DocumentSchema = new Schema({
  name: String, size: Number, date: { type: Date, default: Date.now },
  data: Buffer, contentType: String, folder: { type: Schema.Types.ObjectId, default: null },
  tags: [String], createdBy: String, reportType: { type: String, default: '' } // CRITICAL FIELD FOR FIX
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({ user: String, action: String, time: { type: Date, default: Date.now } });
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

async function logActivity(user, action) {
  try { await ActivityLog.create({ user: user || "System", action, time: new Date() }); } catch (err) {}
}

async function getCompanyInfo() {
  let c = await Company.findOne({});
  if (!c) c = await Company.create({});
  return c;
}

// Routes
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });
  if (user) res.json({ success: true, user: username });
  else res.status(401).json({ success: false });
});

app.get("/api/company", async (req, res) => res.json(await getCompanyInfo()));
app.put("/api/company", async (req, res) => {
  await Company.updateOne({}, req.body, { upsert: true });
  res.json({ success: true });
});

// Inventory CRUD
app.get("/api/inventory", async (req, res) => {
  const items = await Inventory.find({}).lean();
  res.json(items.map(i => ({ ...i, id: i._id.toString() })));
});
app.post("/api/inventory", async (req, res) => {
  const item = await Inventory.create(req.body);
  logActivity(req.headers['x-username'], `Added product ${item.sku}`);
  res.status(201).json(item);
});
app.put("/api/inventory/:id", async (req, res) => {
  await Inventory.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});
app.delete("/api/inventory/:id", async (req, res) => {
  await Inventory.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

// Purchases
app.get("/api/purchases", async (req, res) => {
  const p = await Purchase.find({}).sort({purchaseDate: -1}).lean();
  res.json(p.map(x => ({...x, id: x._id.toString()})));
});
app.get("/api/purchases/:id", async (req, res) => res.json(await Purchase.findById(req.params.id)));
app.post("/api/purchases", async (req, res) => {
  const { items } = req.body;
  const purchaseId = `PUR-${Date.now()}`;
  let totalAmount = 0;
  for(let i of items) {
    totalAmount += (i.quantity * i.purchasePrice);
    const inv = await Inventory.findOne({sku: i.sku});
    if(inv) { inv.quantity += i.quantity; inv.unitCost = i.purchasePrice; await inv.save(); }
  }
  const p = await Purchase.create({ ...req.body, purchaseId, totalAmount });
  res.status(201).json(p);
});
app.delete("/api/purchases/:id", async (req, res) => {
  const p = await Purchase.findById(req.params.id);
  if(p) {
    for(let i of p.items) {
      const inv = await Inventory.findOne({sku: i.sku});
      if(inv) { inv.quantity = Math.max(0, inv.quantity - i.quantity); await inv.save(); }
    }
    await Purchase.findByIdAndDelete(req.params.id);
  }
  res.status(204).send();
});

// Sales
app.get("/api/sales", async (req, res) => {
  const s = await Sales.find({}).sort({salesDate: -1}).lean();
  res.json(s.map(x => ({...x, id: x._id.toString()})));
});
app.get("/api/sales/:id", async (req, res) => res.json(await Sales.findById(req.params.id)));
app.post("/api/sales", async (req, res) => {
  const { items } = req.body;
  const salesId = `SAL-${Date.now()}`;
  let totalAmount = 0;
  for(let i of items) {
    totalAmount += (i.quantity * i.salePrice);
    const inv = await Inventory.findOne({sku: i.sku});
    if(inv) { 
      if(inv.quantity < i.quantity) return res.status(400).json({message: `Low stock: ${i.productName}`});
      inv.quantity -= i.quantity; 
      await inv.save(); 
    }
  }
  const s = await Sales.create({ ...req.body, salesId, totalAmount });
  res.status(201).json(s);
});
app.delete("/api/sales/:id", async (req, res) => {
  const s = await Sales.findById(req.params.id);
  if(s) {
    for(let i of s.items) {
      const inv = await Inventory.findOne({sku: i.sku});
      if(inv) { inv.quantity += i.quantity; await inv.save(); }
    }
    await Sales.findByIdAndDelete(req.params.id);
  }
  res.status(204).send();
});

// =========================================
// PDF GENERATION (FIXED LAYOUTS)
// =========================================

function drawHeader(doc, company, title) {
  doc.fontSize(16).text(company.name, 40, 40);
  doc.fontSize(10).text(company.address, 40, 65, {width: 200});
  doc.fontSize(14).text(title, 400, 40, {align: 'right'});
  doc.moveTo(40, 100).lineTo(550, 100).stroke();
  return 120;
}

// Purchase Report
app.post("/api/purchases/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    let q = {}; if(startDate && endDate) q.purchaseDate = {$gte: new Date(startDate), $lte: new Date(endDate)};
    const data = await Purchase.find(q).sort({purchaseDate: -1}).lean();
    const company = await getCompanyInfo();

    const doc = new PDFDocument({size: 'A4', margin: 40, bufferPages: true});
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const name = `Purchase_Report_${Date.now()}.pdf`;
      await Doc.create({ name, size: buf.length, data: buf, contentType: 'application/pdf', reportType: 'purchase-report', tags: ['purchase-report', 'report'] });
      res.set("Content-Disposition", `attachment; filename="${name}"`);
      res.send(buf);
    });

    let y = drawHeader(doc, company, 'PURCHASE REPORT');

    data.forEach(p => {
      if(y > 700) { doc.addPage(); y = drawHeader(doc, company, 'PURCHASE REPORT'); }
      doc.font('Helvetica-Bold').fontSize(10).text(`${p.purchaseId} - ${p.supplier} (${new Date(p.purchaseDate).toLocaleDateString()})`, 40, y);
      y += 15;
      
      // Table Header
      doc.fontSize(9).text('SKU', 40, y); doc.text('Item', 100, y); doc.text('Qty', 300, y); doc.text('Price', 360, y); doc.text('Total', 460, y);
      doc.moveTo(40, y+10).lineTo(550, y+10).stroke();
      y += 15;
      
      doc.font('Helvetica');
      p.items.forEach(i => {
        if(y > 720) { doc.addPage(); y = 50; }
        doc.text(i.sku, 40, y);
        doc.text(i.productName, 100, y, {width: 190});
        doc.text(i.quantity.toString(), 300, y);
        doc.text(i.purchasePrice.toFixed(2), 360, y);
        doc.text(i.totalAmount.toFixed(2), 460, y);
        y += 15;
      });
      doc.font('Helvetica-Bold').text(`Total: RM ${p.totalAmount.toFixed(2)}`, 460, y+5);
      y += 25;
    });

    doc.end();
  } catch(e) { res.status(500).send('Error'); }
});

// Sales Report
app.post("/api/sales/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    let q = {}; if(startDate && endDate) q.salesDate = {$gte: new Date(startDate), $lte: new Date(endDate)};
    const data = await Sales.find(q).sort({salesDate: -1}).lean();
    const company = await getCompanyInfo();

    const doc = new PDFDocument({size: 'A4', margin: 40, bufferPages: true});
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const name = `Sales_Report_${Date.now()}.pdf`;
      await Doc.create({ name, size: buf.length, data: buf, contentType: 'application/pdf', reportType: 'sales-report', tags: ['sales-report', 'report'] });
      res.set("Content-Disposition", `attachment; filename="${name}"`);
      res.send(buf);
    });

    let y = drawHeader(doc, company, 'SALES REPORT');

    data.forEach(s => {
      if(y > 700) { doc.addPage(); y = drawHeader(doc, company, 'SALES REPORT'); }
      doc.font('Helvetica-Bold').fontSize(10).text(`${s.salesId} - ${s.customer} (${new Date(s.salesDate).toLocaleDateString()})`, 40, y);
      y += 15;
      
      doc.fontSize(9).text('SKU', 40, y); doc.text('Item', 100, y); doc.text('Qty', 300, y); doc.text('Price', 360, y); doc.text('Total', 460, y);
      doc.moveTo(40, y+10).lineTo(550, y+10).stroke();
      y += 15;
      
      doc.font('Helvetica');
      s.items.forEach(i => {
        if(y > 720) { doc.addPage(); y = 50; }
        doc.text(i.sku, 40, y);
        doc.text(i.productName, 100, y, {width: 190});
        doc.text(i.quantity.toString(), 300, y);
        doc.text(i.salePrice.toFixed(2), 360, y);
        doc.text(i.totalAmount.toFixed(2), 460, y);
        y += 15;
      });
      doc.font('Helvetica-Bold').text(`Total: RM ${s.totalAmount.toFixed(2)}`, 460, y+5);
      y += 25;
    });

    doc.end();
  } catch(e) { res.status(500).send('Error'); }
});

// Inventory Report
app.post("/api/inventory/report/pdf", async (req, res) => {
  const items = await Inventory.find({}).lean();
  const company = await getCompanyInfo();
  
  const doc = new PDFDocument({size: 'A4', layout: 'landscape', margin: 40});
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', async () => {
    const buf = Buffer.concat(chunks);
    const name = `Inventory_Report_${Date.now()}.pdf`;
    await Doc.create({ name, size: buf.length, data: buf, contentType: 'application/pdf', reportType: 'inventory-report', tags: ['inventory-report', 'report'] });
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.send(buf);
  });
  
  doc.fontSize(18).text(company.name, 40, 40);
  doc.fontSize(14).text("INVENTORY REPORT", 600, 40, {align: 'right'});
  
  let y = 80;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('SKU', 40, y); doc.text('Name', 120, y); doc.text('Qty', 350, y); doc.text('Cost', 420, y); doc.text('Price', 500, y); doc.text('Value', 600, y);
  doc.moveTo(40, y+12).lineTo(760, y+12).stroke();
  y += 20;
  
  doc.font('Helvetica');
  items.forEach(i => {
    if(y > 500) { doc.addPage(); y = 40; }
    doc.text(i.sku, 40, y);
    doc.text(i.name, 120, y);
    doc.text(i.quantity.toString(), 350, y);
    doc.text(i.unitCost.toFixed(2), 420, y);
    doc.text(i.unitPrice.toFixed(2), 500, y);
    doc.text((i.quantity*i.unitCost).toFixed(2), 600, y);
    y += 15;
  });
  doc.end();
});

// Single Invoices
app.get("/api/purchases/invoice/:id", (req, res) => genInv(req, res, Purchase, 'Purchase Invoice', 'purchase-invoice'));
app.get("/api/sales/invoice/:id", (req, res) => genInv(req, res, Sales, 'Sales Invoice', 'sales-invoice'));

async function genInv(req, res, Model, title, type) {
  const d = await Model.findById(req.params.id);
  const company = await getCompanyInfo();
  
  const doc = new PDFDocument({size: 'A4', margin: 40});
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', async () => {
    const buf = Buffer.concat(chunks);
    const name = `${title.replace(' ','_')}_${d._id}.pdf`;
    await Doc.create({ name, size: buf.length, data: buf, contentType: 'application/pdf', reportType: type, tags: [type, 'invoice'] });
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.send(buf);
  });
  
  doc.fontSize(20).text(company.name, 40, 40);
  doc.fontSize(14).text(title, 400, 40, {align: 'right'});
  
  const ref = d.purchaseId || d.salesId;
  const client = d.supplier || d.customer;
  
  doc.fontSize(10).text(`Ref: ${ref}`, 400, 65, {align: 'right'});
  doc.text(`To: ${client}`, 40, 100);
  
  let y = 140;
  doc.rect(40, y, 515, 20).fill('#eee').stroke();
  doc.fillColor('black').text('Item', 50, y+5); doc.text('Qty', 300, y+5); doc.text('Price', 380, y+5); doc.text('Total', 460, y+5);
  y += 20;
  
  d.items.forEach(i => {
    const price = i.purchasePrice || i.salePrice;
    doc.text(i.productName, 50, y+5);
    doc.text(i.quantity.toString(), 300, y+5);
    doc.text(price.toFixed(2), 380, y+5);
    doc.text(i.totalAmount.toFixed(2), 460, y+5);
    y += 20;
  });
  
  doc.moveTo(40, y).lineTo(555, y).stroke();
  doc.fontSize(12).text(`Total: RM ${d.totalAmount.toFixed(2)}`, 400, y+10);
  doc.end();
}

// =========================================
// STATEMENTS FIX
// =========================================
app.get("/api/statements/:type", async (req, res) => {
  const { type } = req.params;
  let q = {};
  // Explicitly check reportType
  if(type === 'inventory-reports') q.reportType = 'inventory-report';
  else if(type === 'purchase-reports') q.reportType = 'purchase-report';
  else if(type === 'sales-reports') q.reportType = 'sales-report';
  else if(type === 'purchase-invoices') q.reportType = 'purchase-invoice';
  else if(type === 'sales-invoices') q.reportType = 'sales-invoice';
  else if(type === 'all-reports') q.reportType = {$in: ['inventory-report','purchase-report','sales-report']};
  else if(type === 'all-invoices') q.reportType = {$in: ['purchase-invoice','sales-invoice']};
  
  const docs = await Doc.find(q).select('-data').sort({date: -1}).lean();
  res.json({documents: docs.map(d => ({...d, id: d._id.toString()}))});
});

app.get("/api/statements-summary", async (req, res) => {
  const c = async (t) => await Doc.countDocuments({reportType: t});
  const ir = await c('inventory-report');
  const pr = await c('purchase-report');
  const sr = await c('sales-report');
  const pi = await c('purchase-invoice');
  const si = await c('sales-invoice');
  res.json({summary: {
    inventoryReports: ir, purchaseReports: pr, salesReports: sr,
    purchaseInvoices: pi, salesInvoices: si,
    totalReports: ir+pr+sr, totalInvoices: pi+si,
    totalDocuments: await Doc.countDocuments({})
  }});
});

// Folders & Docs
app.get("/api/folders", async (req, res) => res.json((await Folder.find({})).map(x=>({...x, id: x._id.toString()}))));
app.post("/api/folders", async (req, res) => res.json(await Folder.create(req.body)));
app.delete("/api/folders/:id", async (req, res) => {
  const k = await Folder.countDocuments({parentFolder: req.params.id});
  const d = await Doc.countDocuments({folder: req.params.id});
  if(k>0 || d>0) return res.status(400).json({message: 'Not empty'});
  await Folder.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

app.get("/api/documents", async (req, res) => {
  const f = req.query.folder === 'root' ? null : req.query.folder;
  const docs = await Doc.find({folder: f}).select('-data').sort({date: -1}).lean();
  res.json(docs.map(x=>({...x, id: x._id.toString()})));
});
app.post("/api/documents", async (req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    if(chunks.length === 0) return res.status(400).send('Empty');
    const buf = Buffer.concat(chunks);
    const d = await Doc.create({
      name: req.headers['x-file-name'], size: buf.length, data: buf, 
      contentType: req.headers['content-type'], folder: req.headers['x-folder-id'] || null
    });
    res.json(d);
  });
});
app.get("/api/documents/download/:id", async (req, res) => {
  const d = await Doc.findById(req.params.id);
  if(!d) return res.status(404).send('Not found');
  res.set("Content-Disposition", `attachment; filename="${d.name}"`);
  res.set("Content-Type", d.contentType);
  res.send(d.data);
});
app.get("/api/documents/preview/:id", async (req, res) => {
  const d = await Doc.findById(req.params.id);
  if(!d) return res.status(404).send('Not found');
  res.set("Content-Type", d.contentType);
  res.send(d.data);
});
app.delete("/api/documents/:id", async (req, res) => {
  await Doc.findByIdAndDelete(req.params.id);
  res.status(204).send();
});

// Logs
app.get("/api/logs", async (req, res) => res.json(await ActivityLog.find({}).sort({time: -1}).limit(50)));

// Init
async function init() {
  if(await User.countDocuments({}) === 0) await User.create({username: "admin", password: "password"});
  await getCompanyInfo();
  ['Reports','Invoices','Documents'].forEach(async n => {
    if(!await Folder.findOne({name: n})) await Folder.create({name: n, createdBy: 'System'});
  });
}
init();

// Static
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ message: "Not found" });
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
