// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path'); // REQUIRED for static file serving
const PDFDocument = require('pdfkit');   // PDF generator

const app = express();
const PORT = process.env.PORT || 3000;
// NOTE: Ensure these environment variables are set in your Render dashboard
const MONGODB_URI = process.env.MONGODB_URI; 
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CRITICAL FIX 1: Specialized middleware for handling raw file uploads
// This is essential for receiving the binary data of any file type.
const rawBodyMiddleware = express.raw({
  type: '*/*', // Accept all content types
  limit: '50mb' // Set a reasonable limit for file size
});

// ===== MongoDB Connection =====
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Using fallback connection.");
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB Atlas"))
.catch(err => {
  console.error("MongoDB connect error:", err);
});

const { Schema } = mongoose;

// ===== Schemas (DocSchema updated for binary data) =====
const UserSchema = new Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  // CRITICAL FIX 2: Fields to store file content for ALL file types
  data: Buffer,       // Stores the file content as a Buffer
  contentType: String // Stores the file's MIME type
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ===== Logging Helper =====

async function logActivity(user, action) {
  const DUPLICATE_WINDOW_MS = 30 * 1000;
  try {
    const safeUser = (user || "Unknown").toString();
    const safeAction = (action || "").toString();
    const now = Date.now();
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last && last.user === safeUser && last.action === safeAction && now - new Date(last.time).getTime() <= DUPLICATE_WINDOW_MS) return;
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// ===== API Routes =====

// Auth Routes (Login, Register, Account Settings)
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Username and password required" });
  try {
    const user = await User.findOne({ username, password }).lean();
    if (user) {
      await logActivity(username, "Logged in");
      res.json({ message: "Login successful" });
    } else {
      res.status(401).json({ message: "Invalid credentials" });
    }
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body;
  if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: "Invalid security code" });
  if (!username || !password) return res.status(400).json({ message: "Username and password required" });
  try {
    await User.create({ username, password });
    await logActivity("System", `New user registered: ${username}`);
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Username already exists" });
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/account/password", async (req, res) => {
    const { username, newPassword, securityCode } = req.body;
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: "Invalid security code" });
    if (!username || !newPassword) return res.status(400).json({ message: "Username and new password required" });
    try {
        const user = await User.findOneAndUpdate({ username }, { password: newPassword }, { new: true });
        if (!user) return res.status(404).json({ message: "User not found" });
        await logActivity(username, "Changed password");
        res.json({ message: "Password updated successfully" });
    } catch (err) {
        res.status(500).json({ message: "Server error during password change" });
    }
});

app.delete("/api/account", async (req, res) => {
    const { username, securityCode } = req.body;
    if (securityCode !== SECURITY_CODE) return res.status(403).json({ message: "Invalid security code" });
    if (!username) return res.status(400).json({ message: "Username required" });
    try {
        const user = await User.findOneAndDelete({ username });
        if (!user) return res.status(404).json({ message: "User not found" });
        await logActivity("System", `Account deleted: ${username}`);
        res.json({ message: "Account deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Server error during account deletion" });
    }
});

// Inventory Routes 
app.get("/api/inventory", async (req, res) => {
    try {
        const inventoryItems = await Inventory.find({}).sort({ name: 1 }).lean();
        res.json(inventoryItems);
    } catch (err) {
        res.status(500).json({ message: "Server error fetching inventory" });
    }
});

app.post("/api/inventory", async (req, res) => {
    const { sku, name, category, quantity, unitCost, unitPrice } = req.body;
    try {
        const newItem = await Inventory.create({ sku, name, category, quantity, unitCost, unitPrice });
        await logActivity(req.headers["x-username"], `Added inventory item: ${name} (${sku})`);
        res.status(201).json(newItem);
    } catch (err) {
        res.status(500).json({ message: "Server error adding inventory" });
    }
});

app.put("/api/inventory/:id", async (req, res) => {
    const { id } = req.params;
    const update = req.body;
    try {
        const updatedItem = await Inventory.findByIdAndUpdate(id, update, { new: true });
        if (!updatedItem) return res.status(404).json({ message: "Item not found" });
        await logActivity(req.headers["x-username"], `Updated inventory item: ${updatedItem.name}`);
        res.json(updatedItem);
    } catch (err) {
        res.status(500).json({ message: "Server error updating inventory" });
    }
});

app.delete("/api/inventory/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const deletedItem = await Inventory.findByIdAndDelete(id);
        if (!deletedItem) return res.status(404).json({ message: "Item not found" });
        await logActivity(req.headers["x-username"], `Deleted inventory item: ${deletedItem.name}`);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Server error deleting inventory" });
    }
});

// ============================================================================
//                       DOCUMENTS UPLOAD (FIXED FOR ALL FILES)
// ============================================================================
// Apply the raw body parser middleware only to this route
app.post("/api/documents", rawBodyMiddleware, async (req, res) => {
  const fileBuffer = req.body;
  
  const contentType = req.headers['content-type']; 
  const fileName = req.headers['x-file-name'];     
  const username = req.headers["x-username"];

  if (!fileBuffer || !fileBuffer.length || !contentType || !fileName) {
    return res.status(400).json({ 
      message: "No file content or required metadata (filename/type) provided for upload." 
    });
  }

  try {
    const docu = await Doc.create({
      name: fileName,
      size: fileBuffer.length,
      date: new Date(),
      data: fileBuffer,       // Save the raw buffer
      contentType: contentType // Save the MIME type
    });
    
    await logActivity(username, `Uploaded document: ${docu.name} (${contentType})`);
    
    // Respond with a success message
    res.status(201).json({ 
        message: "File uploaded successfully",
        documentId: docu._id.toString()
    }); 
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ message: "Server error during file storage." });
  }
});

// ============================================================================
//                             DOCUMENTS DOWNLOAD (FIXED FOR ALL FILES)
// ============================================================================
app.get("/api/documents/download/:id", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id).lean(); 
    
    if (!docu) return res.status(404).json({ message: "Document not found" });

    if (!docu.data || !docu.contentType) {
      return res.status(400).json({ 
        message: "File content not stored on server." 
      });
    }

    // Use the stored content type and size for correct download
    res.setHeader("Content-Disposition", `attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType);
    res.setHeader("Content-Length", docu.size);
    
    // Send the binary data
    res.send(docu.data);

    await logActivity(req.headers["x-username"], `Downloaded document: ${docu.name}`);

  } catch (err) {
    console.error("Document download error:", err); 
    res.status(500).json({ message: "Server error during download" });
  }
});

// Document List
app.get("/api/documents", async (req, res) => {
    try {
        // Select only metadata fields to avoid sending large 'data' buffers
        const documentsList = await Doc.find({}).select('name size date contentType').sort({ date: -1 }).lean();
        res.json(documentsList.map(d => ({ ...d, id: d._id, sizeBytes: d.size }))); // use sizeBytes to map to frontend
    } catch (err) {
        res.status(500).json({ message: "Server error fetching documents" });
    }
});

// Document Delete
app.delete("/api/documents/:id", async (req, res) => {
    try {
        const docu = await Doc.findByIdAndDelete(req.params.id);
        if (!docu) return res.status(404).json({ message: "Document not found" });
        await logActivity(req.headers["x-username"], `Deleted document: ${docu.name}`);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: "Server error deleting document" });
    }
});

// Activity Logs
app.get("/api/logs", async (req, res) => {
    try {
        const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(100).lean();
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: "Server error fetching logs" });
    }
});

// ============================================================================
//                             INVENTORY REPORT GENERATION
// ============================================================================

// Excel Report
app.get("/api/inventory/report", async (req, res) => {
    try {
        const items = await Inventory.find({}).lean();
        const data = items.map(item => ({
            SKU: item.sku,
            Name: item.name,
            Category: item.category,
            Quantity: item.quantity,
            'Unit Cost (RM)': item.unitCost.toFixed(2),
            'Unit Price (RM)': item.unitPrice.toFixed(2),
            'Inventory Value (RM)': (item.quantity * item.unitCost).toFixed(2),
            'Potential Revenue (RM)': (item.quantity * item.unitPrice).toFixed(2),
        }));

        const worksheet = xlsx.utils.json_to_sheet(data);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Inventory Report");
        const excelBuffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

        const filename = `Inventory_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
        const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        // Save to Documents collection
        await Doc.create({
            name: filename,
            size: excelBuffer.length,
            data: excelBuffer,
            contentType: contentType
        });

        await logActivity(req.headers["x-username"], `Generated Excel report: ${filename}`);

        // Send the file as a response for immediate download
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", contentType);
        res.send(excelBuffer);

    } catch (err) {
        console.error("Report generation error:", err);
        res.status(500).json({ message: "Failed to generate Excel report." });
    }
});

// PDF Report
app.get("/api/inventory/report/pdf", async (req, res) => {
    try {
        const items = await Inventory.find({}).lean();

        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            const pdfBuffer = Buffer.concat(buffers);
            const filename = `Inventory_Report_PDF_${new Date().toISOString().slice(0, 10)}.pdf`;
            const contentType = 'application/pdf';

            // Save to Documents collection
            await Doc.create({
                name: filename,
                size: pdfBuffer.length,
                data: pdfBuffer,
                contentType: contentType
            });

            await logActivity(req.headers["x-username"], `Generated PDF report: ${filename}`);

            // Send the file as a response
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', contentType);
            res.send(pdfBuffer);
        });

        // PDF Content generation
        doc.fontSize(16).text('Inventory Report', { align: 'center' }).moveDown();
        doc.fontSize(10);
        
        let y = doc.y;
        const xStart = 30;
        const colWidths = [50, 150, 100, 50, 70, 70]; 
        const headers = ["SKU", "Name", "Category", "Qty", "Cost", "Price"];

        // Draw Headers
        let currentX = xStart;
        headers.forEach((header, i) => {
            doc.text(header, currentX, y, { width: colWidths[i], align: 'left' });
            currentX += colWidths[i];
        });
        doc.y += 15;
        doc.strokeColor("#aaaaaa").lineWidth(0.5).moveTo(xStart, doc.y).lineTo(doc.page.width - 30, doc.y).stroke().moveDown(0.2);

        // Draw Data
        items.forEach(item => {
            if (doc.y > doc.page.height - 50) {
                doc.addPage();
                y = 30; // Reset y for new page
            }
            currentX = xStart;
            const dataRow = [
                item.sku, 
                item.name, 
                item.category, 
                item.quantity.toString(), 
                item.unitCost.toFixed(2), 
                item.unitPrice.toFixed(2)
            ];

            dataRow.forEach((data, i) => {
                doc.text(data, currentX, doc.y, { width: colWidths[i], align: 'left' });
                currentX += colWidths[i];
            });
            doc.moveDown();
        });

        doc.end();
    } catch (err) {
        console.error("PDF generation error:", err);
        res.status(500).json({ message: "Failed to generate PDF report." });
    }
});


// ============================================================================
// CRITICAL FIX 5: Static File Serving (Resolves "Cannot GET /" issue)
// This must be placed after all /api routes but before server startup.
// ============================================================================

// 1. Serve static files (HTML, CSS, JS) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 2. Handle the root route ('/') and any other unhandled routes by serving the main index.html file.
app.get('*', (req, res) => {
  // Use 'index.html' as the entry point for the frontend
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ============================================================================
//                        STARTUP HELPER + START SERVER
// ============================================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments({}).exec();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin user created");
    }
    await logActivity("System", `Server started on port ${PORT}`);
  } catch (err) {
    console.error("Startup error:", err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  console.log("Starting server...");
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();
