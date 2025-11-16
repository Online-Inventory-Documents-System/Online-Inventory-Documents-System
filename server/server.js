// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System
// Updated for Orders, Sales, Company Config, Auto-Calculations, and PDF Report Generation

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit'); // NEW: Added PDFKit

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

// User Schema (Existing)
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Inventory Schema (Existing)
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

// Document Schema (Existing)
const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model('Doc', DocumentSchema);

// Log Schema (Existing)
const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', LogSchema);

// Company Config Schema (NEW)
const CompanyConfigSchema = new Schema({
  companyName: { type: String, default: 'L&B Company' },
  address: { type: String, default: 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka' },
  phone: { type: String, default: '01133127622' },
  email: { type: String, default: 'lbcompany@gmail.com' },
  taxRate: { type: Number, default: 0.00 }, // Stored as a decimal (0.00 means 0%)
});
const CompanyConfig = mongoose.model('CompanyConfig', CompanyConfigSchema);

// Line Item Schema (NEW - Used by Order and Sale)
const LineItemSchema = new Schema({
  inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
  sku: String,
  name: String,
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 }, // unitPrice for Sale/Order line item
  total: { type: Number, default: 0 }, // Quantity * UnitPrice
});

// Order Schema (NEW - Purchase from supplier)
const OrderSchema = new Schema({
  orderNumber: { type: String, unique: true },
  customerName: { type: String, default: 'Supplier Name' },
  contact: String,
  status: { type: String, enum: ['Pending', 'Approved', 'Cancelled'], default: 'Pending' },
  items: [LineItemSchema],
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// Sale Schema (NEW - Sale to customer)
const SaleSchema = new Schema({
  saleNumber: { type: String, unique: true },
  customerName: { type: String, default: 'Customer Name' },
  contact: String,
  status: { type: String, enum: ['Pending', 'Approved', 'Cancelled'], default: 'Pending' },
  items: [LineItemSchema],
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SaleSchema);


// ===== safer logActivity: suppress near-duplicate entries (Existing) =====
const DUPLICATE_WINDOW_MS = 30 * 1000; // 30 seconds

async function logActivity(user, action){
  try {
    const safeUser = (user || 'Unknown').toString();
    const safeAction = (action || '').toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).exec();

    if(last && (now - last.time.getTime()) < DUPLICATE_WINDOW_MS && last.user === safeUser && last.action === safeAction){
      return;
    }

    await ActivityLog.create({ user: safeUser, action: safeAction });
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}


// ===== PDF Generation Utility (NEW) =====

async function generatePDF(type, data) {
  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  const config = data.config || {};
  const reportData = data.reportData || {};
  const list = data.list || [];
  const totals = data.totals || {};

  // --- Header ---
  const headerY = doc.y;
  
  // Left Column (Company Info)
  doc.fontSize(14).text(config.companyName || 'L&B Company', 50, headerY, { align: 'left' });
  doc.fontSize(10).text(config.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', { align: 'left' });
  doc.text(`Phone: ${config.phone || '01133127622'}`, { align: 'left' });
  doc.text(`Email: ${config.email || 'lbcompany@gmail.com'}`, { align: 'left' });

  // Right Column (Order/Invoice Summary)
  const rightColX = 350;
  const docTitle = type === 'order' ? 'PURCHASE ORDER' : (type === 'sale' ? 'SALES INVOICE' : 'INVENTORY REPORT');
  doc.fontSize(14).fillColor('#007bff').text(docTitle, rightColX, headerY, { align: 'left' });
  doc.fillColor('black').fontSize(10);
  
  if(type !== 'inventory') {
    doc.text(`${type === 'order' ? 'Order' : 'Sale'} #: ${reportData.number || 'N/A'}`, rightColX, headerY + 20, { align: 'left' });
    doc.text(`Date: ${new Date(reportData.date || Date.now()).toLocaleString()}`, rightColX, headerY + 32, { align: 'left' });
    doc.text(`Status: ${reportData.status || 'N/A'}`, rightColX, headerY + 44, { align: 'left' });
  } else {
    doc.text(`Report Date: ${new Date().toLocaleString()}`, rightColX, headerY + 20, { align: 'left' });
    doc.text(`Total Products: ${list.length}`, rightColX, headerY + 32, { align: 'left' });
    doc.text(`Total Stock: ${totals.totalStock || 0}`, rightColX, headerY + 44, { align: 'left' });
  }
  
  doc.moveDown(2);
  doc.strokeColor('#007bff').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  // --- Customer/Report Info Section ---
  if(type !== 'inventory') {
    doc.fontSize(12).text(type === 'sale' ? 'Bill To:' : 'Supplier:', 50, doc.y, { continued: false }).moveDown(0.2);
    doc.fontSize(10).text(`Name: ${reportData.customerName || 'N/A'}`, { continued: false }).moveDown(0.2);
    doc.text(`Contact: ${reportData.contact || 'N/A'}`, { continued: true }).moveDown(1);
  } else {
    doc.fontSize(12).text('Inventory Snapshot', 50, doc.y, { continued: false }).moveDown(0.5);
    doc.fontSize(10).text(`Total Inventory Value: RM ${totals.totalValue?.toFixed(2) || '0.00'}`, { continued: false }).moveDown(1);
  }


  // --- Items Table ---
  const tableTop = doc.y + 10;
  const itemRowHeight = 25;
  const tableHeaders = type === 'inventory' 
    ? ['SKU', 'Item', 'Category', 'Qty', 'Unit Cost', 'Inventory Value']
    : ['Item', 'SKU', 'Qty', 'Unit Price', 'Total'];
  
  const colWidths = type === 'inventory' 
    ? [80, 150, 100, 50, 80, 90]
    : [180, 80, 50, 100, 100];

  let currentX = 50;

  // Draw Headers
  doc.fillColor('#007bff').rect(50, tableTop, 500, itemRowHeight).fill();
  doc.fillColor('white').fontSize(10).font('Helvetica-Bold');
  
  tableHeaders.forEach((header, i) => {
    // Inventory table uses Item Name, Order/Sale uses Item (name)
    const align = (i < 3 && type !== 'inventory') || (i < 4 && type === 'inventory') ? 'left' : 'right';
    doc.text(header, currentX + (align === 'left' ? 5 : 0), tableTop + 8, { width: colWidths[i] - (align === 'left' ? 5 : 0), align: align });
    currentX += colWidths[i];
  });

  doc.fillColor('black').font('Helvetica');
  let currentY = tableTop + itemRowHeight;

  // Draw Rows
  list.forEach((item, index) => {
    const isInventory = type === 'inventory';
    const rowColor = index % 2 === 0 ? '#f0f0f0' : '#ffffff';
    doc.fillColor(rowColor).rect(50, currentY, 500, itemRowHeight).fill();
    doc.fillColor('black').fontSize(9);

    currentX = 50;
    
    // Inventory Report Columns
    if (isInventory) {
      const invVal = (item.quantity || 0) * (item.unitCost || 0);
      doc.text(item.sku || 'N/A', currentX + 5, currentY + 8, { width: colWidths[0] - 5 }); currentX += colWidths[0];
      doc.text(item.name || 'N/A', currentX + 5, currentY + 8, { width: colWidths[1] - 5 }); currentX += colWidths[1];
      doc.text(item.category || 'N/A', currentX + 5, currentY + 8, { width: colWidths[2] - 5 }); currentX += colWidths[2];
      doc.text(String(item.quantity || 0), currentX, currentY + 8, { width: colWidths[3], align: 'right' }); currentX += colWidths[3];
      doc.text(`RM ${(item.unitCost || 0).toFixed(2)}`, currentX, currentY + 8, { width: colWidths[4], align: 'right' }); currentX += colWidths[4];
      doc.text(`RM ${invVal.toFixed(2)}`, currentX, currentY + 8, { width: colWidths[5], align: 'right' }); currentX += colWidths[5];
    } 
    // Order/Sale Report Columns
    else {
      doc.text(item.name || 'N/A', currentX + 5, currentY + 8, { width: colWidths[0] - 5 }); currentX += colWidths[0];
      doc.text(item.sku || 'N/A', currentX + 5, currentY + 8, { width: colWidths[1] - 5 }); currentX += colWidths[1];
      doc.text(String(item.quantity), currentX, currentY + 8, { width: colWidths[2], align: 'right' }); currentX += colWidths[2];
      doc.text(`RM ${item.unitPrice.toFixed(2)}`, currentX, currentY + 8, { width: colWidths[3], align: 'right' }); currentX += colWidths[3];
      doc.text(`RM ${item.total.toFixed(2)}`, currentX, currentY + 8, { width: colWidths[4], align: 'right' }); currentX += colWidths[4];
    }

    currentY += itemRowHeight;
    if (currentY > doc.page.height - 100) {
      doc.addPage();
      currentY = doc.y;
    }
  });
  
  doc.strokeColor('#007bff').lineWidth(1).moveTo(50, currentY).lineTo(550, currentY).stroke();
  doc.moveDown(1);
  
  // --- Totals ---
  if (type !== 'inventory') {
    const totalLabelX = 400;
    const totalValueX = 480;
    
    doc.font('Helvetica').fontSize(10).text('Subtotal:', totalLabelX, doc.y);
    doc.text(`RM ${totals.subtotal?.toFixed(2) || '0.00'}`, totalValueX, doc.y, { align: 'right', lineBreak: false }); doc.moveDown(0.2);

    const taxRate = config.taxRate * 100;
    doc.text(`Tax (${taxRate.toFixed(2)}%):`, totalLabelX, doc.y);
    doc.text(`RM ${totals.taxAmount?.toFixed(2) || '0.00'}`, totalValueX, doc.y, { align: 'right', lineBreak: false }); doc.moveDown(0.2);

    doc.font('Helvetica-Bold').fontSize(12).text('Grand Total:', totalLabelX, doc.y, { fill: '#007bff' });
    doc.text(`RM ${totals.grandTotal?.toFixed(2) || '0.00'}`, totalValueX, doc.y, { align: 'right', lineBreak: false, fill: '#007bff' }); doc.moveDown(1);
    doc.strokeColor('#007bff').lineWidth(2).moveTo(400, doc.y).lineTo(550, doc.y).stroke();
  }

  // --- Footer ---
  doc.y = doc.page.height - 50;
  doc.fontSize(10).fillColor('black').text('Thank you for your business.', 50, doc.y, { align: 'left' });
  doc.fontSize(8).text('Generated by L&B Inventory System', 50, doc.y + 15, { align: 'left' });
  
  doc.end();
  
  return Buffer.concat(buffers);
}

// ===== Company Config Routes (NEW) =====

app.get('/api/company-config', async (req, res) => {
  try {
    let config = await CompanyConfig.findOne({}).lean();
    if (!config) config = await CompanyConfig.create({});
    const normalized = { ...config, id: config._id.toString() };
    return res.json(normalized);
  } catch(err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error fetching config' });
  }
});

app.put('/api/company-config', async (req, res) => {
  const { companyName, address, phone, email, taxRate } = req.body;
  const user = req.headers['x-username'];
  try {
    let config = await CompanyConfig.findOne({});
    if (!config) config = await CompanyConfig.create({});
    
    config.companyName = companyName || config.companyName;
    config.address = address || config.address;
    config.phone = phone || config.phone;
    config.email = email || config.email;
    config.taxRate = parseFloat(taxRate) >= 0 ? parseFloat(taxRate) : config.taxRate;
    
    await config.save();
    await logActivity(user, `Updated company config.`);
    return res.json({ message: 'Config updated successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error updating config' });
  }
});

// ===== Helper for Order/Sale Logic (NEW) =====

async function getNextNumber(model) {
    const prefix = model === Order ? 'ORD-' : 'SAL-';
    const lastDoc = await model.findOne({}).sort({ createdAt: -1 }).exec();
    let nextNum = 1;
    if (lastDoc) {
        // Try to parse the existing number (e.g., ORD-000123)
        const numString = (lastDoc.orderNumber || lastDoc.saleNumber || '').split('-')[1];
        const lastNum = parseInt(numString);
        if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return `${prefix}${String(nextNum).padStart(6, '0')}`;
}

async function processTransaction(model, id, items, status, isUpdate = false, oldItems = []) {
    // 1. Calculate totals
    const config = await CompanyConfig.findOne({}).lean() || { taxRate: 0.00 };
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const taxAmount = subtotal * (config.taxRate || 0);
    const grandTotal = subtotal + taxAmount;
    
    // 2. Inventory Check and Update
    const inventoryUpdates = {}; // { inventoryId: deltaQty }

    // Reverse effects of old items if updating an APPROVED transaction
    if (isUpdate) {
        oldItems.forEach(item => {
            // Order: increases stock (+qty), Sale: decreases stock (-qty)
            const delta = model === Order ? -item.quantity : item.quantity;
            inventoryUpdates[item.inventoryId.toString()] = (inventoryUpdates[item.inventoryId.toString()] || 0) + delta;
        });
    }
    
    // Apply effects of new items if transaction is APPROVED
    if (status === 'Approved') {
        for (const item of items) {
            // Order: increases stock (+qty), Sale: decreases stock (-qty)
            const delta = model === Order ? item.quantity : -item.quantity;
            inventoryUpdates[item.inventoryId.toString()] = (inventoryUpdates[item.inventoryId.toString()] || 0) + delta;
        }

        // Validate stock for Sales: Check for any negative final stock for a Sale
        if (model === Sale) {
             for (const [invId, delta] of Object.entries(inventoryUpdates)) {
                const inventoryItem = await Inventory.findById(invId);
                const currentQty = inventoryItem ? inventoryItem.quantity : 0;
                
                if (currentQty + delta < 0) {
                    throw new Error(`Insufficient stock for item ${items.find(i => i.inventoryId.toString() === invId)?.name || 'Unknown'}. Available: ${currentQty}`);
                }
            }
        }
        
        // Execute inventory updates
        const inventoryPromises = Object.entries(inventoryUpdates).map(([invId, delta]) => {
            if (delta !== 0) {
                 return Inventory.findByIdAndUpdate(invId, { $inc: { quantity: delta } });
            }
            return null;
        }).filter(p => p !== null);
        
        await Promise.all(inventoryPromises);
    }
    
    return { subtotal, taxAmount, grandTotal };
}

// ===== Order Routes (NEW) =====

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).lean();
    const normalized = orders.map(o => ({ ...o, id: o._id.toString() }));
    return res.json(normalized);
  } catch(err) { return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
  const { customerName, contact, status = 'Pending', items } = req.body;
  const user = req.headers['x-username'];
  try {
    const orderNumber = await getNextNumber(Order);
    const { subtotal, taxAmount, grandTotal } = await processTransaction(Order, null, items, status);
    
    const order = await Order.create({
      orderNumber, customerName, contact, status, items, subtotal, taxAmount, grandTotal
    });
    
    await logActivity(user, `Created Order ${orderNumber} (Status: ${status})`);
    return res.status(201).json({ ...order.toObject(), id: order._id.toString() });
  } catch(err){
    console.error(err);
    return res.status(400).json({ message: err.message || 'Error creating order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
    const { customerName, contact, status, items } = req.body;
    const user = req.headers['x-username'];
    const { id } = req.params;
    try {
        const existingOrder = await Order.findById(id);
        if (!existingOrder) return res.status(404).json({ message: 'Order not found' });

        const oldItems = existingOrder.items; 
        const { subtotal, taxAmount, grandTotal } = await processTransaction(Order, id, items, status, true, oldItems);

        existingOrder.customerName = customerName;
        existingOrder.contact = contact;
        existingOrder.status = status;
        existingOrder.items = items;
        existingOrder.subtotal = subtotal;
        existingOrder.taxAmount = taxAmount;
        existingOrder.grandTotal = grandTotal;

        await existingOrder.save();
        await logActivity(user, `Updated Order ${existingOrder.orderNumber} (Status: ${status})`);
        return res.json({ message: 'Order updated successfully', order: existingOrder.toObject() });
    } catch(err) {
        console.error(err);
        return res.status(400).json({ message: err.message || 'Error updating order' });
    }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.headers['x-username'];
  try {
    const order = await Order.findById(id);
    if (order && order.status === 'Approved') {
        const inventoryPromises = order.items.map(item => Inventory.findByIdAndUpdate(item.inventoryId, { $inc: { quantity: -item.quantity } }));
        await Promise.all(inventoryPromises);
    }
    await Order.findByIdAndDelete(id);
    await logActivity(user, `Deleted Order ${order?.orderNumber || id}`);
    return res.status(204).send();
  } catch(err) { return res.status(500).json({ message: 'Server error deleting order' }); }
});

app.get('/api/orders/report/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const order = await Order.findById(id).lean();
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const config = await CompanyConfig.findOne({}).lean() || {};
    const pdfData = { config, reportData: { number: order.orderNumber, date: order.createdAt, status: order.status, customerName: order.customerName, contact: order.contact }, list: order.items, totals: { subtotal: order.subtotal, taxAmount: order.taxAmount, grandTotal: order.grandTotal } };
    const pdfBuffer = await generatePDF('order', pdfData);
    await logActivity(req.headers['x-username'], `Generated PDF Report for Order ${order.orderNumber}.`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${order.orderNumber}_Report.pdf"`);
    res.send(pdfBuffer);
  } catch(err) { return res.status(500).json({ message:'Server error generating report' }); }
});

// ===== Sales Routes (NEW) =====

app.get('/api/sales', async (req, res) => {
  try {
    const sales = await Sale.find({}).sort({ createdAt: -1 }).lean();
    const normalized = sales.map(s => ({ ...s, id: s._id.toString() }));
    return res.json(normalized);
  } catch(err) { return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/sales', async (req, res) => {
  const { customerName, contact, status = 'Pending', items } = req.body;
  const user = req.headers['x-username'];
  try {
    const saleNumber = await getNextNumber(Sale);
    const { subtotal, taxAmount, grandTotal } = await processTransaction(Sale, null, items, status);
    
    const sale = await Sale.create({
      saleNumber, customerName, contact, status, items, subtotal, taxAmount, grandTotal
    });
    
    await logActivity(user, `Created Sale ${saleNumber} (Status: ${status})`);
    return res.status(201).json({ ...sale.toObject(), id: sale._id.toString() });
  } catch(err){
    console.error(err);
    return res.status(400).json({ message: err.message || 'Error creating sale' });
  }
});

app.put('/api/sales/:id', async (req, res) => {
    const { customerName, contact, status, items } = req.body;
    const user = req.headers['x-username'];
    const { id } = req.params;
    try {
        const existingSale = await Sale.findById(id);
        if (!existingSale) return res.status(404).json({ message: 'Sale not found' });

        const oldItems = existingSale.items; 
        const { subtotal, taxAmount, grandTotal } = await processTransaction(Sale, id, items, status, true, oldItems);

        existingSale.customerName = customerName;
        existingSale.contact = contact;
        existingSale.status = status;
        existingSale.items = items;
        existingSale.subtotal = subtotal;
        existingSale.taxAmount = taxAmount;
        existingSale.grandTotal = grandTotal;

        await existingSale.save();
        await logActivity(user, `Updated Sale ${existingSale.saleNumber} (Status: ${status})`);
        return res.json({ message: 'Sale updated successfully', sale: existingSale.toObject() });
    } catch(err) {
        console.error(err);
        return res.status(400).json({ message: err.message || 'Error updating sale' });
    }
});

app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const user = req.headers['x-username'];
  try {
    const sale = await Sale.findById(id);
    if (sale && sale.status === 'Approved') {
        const inventoryPromises = sale.items.map(item => Inventory.findByIdAndUpdate(item.inventoryId, { $inc: { quantity: item.quantity } }));
        await Promise.all(inventoryPromises);
    }
    await Sale.findByIdAndDelete(id);
    await logActivity(user, `Deleted Sale ${sale?.saleNumber || id}`);
    return res.status(204).send();
  } catch(err) { return res.status(500).json({ message: 'Server error deleting sale' }); }
});

app.get('/api/sales/report/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sale = await Sale.findById(id).lean();
    if (!sale) return res.status(404).json({ message: 'Sale not found' });
    const config = await CompanyConfig.findOne({}).lean() || {};
    const pdfData = { config, reportData: { number: sale.saleNumber, date: sale.createdAt, status: sale.status, customerName: sale.customerName, contact: sale.contact }, list: sale.items, totals: { subtotal: sale.subtotal, taxAmount: sale.taxAmount, grandTotal: sale.grandTotal } };
    const pdfBuffer = await generatePDF('sale', pdfData);
    await logActivity(req.headers['x-username'], `Generated PDF Report for Sale ${sale.saleNumber}.`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${sale.saleNumber}_Invoice.pdf"`);
    res.send(pdfBuffer);
  } catch(err) { return res.status(500).json({ message:'Server error generating report' }); }
});

// ===== Inventory Routes (PDF Report Update) =====

app.get('/api/inventory/report', async (req, res) => {
  try {
    const inventoryList = await Inventory.find({}).sort({ name: 1 }).lean();
    const config = await CompanyConfig.findOne({}).lean() || {};

    let totalValue = 0;
    let totalStock = 0;
    inventoryList.forEach(item => {
        totalValue += (item.quantity * item.unitCost);
        totalStock += item.quantity;
    });

    const pdfData = {
        config: config,
        list: inventoryList,
        totals: { totalValue, totalStock }
    };

    const pdfBuffer = await generatePDF('inventory', pdfData);

    await logActivity(req.headers['x-username'], 'Generated Inventory PDF Report.');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Inventory_Report_${Date.now()}.pdf"`);
    res.send(pdfBuffer);

  } catch(err) { return res.status(500).json({ message:'Server error generating report' }); }
});

// (Other existing Inventory, Auth, Log, Document routes go here - unchanged for brevity)

// ===== Serve frontend and Startup =====
app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: 'admin', password: 'password' });
      await logActivity('System', 'Default admin user created.');
      console.log('Default admin user created.');
    }
    const configCount = await CompanyConfig.countDocuments({}).exec();
    if (configCount === 0) {
        await CompanyConfig.create({});
        await logActivity('System', 'Default company config created.');
    }
    
    await logActivity('System', `Server is live and listening on port ${PORT}`);
  } catch (err) {
    console.error('Startup helper error:', err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log(`Starting server on port ${PORT}`);
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
})();

module.exports = { Inventory, Order, Sale, CompanyConfig, User, Doc, ActivityLog, logActivity };
