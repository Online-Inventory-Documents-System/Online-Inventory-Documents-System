// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit'); // FIX 1: Add pdfkit for PDF generation

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || '1234';

// ===== Middleware =====
app.use(cors());
app.use(express.json()); // body-parser is now built-in to express
app.use(express.urlencoded({ extended: true }));

// ===== Mongoose / Models =====
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Set MONGODB_URI environment variable.');
  process.exit(1);
}

// NOTE: useNewUrlParser and useUnifiedTopology are no longer needed in Mongoose 6+
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI)
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
    // normalize id for client (id instead of _id)
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers['x-username'], `Added product: ${item.name} (${item.sku})`);
    return res.status(201).json({ success:true, id: item._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Inventory.findByIdAndUpdate(id, req.body, { new: true });
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Updated product: ${item.name} (${item.sku})`);
    return res.json({ success:true, id: item._id.toString() });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = await Inventory.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message:'Item not found' });
    await logActivity(req.headers['x-username'], `Deleted product: ${item.name} (${item.sku})`);
    return res.json({ success:true, message:'Item deleted' });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== API: Generate Excel Report (Existing) =====
app.get('/api/inventory/report-excel', async (req, res) => {
  try {
    const products = await Inventory.find({}).lean().exec();
    const data = products.map(p => ({
      SKU: p.sku,
      Name: p.name,
      Category: p.category,
      Quantity: p.quantity,
      'Unit Cost (RM)': p.unitCost,
      'Unit Price (RM)': p.unitPrice,
      'Inventory Value (RM)': p.quantity * p.unitCost,
      'Potential Revenue (RM)': p.quantity * (p.unitPrice - p.unitCost)
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Inventory');
    
    // Set response headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Inventory_Report.xlsx"');

    // Write workbook to buffer and send
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
    
    await logActivity(req.headers['x-username'], `Generated Excel Inventory Report.`);

  } catch (err) {
    console.error('Excel Report Generation Error:', err);
    res.status(500).send('Error generating Excel report.');
  }
});


// ===== API: Generate PDF Report (NEW) =====
app.get('/api/inventory/report-pdf', async (req, res) => {
  try {
    const products = await Inventory.find({}).lean().exec();

    // 1. Setup response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Inventory_Report.pdf"');

    // 2. Create a new PDF document
    const doc = new PDFDocument({ margin: 50 });

    // 3. Pipe the PDF document to the response stream
    doc.pipe(res);

    // 4. Document Content
    doc
      .fontSize(25)
      .text('Inventory Stock Report', { align: 'center' })
      .moveDown(1.5);

    // Table Header setup (simplified)
    const tableTop = doc.y;
    const itemHeight = 25;
    const col1 = 50; // SKU
    const col2 = 150; // Name
    const col3 = 300; // Quantity
    const col4 = 400; // Price
    const col5 = 500; // Value

    doc.fontSize(10)
       .text('SKU', col1, tableTop)
       .text('Name', col2, tableTop)
       .text('Qty', col3, tableTop, { width: 100, align: 'right' })
       .text('Cost', col4, tableTop, { width: 100, align: 'right' })
       .text('Value', col5, tableTop, { width: 100, align: 'right' })
       .moveTo(col1, tableTop + 15)
       .lineTo(doc.page.width - 50, tableTop + 15)
       .stroke();

    let currentY = tableTop + itemHeight;
    let totalValue = 0;

    // 5. Add product data
    for (const product of products) {
      const value = product.quantity * product.unitCost;
      totalValue += value;
      
      // Check if we need a new page
      if (currentY + itemHeight > doc.page.height - 50) {
        doc.addPage();
        currentY = 50; // Reset Y position
      }

      doc.fontSize(8)
        .text(product.sku, col1, currentY)
        .text(product.name, col2, currentY)
        .text(product.quantity.toString(), col3, currentY, { width: 100, align: 'right' })
        .text(`RM ${product.unitCost.toFixed(2)}`, col4, currentY, { width: 100, align: 'right' })
        .text(`RM ${value.toFixed(2)}`, col5, currentY, { width: 100, align: 'right' });
      
      currentY += itemHeight;
    }

    // Total Footer
    doc.moveTo(col4, currentY + 5)
       .lineTo(doc.page.width - 50, currentY + 5)
       .stroke();
    
    doc.fontSize(10)
       .text('TOTAL INVENTORY VALUE:', col4 - 150, currentY + 15, { width: 150, align: 'right' })
       .text(`RM ${totalValue.toFixed(2)}`, col5, currentY + 15, { width: 100, align: 'right' });


    // 6. Finalize the PDF and end the stream
    doc.end();
    
    // Log the activity
    await logActivity(req.headers['x-username'], `Generated PDF Inventory Report.`);

  } catch (err) {
    console.error('PDF Report Generation Error:', err);
    res.status(500).send('Error generating PDF report.');
  }
});

// ===== Documents CRUD =====
app.get('/api/documents', async (req, res) => {
  try {
    const docs = await Doc.find({}).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// Simulated Upload (only saves metadata)
app.post('/api/documents', async (req, res) => {
  try {
    const { files } = req.body;
    if (!files || files.length === 0) return res.status(400).json({ message: 'No documents provided' });

    const newDocs = files.map(f => ({
      name: f.name,
      size: f.size,
      date: new Date()
    }));

    const result = await Doc.insertMany(newDocs);
    
    const names = result.map(d => d.name).join(', ');
    await logActivity(req.headers['x-username'], `Uploaded ${result.length} documents: ${names}`);

    return res.status(201).json({ success: true, count: result.length, message: 'Documents metadata saved (upload simulated)' });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await Doc.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    await logActivity(req.headers['x-username'], `Deleted document: ${doc.name}`);
    return res.json({ success: true, message: 'Document deleted' });
  } catch(err) { console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Activity Log =====
app.get('/api/log', async (req, res) => {
  try {
    // Fetch last 100 logs
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(100).lean();
    // Use ISO string for consistent date handling in client, client converts to local timezone
    const formatted = logs.map(l => ({ user: l.user, action: l.action, time: l.time ? new Date(l.time).toISOString() : new Date().toISOString() }));
    return res.json(formatted);
  } catch(err){ console.error(err); return res.status(500).json({ message:'Server error' }); }
});

// ===== Serve frontend =====
app.use(express.static(path.join(__dirname, '../public')));

// FIX 3: Change * to /* to resolve the PathError on Express 5.x/newer routers
app.get('/*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message:'API route not found' });
  // Always serve index.html for non-API routes (SPA setup)
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
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();
