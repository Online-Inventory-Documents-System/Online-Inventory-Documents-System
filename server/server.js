// server.js
// Complete Node.js server for Online Inventory & Documents System

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const ExcelJS = require('exceljs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inventoryDB';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Models
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const inventorySchema = new mongoose.Schema({
  sku: { type: String, required: true },
  name: { type: String, required: true },
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model('Inventory', inventorySchema);

const activityLogSchema = new mongoose.Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

const purchaseSchema = new mongoose.Schema({
  purchaseId: { type: String, unique: true, required: true },
  supplier: { type: String, required: true },
  supplierContact: String,
  purchaseDate: { type: Date, default: Date.now },
  items: [{
    sku: String,
    productName: String,
    quantity: Number,
    purchasePrice: Number,
    totalAmount: Number
  }],
  totalAmount: Number,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model('Purchase', purchaseSchema);

const salesSchema = new mongoose.Schema({
  salesId: { type: String, unique: true, required: true },
  customer: { type: String, required: true },
  customerContact: String,
  salesDate: { type: Date, default: Date.now },
  items: [{
    sku: String,
    productName: String,
    quantity: Number,
    salePrice: Number,
    totalAmount: Number
  }],
  totalAmount: Number,
  totalProfit: Number,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});
const Sales = mongoose.model('Sales', salesSchema);

const documentSchema = new mongoose.Schema({
  name: String,
  contentType: String,
  data: Buffer,
  size: Number,
  date: { type: Date, default: Date.now },
  uploadedBy: String,
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null }
});
const Document = mongoose.model('Document', documentSchema);

const folderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  createdBy: String,
  createdAt: { type: Date, default: Date.now }
});
const Folder = mongoose.model('Folder', folderSchema);

const companySchema = new mongoose.Schema({
  name: { type: String, default: 'L&B Company' },
  address: { type: String, default: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka' },
  phone: { type: String, default: '01133127622' },
  email: { type: String, default: 'lbcompany@gmail.com' }
});
const Company = mongoose.model('Company', companySchema);

// Generate ID function
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Authentication Middleware
const authenticate = async (req, res, next) => {
  const username = req.headers['x-username'];
  if (!username) return res.status(401).json({ message: 'Unauthorized: No username provided' });
  
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Unauthorized: User not found' });
    next();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Routes
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ message: 'Invalid credentials' });
    
    await ActivityLog.create({ user: username, action: 'User logged in' });
    res.json({ message: 'Login successful' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password, securityCode } = req.body;
  if (securityCode !== 'Admin@123') {
    return res.status(403).json({ message: 'Invalid security code' });
  }
  
  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ message: 'Username already exists' });
    
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ username, password: hashed });
    await ActivityLog.create({ user: username, action: 'New user registered' });
    res.json({ message: 'Registration successful' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Company Info Routes
app.get('/api/company', async (req, res) => {
  try {
    let company = await Company.findOne();
    if (!company) {
      company = await Company.create({});
    }
    res.json(company);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/company', async (req, res) => {
  const { name, address, phone, email } = req.body;
  try {
    let company = await Company.findOne();
    if (!company) {
      company = await Company.create({ name, address, phone, email });
    } else {
      company.name = name;
      company.address = address;
      company.phone = phone;
      company.email = email;
      await company.save();
    }
    await ActivityLog.create({ 
      user: req.headers['x-username'] || 'System', 
      action: 'Updated company information' 
    });
    res.json({ message: 'Company info updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Inventory Routes
app.get('/api/inventory', authenticate, async (req, res) => {
  try {
    const items = await Inventory.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/inventory', authenticate, async (req, res) => {
  try {
    const { sku, name, category, quantity, unitCost, unitPrice } = req.body;
    const existing = await Inventory.findOne({ sku });
    if (existing) {
      return res.status(400).json({ message: 'SKU already exists' });
    }
    
    const newItem = await Inventory.create({ sku, name, category, quantity, unitCost, unitPrice });
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Added product: ${name} (${sku})` 
    });
    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/inventory/:id', authenticate, async (req, res) => {
  try {
    const updated = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Updated product: ${updated.name}` 
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/inventory/:id', authenticate, async (req, res) => {
  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    
    await Inventory.findByIdAndDelete(req.params.id);
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Deleted product: ${item.name}` 
    });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Purchase Routes
app.get('/api/purchases', authenticate, async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ purchaseDate: -1 });
    res.json(purchases);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/purchases/:id', authenticate, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/purchases', authenticate, async (req, res) => {
  try {
    const { supplier, supplierContact, purchaseDate, notes, items } = req.body;
    
    // Calculate totals
    const processedItems = items.map(item => ({
      ...item,
      totalAmount: (item.quantity || 0) * (item.purchasePrice || 0)
    }));
    
    const totalAmount = processedItems.reduce((sum, item) => sum + item.totalAmount, 0);
    
    const purchaseData = {
      purchaseId: generateId('PUR'),
      supplier,
      supplierContact,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      items: processedItems,
      totalAmount,
      notes
    };
    
    const purchase = await Purchase.create(purchaseData);
    
    // Update inventory quantities
    for (const item of items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity += item.quantity;
        inventoryItem.unitCost = item.purchasePrice; // Update unit cost
        await inventoryItem.save();
      } else {
        // Create new inventory item if it doesn't exist
        await Inventory.create({
          sku: item.sku,
          name: item.productName,
          quantity: item.quantity,
          unitCost: item.purchasePrice,
          unitPrice: item.purchasePrice * 1.3 // Add 30% markup by default
        });
      }
    }
    
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Created purchase order: ${purchase.purchaseId} for ${supplier}` 
    });
    
    res.status(201).json(purchase);
  } catch (err) {
    console.error('Purchase creation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

app.delete('/api/purchases/:id', authenticate, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase not found' });
    
    // Revert inventory quantities
    for (const item of purchase.items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = Math.max(0, inventoryItem.quantity - item.quantity);
        await inventoryItem.save();
      }
    }
    
    await Purchase.findByIdAndDelete(req.params.id);
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Deleted purchase order: ${purchase.purchaseId}` 
    });
    
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Sales Routes
app.get('/api/sales', authenticate, async (req, res) => {
  try {
    const sales = await Sales.find().sort({ salesDate: -1 });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/sales/:id', authenticate, async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sales not found' });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/sales', authenticate, async (req, res) => {
  try {
    const { customer, customerContact, salesDate, notes, items } = req.body;
    
    // Calculate totals and check stock
    const processedItems = [];
    let totalAmount = 0;
    let totalProfit = 0;
    
    for (const item of items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (!inventoryItem) {
        return res.status(400).json({ message: `Product ${item.productName} (${item.sku}) not found in inventory` });
      }
      
      if (inventoryItem.quantity < item.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${item.productName}. Available: ${inventoryItem.quantity}, Requested: ${item.quantity}` 
        });
      }
      
      const itemTotal = (item.quantity || 0) * (item.salePrice || 0);
      const itemProfit = (item.salePrice - (inventoryItem.unitCost || 0)) * item.quantity;
      
      processedItems.push({
        ...item,
        totalAmount: itemTotal
      });
      
      totalAmount += itemTotal;
      totalProfit += itemProfit;
    }
    
    const salesData = {
      salesId: generateId('SAL'),
      customer,
      customerContact,
      salesDate: salesDate ? new Date(salesDate) : new Date(),
      items: processedItems,
      totalAmount,
      totalProfit,
      notes
    };
    
    const sale = await Sales.create(salesData);
    
    // Update inventory quantities
    for (const item of items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = Math.max(0, inventoryItem.quantity - item.quantity);
        await inventoryItem.save();
      }
    }
    
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Created sales order: ${sale.salesId} for ${customer}` 
    });
    
    res.status(201).json(sale);
  } catch (err) {
    console.error('Sales creation error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

app.delete('/api/sales/:id', authenticate, async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id);
    if (!sale) return res.status(404).json({ message: 'Sales not found' });
    
    // Restore inventory quantities
    for (const item of sale.items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity += item.quantity;
        await inventoryItem.save();
      }
    }
    
    await Sales.findByIdAndDelete(req.params.id);
    await ActivityLog.create({ 
      user: req.headers['x-username'], 
      action: `Deleted sales order: ${sale.salesId}` 
    });
    
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PDF Generation Functions
async function generatePurchaseInvoice(purchaseId) {
  try {
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) throw new Error('Purchase not found');
    
    const company = await Company.findOne() || {};
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Title
    page.drawText('PURCHASE INVOICE', {
      x: 50,
      y: height - 50,
      size: 24,
      font: boldFont,
      color: rgb(0, 0, 0.5)
    });
    
    // Company Info
    page.drawText(`${company.name || 'L&B Company'}`, {
      x: 50,
      y: height - 90,
      size: 12,
      font: boldFont
    });
    page.drawText(`${company.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka'}`, {
      x: 50,
      y: height - 110,
      size: 10,
      font
    });
    page.drawText(`Phone: ${company.phone || '01133127622'} | Email: ${company.email || 'lbcompany@gmail.com'}`, {
      x: 50,
      y: height - 125,
      size: 10,
      font
    });
    
    // Invoice Details
    page.drawText(`Invoice No: ${purchase.purchaseId}`, {
      x: 400,
      y: height - 90,
      size: 10,
      font
    });
    page.drawText(`Date: ${new Date(purchase.purchaseDate).toLocaleDateString()}`, {
      x: 400,
      y: height - 105,
      size: 10,
      font
    });
    
    // Supplier Info
    page.drawText('Supplier Information:', {
      x: 50,
      y: height - 160,
      size: 12,
      font: boldFont
    });
    page.drawText(`${purchase.supplier}`, {
      x: 50,
      y: height - 180,
      size: 10,
      font
    });
    if (purchase.supplierContact) {
      page.drawText(`Contact: ${purchase.supplierContact}`, {
        x: 50,
        y: height - 195,
        size: 10,
        font
      });
    }
    
    // Items Table Header
    const tableTop = height - 240;
    page.drawText('Item', { x: 50, y: tableTop, size: 10, font: boldFont });
    page.drawText('Quantity', { x: 250, y: tableTop, size: 10, font: boldFont });
    page.drawText('Price', { x: 350, y: tableTop, size: 10, font: boldFont });
    page.drawText('Total', { x: 450, y: tableTop, size: 10, font: boldFont });
    
    // Items
    let y = tableTop - 20;
    purchase.items.forEach(item => {
      page.drawText(item.productName || '', { x: 50, y, size: 10, font });
      page.drawText(item.quantity.toString(), { x: 250, y, size: 10, font });
      page.drawText(`RM ${(item.purchasePrice || 0).toFixed(2)}`, { x: 350, y, size: 10, font });
      page.drawText(`RM ${(item.totalAmount || 0).toFixed(2)}`, { x: 450, y, size: 10, font });
      y -= 20;
    });
    
    // Total
    y -= 20;
    page.drawText('Total Amount:', { x: 350, y, size: 10, font: boldFont });
    page.drawText(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, { x: 450, y, size: 10, font: boldFont });
    
    // Notes
    if (purchase.notes) {
      y -= 40;
      page.drawText('Notes:', { x: 50, y, size: 10, font: boldFont });
      page.drawText(purchase.notes, { x: 50, y: y - 15, size: 10, font, maxWidth: 500 });
    }
    
    // Footer
    page.drawText('Thank you for your business!', {
      x: 200,
      y: 50,
      size: 12,
      font: boldFont,
      color: rgb(0.5, 0.5, 0.5)
    });
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  } catch (error) {
    console.error('Error generating purchase invoice:', error);
    throw error;
  }
}

async function generateSalesInvoice(salesId) {
  try {
    const sale = await Sales.findById(salesId);
    if (!sale) throw new Error('Sales not found');
    
    const company = await Company.findOne() || {};
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Title
    page.drawText('SALES INVOICE', {
      x: 50,
      y: height - 50,
      size: 24,
      font: boldFont,
      color: rgb(0.5, 0, 0)
    });
    
    // Company Info
    page.drawText(`${company.name || 'L&B Company'}`, {
      x: 50,
      y: height - 90,
      size: 12,
      font: boldFont
    });
    page.drawText(`${company.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka'}`, {
      x: 50,
      y: height - 110,
      size: 10,
      font
    });
    page.drawText(`Phone: ${company.phone || '01133127622'} | Email: ${company.email || 'lbcompany@gmail.com'}`, {
      x: 50,
      y: height - 125,
      size: 10,
      font
    });
    
    // Invoice Details
    page.drawText(`Invoice No: ${sale.salesId}`, {
      x: 400,
      y: height - 90,
      size: 10,
      font
    });
    page.drawText(`Date: ${new Date(sale.salesDate).toLocaleDateString()}`, {
      x: 400,
      y: height - 105,
      size: 10,
      font
    });
    
    // Customer Info
    page.drawText('Customer Information:', {
      x: 50,
      y: height - 160,
      size: 12,
      font: boldFont
    });
    page.drawText(`${sale.customer}`, {
      x: 50,
      y: height - 180,
      size: 10,
      font
    });
    if (sale.customerContact) {
      page.drawText(`Contact: ${sale.customerContact}`, {
        x: 50,
        y: height - 195,
        size: 10,
        font
      });
    }
    
    // Items Table Header
    const tableTop = height - 240;
    page.drawText('Item', { x: 50, y: tableTop, size: 10, font: boldFont });
    page.drawText('Quantity', { x: 250, y: tableTop, size: 10, font: boldFont });
    page.drawText('Price', { x: 350, y: tableTop, size: 10, font: boldFont });
    page.drawText('Total', { x: 450, y: tableTop, size: 10, font: boldFont });
    
    // Items
    let y = tableTop - 20;
    sale.items.forEach(item => {
      page.drawText(item.productName || '', { x: 50, y, size: 10, font });
      page.drawText(item.quantity.toString(), { x: 250, y, size: 10, font });
      page.drawText(`RM ${(item.salePrice || 0).toFixed(2)}`, { x: 350, y, size: 10, font });
      page.drawText(`RM ${(item.totalAmount || 0).toFixed(2)}`, { x: 450, y, size: 10, font });
      y -= 20;
    });
    
    // Totals
    y -= 20;
    page.drawText('Subtotal:', { x: 350, y, size: 10, font });
    page.drawText(`RM ${(sale.totalAmount || 0).toFixed(2)}`, { x: 450, y, size: 10, font });
    
    y -= 20;
    page.drawText('Total Amount:', { x: 350, y, size: 10, font: boldFont });
    page.drawText(`RM ${(sale.totalAmount || 0).toFixed(2)}`, { x: 450, y, size: 10, font: boldFont });
    
    if (sale.totalProfit) {
      y -= 20;
      page.drawText('Profit:', { x: 350, y, size: 10, font });
      page.drawText(`RM ${(sale.totalProfit || 0).toFixed(2)}`, { x: 450, y, size: 10, font });
    }
    
    // Notes
    if (sale.notes) {
      y -= 40;
      page.drawText('Notes:', { x: 50, y, size: 10, font: boldFont });
      page.drawText(sale.notes, { x: 50, y: y - 15, size: 10, font, maxWidth: 500 });
    }
    
    // Footer
    page.drawText('Thank you for your purchase!', {
      x: 200,
      y: 50,
      size: 12,
      font: boldFont,
      color: rgb(0.5, 0.5, 0.5)
    });
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  } catch (error) {
    console.error('Error generating sales invoice:', error);
    throw error;
  }
}

async function generateInventoryReport(startDate, endDate) {
  try {
    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }
    
    const items = await Inventory.find(query).sort({ category: 1, name: 1 });
    const company = await Company.findOne() || {};
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Title
    page.drawText('INVENTORY REPORT', {
      x: 50,
      y: height - 50,
      size: 24,
      font: boldFont,
      color: rgb(0, 0.5, 0)
    });
    
    // Company Info
    page.drawText(`${company.name || 'L&B Company'}`, {
      x: 50,
      y: height - 90,
      size: 12,
      font: boldFont
    });
    
    // Date Range
    let dateRangeText = 'Full Inventory List';
    if (startDate || endDate) {
      dateRangeText = 'Period: ';
      if (startDate) dateRangeText += `${new Date(startDate).toLocaleDateString()} `;
      if (endDate) dateRangeText += `to ${new Date(endDate).toLocaleDateString()}`;
    }
    page.drawText(dateRangeText, {
      x: 50,
      y: height - 110,
      size: 10,
      font
    });
    
    page.drawText(`Generated on: ${new Date().toLocaleDateString()}`, {
      x: 50,
      y: height - 125,
      size: 10,
      font
    });
    
    // Table Header
    const tableTop = height - 160;
    const colX = [50, 150, 250, 350, 450, 500];
    const headers = ['SKU', 'Name', 'Category', 'Qty', 'Cost', 'Price'];
    
    headers.forEach((header, i) => {
      page.drawText(header, {
        x: colX[i],
        y: tableTop,
        size: 10,
        font: boldFont
      });
    });
    
    // Items
    let y = tableTop - 20;
    let totalValue = 0;
    let totalRevenue = 0;
    let totalStock = 0;
    
    items.forEach(item => {
      if (y < 100) {
        page = pdfDoc.addPage([600, 800]);
        y = height - 50;
        
        // Add continuation header
        headers.forEach((header, i) => {
          page.drawText(header, {
            x: colX[i],
            y: y,
            size: 10,
            font: boldFont
          });
        });
        y -= 20;
      }
      
      page.drawText(item.sku || '', { x: colX[0], y, size: 9, font });
      page.drawText(item.name || '', { x: colX[1], y, size: 9, font });
      page.drawText(item.category || '', { x: colX[2], y, size: 9, font });
      page.drawText(item.quantity.toString(), { x: colX[3], y, size: 9, font });
      page.drawText(`RM ${(item.unitCost || 0).toFixed(2)}`, { x: colX[4], y, size: 9, font });
      page.drawText(`RM ${(item.unitPrice || 0).toFixed(2)}`, { x: colX[5], y, size: 9, font });
      
      totalValue += item.quantity * item.unitCost;
      totalRevenue += item.quantity * item.unitPrice;
      totalStock += item.quantity;
      y -= 15;
    });
    
    // Summary
    y -= 20;
    page.drawText(`Total Items: ${items.length}`, { x: 50, y, size: 10, font: boldFont });
    page.drawText(`Total Stock: ${totalStock}`, { x: 200, y, size: 10, font: boldFont });
    
    y -= 20;
    page.drawText(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, { x: 50, y, size: 10, font: boldFont });
    page.drawText(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, { x: 300, y, size: 10, font: boldFont });
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  } catch (error) {
    console.error('Error generating inventory report:', error);
    throw error;
  }
}

// Purchase Invoice PDF
app.get('/api/purchases/invoice/:id', authenticate, async (req, res) => {
  try {
    const pdfBytes = await generatePurchaseInvoice(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Purchase_Invoice_${req.params.id}.pdf"`);
    res.send(pdfBytes);
  } catch (error) {
    res.status(500).json({ message: 'Error generating invoice' });
  }
});

// Sales Invoice PDF
app.get('/api/sales/invoice/:id', authenticate, async (req, res) => {
  try {
    const pdfBytes = await generateSalesInvoice(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sales_Invoice_${req.params.id}.pdf"`);
    res.send(pdfBytes);
  } catch (error) {
    res.status(500).json({ message: 'Error generating invoice' });
  }
});

// Inventory Report PDF
app.post('/api/inventory/report/pdf', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const pdfBytes = await generateInventoryReport(startDate, endDate);
    res.setHeader('Content-Type', 'application/pdf');
    
    let filename = 'Inventory_Report';
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate).toISOString().split('T')[0] : 'All';
      const end = endDate ? new Date(endDate).toISOString().split('T')[0] : 'All';
      filename += `_${start}_to_${end}`;
    } else {
      filename += '_Full_List';
    }
    filename += `.pdf`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBytes);
  } catch (error) {
    res.status(500).json({ message: 'Error generating report' });
  }
});

// Save Invoice to Documents
app.post('/api/purchases/save-invoice/:id', authenticate, async (req, res) => {
  try {
    const pdfBytes = await generatePurchaseInvoice(req.params.id);
    const purchase = await Purchase.findById(req.params.id);
    
    const document = new Document({
      name: `Purchase_Invoice_${purchase.purchaseId}.pdf`,
      contentType: 'application/pdf',
      data: pdfBytes,
      size: pdfBytes.length,
      uploadedBy: req.headers['x-username'],
      folderId: null // Save to root
    });
    
    await document.save();
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Saved purchase invoice: ${purchase.purchaseId} to documents`
    });
    
    res.json({ message: 'Invoice saved to documents' });
  } catch (error) {
    res.status(500).json({ message: 'Error saving invoice' });
  }
});

app.post('/api/sales/save-invoice/:id', authenticate, async (req, res) => {
  try {
    const pdfBytes = await generateSalesInvoice(req.params.id);
    const sale = await Sales.findById(req.params.id);
    
    const document = new Document({
      name: `Sales_Invoice_${sale.salesId}.pdf`,
      contentType: 'application/pdf',
      data: pdfBytes,
      size: pdfBytes.length,
      uploadedBy: req.headers['x-username'],
      folderId: null // Save to root
    });
    
    await document.save();
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Saved sales invoice: ${sale.salesId} to documents`
    });
    
    res.json({ message: 'Invoice saved to documents' });
  } catch (error) {
    res.status(500).json({ message: 'Error saving invoice' });
  }
});

// Document Routes with Folder Support
app.get('/api/documents', authenticate, async (req, res) => {
  try {
    const folderId = req.query.folder;
    let query = {};
    
    if (folderId && folderId !== 'root') {
      query.folderId = folderId;
    } else if (folderId === 'root') {
      query.folderId = null;
    }
    
    const documents = await Document.find(query).sort({ date: -1 });
    res.json(documents);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/documents', authenticate, async (req, res) => {
  try {
    const fileBuffer = req.body;
    const fileName = decodeURIComponent(req.headers['x-file-name'] || 'unnamed');
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const folderId = req.headers['x-folder-id'] || null;
    
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ message: 'File is empty' });
    }
    
    const document = new Document({
      name: fileName,
      contentType: contentType,
      data: fileBuffer,
      size: fileBuffer.length,
      uploadedBy: req.headers['x-username'],
      folderId: folderId || null
    });
    
    await document.save();
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Uploaded document: ${fileName}`
    });
    
    res.status(201).json({ message: 'File uploaded successfully', id: document._id });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Server error during upload' });
  }
});

app.get('/api/documents/download/:id', authenticate, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) return res.status(404).json({ message: 'Document not found' });
    
    res.setHeader('Content-Type', document.contentType);
    res.setHeader('Content-Length', document.data.length);
    res.setHeader('Content-Disposition', `attachment; filename="${document.name}"`);
    res.send(document.data);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/documents/preview/:id', authenticate, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) return res.status(404).json({ message: 'Document not found' });
    
    // For PDFs, serve as PDF
    if (document.contentType === 'application/pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${document.name}"`);
      return res.send(document.data);
    }
    
    // For images, serve as image
    if (document.contentType.startsWith('image/')) {
      res.setHeader('Content-Type', document.contentType);
      return res.send(document.data);
    }
    
    // For other types, offer download
    res.setHeader('Content-Type', document.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.name}"`);
    res.send(document.data);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/documents/:id', authenticate, async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) return res.status(404).json({ message: 'Document not found' });
    
    await Document.findByIdAndDelete(req.params.id);
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Deleted document: ${document.name}`
    });
    
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Cleanup corrupted documents
app.delete('/api/cleanup-documents', authenticate, async (req, res) => {
  try {
    const result = await Document.deleteMany({
      $or: [
        { data: { $exists: false } },
        { data: null },
        { size: 0 },
        { size: { $exists: false } }
      ]
    });
    
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Cleaned up ${result.deletedCount} corrupted documents`
    });
    
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Removed ${result.deletedCount} corrupted documents`
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Folder Routes
app.get('/api/folders', authenticate, async (req, res) => {
  try {
    const folders = await Folder.find().sort({ createdAt: -1 });
    res.json(folders);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/folders', authenticate, async (req, res) => {
  try {
    const { name, parentFolder } = req.body;
    
    const folder = new Folder({
      name,
      parentFolder: parentFolder || null,
      createdBy: req.headers['x-username']
    });
    
    await folder.save();
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Created folder: ${name}`
    });
    
    res.status(201).json(folder);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/folders/:id', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    const folder = await Folder.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );
    
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Renamed folder to: ${name}`
    });
    
    res.json(folder);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/folders/:id', authenticate, async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.id);
    if (!folder) return res.status(404).json({ message: 'Folder not found' });
    
    // Check if folder has documents
    const docCount = await Document.countDocuments({ folderId: req.params.id });
    if (docCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete folder. It contains ${docCount} document(s). Please delete or move them first.` 
      });
    }
    
    // Check for subfolders
    const subfolderCount = await Folder.countDocuments({ parentFolder: req.params.id });
    if (subfolderCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete folder. It contains ${subfolderCount} subfolder(s). Please delete them first.` 
      });
    }
    
    await Folder.findByIdAndDelete(req.params.id);
    await ActivityLog.create({
      user: req.headers['x-username'],
      action: `Deleted folder: ${folder.name}`
    });
    
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Statements Routes (Organized Documents)
app.get('/api/statements/:type', authenticate, async (req, res) => {
  try {
    let query = {};
    const type = req.params.type;
    
    switch(type) {
      case 'inventory-reports':
        query.name = /Inventory_Report/i;
        break;
      case 'sales-invoices':
        query.name = /Sales_Invoice/i;
        break;
      case 'purchase-invoices':
        query.name = /Purchase_Invoice/i;
        break;
      case 'other-documents':
        query.name = { $not: /(Inventory_Report|Sales_Invoice|Purchase_Invoice)/i };
        break;
    }
    
    const documents = await Document.find(query).sort({ date: -1 });
    res.json(documents);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Activity Log Routes
app.get('/api/logs', authenticate, async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ time: -1 }).limit(100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Account Management Routes
app.put('/api/account/password', authenticate, async (req, res) => {
  try {
    const { username, newPassword, securityCode } = req.body;
    if (securityCode !== 'Admin@123') {
      return res.status(403).json({ message: 'Invalid security code' });
    }
    
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();
    
    await ActivityLog.create({
      user: username,
      action: 'Changed password'
    });
    
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.delete('/api/account', authenticate, async (req, res) => {
  try {
    const { username, securityCode } = req.body;
    if (securityCode !== 'Admin@123') {
      return res.status(403).json({ message: 'Invalid security code' });
    }
    
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    await User.deleteOne({ username });
    
    await ActivityLog.create({
      user: 'System',
      action: `Deleted account: ${username}`
    });
    
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Serve React build files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
