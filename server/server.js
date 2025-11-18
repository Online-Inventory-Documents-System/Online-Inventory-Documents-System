// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Specialized middleware for handling raw file uploads
const rawBodyMiddleware = express.raw({
  type: '*/*',
  limit: '50mb'
});

// ===== MongoDB Connection =====
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB Atlas"))
.catch(err => {
  console.error("MongoDB connect error:", err);
  process.exit(1);
});

const { Schema } = mongoose;

// ===== Schemas =====
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
  data: Buffer,
  contentType: String
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ===== Duplicate Log Protection =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action) {
  try {
    const safeUser = (user || "Unknown").toString();
    const safeAction = (action || "").toString();
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean().exec();
    if (last) {
      const lastUser = last.user || "Unknown";
      const lastAction = last.action || "";
      const lastTime = last.time ? new Date(last.time).getTime() : 0;

      if (
        lastUser === safeUser &&
        lastAction === safeAction &&
        now - lastTime <= DUPLICATE_WINDOW_MS
      ) {
        return;
      }
    }

    await ActivityLog.create({
      user: safeUser,
      action: safeAction,
      time: new Date()
    });

  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// ===== Health Check =====
app.get("/api/test", (req, res) => {
  res.json({ success: true, message: "API is up", time: new Date().toISOString() });
});

// ============================================================================
//                               AUTH SYSTEM
// ============================================================================
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body || {};

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success: false, message: "Invalid security code" });

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing username or password" });

  try {
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return res.status(409).json({ success: false, message: "Username already exists" });

    await User.create({ username, password });
    await logActivity("System", `Registered user: ${username}`);

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("register error", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing credentials" });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    await logActivity(username, "Logged in");
    res.json({ success: true, user: username });
  } catch (err) {
    console.error("login error", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============================================================================
//                                 INVENTORY CRUD
// ============================================================================
app.get("/api/inventory", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({
      ...i,
      id: i._id.toString()
    }));
    res.json(normalized);
  } catch (err) {
    console.error("inventory get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/inventory", async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers["x-username"], `Added: ${item.name}`);

    res.status(201).json({
      ...item.toObject(),
      id: item._id.toString()
    });

  } catch (err) {
    console.error("inventory post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item)
      return res.status(404).json({ message: "Item not found" });

    await logActivity(req.headers["x-username"], `Updated: ${item.name}`);
    res.json({
      ...item.toObject(),
      id: item._id.toString()
    });

  } catch (err) {
    console.error("inventory update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item)
      return res.status(404).json({ message: "Item not found" });

    await logActivity(req.headers["x-username"], `Deleted: ${item.name}`);
    res.status(204).send();

  } catch (err) {
    console.error("inventory delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    PDF REPORT - SIMPLIFIED APPROACH
// ============================================================================
function generatePDFBuffer(items, printedBy) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 40
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      doc.on('error', reject);

      // PDF Content
      doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, 40);
      doc.fontSize(10).font("Helvetica");
      doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
      doc.text("Phone: 01133127622", 40, 85);
      doc.text("Email: lbcompany@gmail.com", 40, 100);

      doc.font("Helvetica-Bold").fontSize(15)
         .text("INVENTORY REPORT", 620, 40);

      doc.font("Helvetica").fontSize(10);
      doc.text(`Print Date: ${new Date().toLocaleDateString()}`, 620, 63);
      doc.text(`Printed by: ${printedBy}`, 620, 78);

      doc.moveTo(40, 130).lineTo(800, 130).stroke();

      // Table
      const rowHeight = 18;
      const colX = { sku: 40, name: 100, category: 260, qty: 340, cost: 400, price: 480, value: 560, revenue: 670 };
      const width = { sku: 60, name: 160, category: 80, qty: 60, cost: 80, price: 80, value: 110, revenue: 120 };
      let y = 150;

      // Header
      doc.font("Helvetica-Bold").fontSize(10);
      Object.keys(colX).forEach(key => doc.rect(colX[key], y, width[key], rowHeight).stroke());
      doc.text("SKU", colX.sku + 3, y + 4);
      doc.text("Product Name", colX.name + 3, y + 4);
      doc.text("Category", colX.category + 3, y + 4);
      doc.text("Quantity", colX.qty + 3, y + 4);
      doc.text("Unit Cost", colX.cost + 3, y + 4);
      doc.text("Unit Price", colX.price + 3, y + 4);
      doc.text("Total Value", colX.value + 3, y + 4);
      doc.text("Total Revenue", colX.revenue + 3, y + 4);
      
      y += rowHeight;
      doc.font("Helvetica").fontSize(9);

      // Data
      let totalValue = 0;
      let totalRevenue = 0;

      items.forEach(item => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.unitCost || 0);
        const price = Number(item.unitPrice || 0);
        const value = qty * cost;
        const revenue = qty * price;
        
        totalValue += value;
        totalRevenue += revenue;

        Object.keys(colX).forEach(key => doc.rect(colX[key], y, width[key], rowHeight).stroke());
        doc.text(item.sku || "", colX.sku + 3, y + 4);
        doc.text(item.name || "", colX.name + 3, y + 4);
        doc.text(item.category || "", colX.category + 3, y + 4);
        doc.text(String(qty), colX.qty + 3, y + 4);
        doc.text(`RM ${cost.toFixed(2)}`, colX.cost + 3, y + 4);
        doc.text(`RM ${price.toFixed(2)}`, colX.price + 3, y + 4);
        doc.text(`RM ${value.toFixed(2)}`, colX.value + 3, y + 4);
        doc.text(`RM ${revenue.toFixed(2)}`, colX.revenue + 3, y + 4);
        
        y += rowHeight;
      });

      // Summary
      const summaryY = y + 20;
      doc.rect(560, summaryY, 230, 50).stroke();
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, summaryY + 10);
      doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, summaryY + 28);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Inventory_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`Generating PDF for user: ${printedBy}`);

    // Generate PDF buffer
    const pdfBuffer = await generatePDFBuffer(items, printedBy);
    
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error("Generated PDF buffer is empty");
    }

    console.log(`PDF generated, size: ${pdfBuffer.length} bytes`);

    // Save to database
    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf"
    });

    console.log(`PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`);

    // Send the file for download
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("PDF Generation Error:", err);
    res.status(500).json({ message: "PDF generation failed: " + err.message });
  }
});

// ============================================================================
//                                   XLSX REPORT
// ============================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Inventory_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.xlsx`;

    console.log(`Generating XLSX for user: ${printedBy}`);

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toISOString().slice(0, 10)],
      ["Generated by:", printedBy],
      [],
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", "Total Inventory Value", "Total Potential Revenue"]
    ];

    let totalValue = 0;
    let totalRevenue = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;

      totalValue += invVal;
      totalRevenue += rev;

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        uc.toFixed(2),
        up.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2)
      ]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", totalValue.toFixed(2), totalRevenue.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    if (!wb_out || wb_out.length === 0) {
      throw new Error("Generated XLSX buffer is empty");
    }

    console.log(`XLSX generated, size: ${wb_out.length} bytes`);

    // Save to database
    const savedDoc = await Doc.create({ 
      name: filename, 
      size: wb_out.length, 
      date: new Date(),
      data: wb_out,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    console.log(`XLSX saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Inventory Report XLSX: ${filename}`);

    // Send response
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", wb_out.length);
    res.send(wb_out);

  } catch (err) {
    console.error("XLSX generation error:", err);
    res.status(500).json({ message: "Report generation failed: " + err.message });
  }
});

// ============================================================================
//                       DOCUMENTS UPLOAD
// ============================================================================
app.post("/api/documents", rawBodyMiddleware, async (req, res) => {
  const fileBuffer = req.body;
  
  const contentType = req.headers['content-type']; 
  const fileName = req.headers['x-file-name'];     
  const username = req.headers["x-username"];

  if (!fileBuffer || !fileBuffer.length || !contentType || !fileName) {
    return res.status(400).json({ 
      message: "No file content or required metadata provided for upload." 
    });
  }

  try {
    const docu = await Doc.create({
      name: fileName,
      size: fileBuffer.length,
      date: new Date(),
      data: fileBuffer,
      contentType: contentType
    });
    
    console.log(`File uploaded: ${fileName}, size: ${fileBuffer.length} bytes`);
    await logActivity(username, `Uploaded document: ${fileName}`);
    
    res.status(201).json([{ ...docu.toObject(), id: docu._id.toString() }]);
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ message: "Server error during file storage." });
  }
});

// ============================================================================
//                                DOCUMENTS CRUD
// ============================================================================
app.get("/api/documents", async (req, res) => {
  try {
    const docs = await Doc.find({}).select('-data').sort({ date: -1 }).lean();
    const result = docs.map(d => ({ 
      ...d, 
      id: d._id.toString()
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/documents/:id", async (req, res) => {
  try {
    const docu = await Doc.findByIdAndDelete(req.params.id);
    if (!docu) return res.status(404).json({ message: "Document not found" });

    await logActivity(req.headers["x-username"], `Deleted document: ${docu.name}`);
    res.status(204).send();

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                             DOCUMENTS DOWNLOAD
// ============================================================================
app.get("/api/documents/download/:id", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id);
    
    if (!docu) {
      return res.status(404).json({ message: "Document not found" });
    }

    console.log(`Download request: ${docu.name}, size: ${docu.size} bytes`);

    if (!docu.data || !Buffer.isBuffer(docu.data) || docu.data.length === 0) {
      return res.status(400).json({ 
        message: "File content not available. Please regenerate the report." 
      });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType || "application/octet-stream");
    res.setHeader("Content-Length", docu.data.length);
    res.send(docu.data);

    await logActivity(req.headers["x-username"] || "System", `Downloaded document: ${docu.name}`);

  } catch (err) {
    console.error("Document download error:", err); 
    res.status(500).json({ message: "Server error during download: " + err.message });
  }
});

// ============================================================================
//                    CLEANUP BROKEN DOCUMENTS
// ============================================================================
app.delete("/api/cleanup-documents", async (req, res) => {
  try {
    const result = await Doc.deleteMany({
      $or: [
        { data: { $exists: false } },
        { data: null },
        { size: 0 },
        { size: { $exists: false } }
      ]
    });
    
    console.log(`Cleaned up ${result.deletedCount} broken documents`);
    res.json({ 
      success: true, 
      message: `Cleaned up ${result.deletedCount} broken documents`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ success: false, message: "Cleanup failed" });
  }
});

// ============================================================================
//                               ACTIVITY LOGS
// ============================================================================
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(logs.map(l => ({
      user: l.user,
      action: l.action,
      time: l.time ? new Date(l.time).toISOString() : new Date().toISOString()
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                              SERVE FRONTEND
// ============================================================================
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ message: "API route not found" });

  res.sendFile(path.join(__dirname, "../public/index.html"));
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
