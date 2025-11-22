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
//                           PASSWORD CHANGE & ACCOUNT MANAGEMENT
// ============================================================================
app.put("/api/account/password", async (req, res) => {
  const { username, newPassword, securityCode } = req.body || {};
  const currentUser = req.headers["x-username"];

  console.log(`Password change request for: ${username}, from: ${currentUser}`);

  if (securityCode !== SECURITY_CODE) {
    return res.status(403).json({ success: false, message: "Invalid security code" });
  }

  if (!username || !newPassword) {
    return res.status(400).json({ success: false, message: "Missing username or new password" });
  }

  // Verify the user is changing their own password
  if (username !== currentUser) {
    return res.status(403).json({ success: false, message: "You can only change your own password" });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    await logActivity(username, "Changed password");
    
    console.log(`✅ Password updated for user: ${username}`);
    res.json({ success: true, message: "Password updated successfully" });

  } catch (err) {
    console.error("Password change error", err);
    res.status(500).json({ success: false, message: "Server error during password change" });
  }
});

app.delete("/api/account", async (req, res) => {
  const { username, securityCode } = req.body || {};
  const currentUser = req.headers["x-username"];

  console.log(`Account deletion request for: ${username}, from: ${currentUser}`);

  if (securityCode !== SECURITY_CODE) {
    return res.status(403).json({ success: false, message: "Invalid security code" });
  }

  if (!username) {
    return res.status(400).json({ success: false, message: "Missing username" });
  }

  // Verify the user is deleting their own account
  if (username !== currentUser) {
    return res.status(403).json({ success: false, message: "You can only delete your own account" });
  }

  try {
    const user = await User.findOneAndDelete({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await logActivity("System", `Deleted user account: ${username}`);
    
    console.log(`🗑️ Account deleted: ${username}`);
    res.json({ success: true, message: "Account deleted successfully" });

  } catch (err) {
    console.error("Account deletion error", err);
    res.status(500).json({ success: false, message: "Server error during account deletion" });
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
//                    PDF REPORT — FIXED TABLE ALIGNMENT
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();

    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const reportId = `REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`📊 Generating PDF report: ${filename}`);

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        let pdfChunks = [];

        const doc = new PDFDocument({
          size: "A4",
          layout: "landscape",
          margin: 40,
          bufferPages: true
        });

        doc.on("data", chunk => {
          pdfChunks.push(chunk);
        });
        
        doc.on("end", () => {
          const buffer = Buffer.concat(pdfChunks);
          console.log(`✅ PDF generation completed: ${buffer.length} bytes`);
          resolve(buffer);
        });
        
        doc.on("error", (error) => {
          console.error('❌ PDF generation error:', error);
          reject(error);
        });

        // ==================== PDF CONTENT GENERATION ====================
        doc.fontSize(22).font("Helvetica-Bold").text("L&B Company", 40, 40);
        doc.fontSize(10).font("Helvetica");
        doc.text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
        doc.text("Phone: 01133127622", 40, 85);
        doc.text("Email: lbcompany@gmail.com", 40, 100);

        doc.font("Helvetica-Bold").fontSize(15)
           .text("INVENTORY REPORT", 620, 40);

        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 620, 63);
        doc.text(`Report ID: ${reportId}`, 620, 78);
        doc.text(`Status: Generated`, 620, 93);
        doc.text(`Printed by: ${printedBy}`, 620, 108);

        doc.moveTo(40, 130).lineTo(800, 130).stroke();

        const rowHeight = 18;
        
        // PERFECTLY ALIGNED COLUMNS - Each column starts where previous ends
        const colX = { 
          sku: 40,        // Start at 40
          name: 105,      // 40 + 65 (sku width)
          category: 210,   // 105 + 105 (name width) 
          qty: 295,       // 210 + 85 (category width)
          cost: 360,      // 295 + 65 (qty width)
          price: 425,     // 360 + 65 (cost width)
          value: 490,     // 425 + 65 (price width)
          revenue: 575,   // 490 + 85 (value width)
          profit: 670     // 575 + 95 (revenue width)
        };
        
        const width = { 
          sku: 65,        // Total: 65
          name: 105,      // Total: 170  
          category: 85,    // Total: 255
          qty: 65,        // Total: 320
          cost: 65,       // Total: 385
          price: 65,      // Total: 450
          value: 85,      // Total: 535
          revenue: 95,    // Total: 630
          profit: 100     // Total: 730 (leaves room for margin)
        };
        
        let y = 150;

        function drawHeader() {
          doc.font("Helvetica-Bold").fontSize(9);
          
          // Draw continuous table header
          let currentX = colX.sku;
          doc.rect(currentX, y, width.sku, rowHeight).stroke();
          currentX += width.sku;
          doc.rect(currentX, y, width.name, rowHeight).stroke();
          currentX += width.name;
          doc.rect(currentX, y, width.category, rowHeight).stroke();
          currentX += width.category;
          doc.rect(currentX, y, width.qty, rowHeight).stroke();
          currentX += width.qty;
          doc.rect(currentX, y, width.cost, rowHeight).stroke();
          currentX += width.cost;
          doc.rect(currentX, y, width.price, rowHeight).stroke();
          currentX += width.price;
          doc.rect(currentX, y, width.value, rowHeight).stroke();
          currentX += width.value;
          doc.rect(currentX, y, width.revenue, rowHeight).stroke();
          currentX += width.revenue;
          doc.rect(currentX, y, width.profit, rowHeight).stroke();
          
          // Header text
          doc.text("SKU", colX.sku + 3, y + 5);
          doc.text("Product Name", colX.name + 3, y + 5);
          doc.text("Category", colX.category + 3, y + 5);
          doc.text("Quantity", colX.qty + 3, y + 5);
          doc.text("Unit Cost", colX.cost + 3, y + 5);
          doc.text("Unit Price", colX.price + 3, y + 5);
          doc.text("Inventory Value", colX.value + 3, y + 5);
          doc.text("Potential Revenue", colX.revenue + 3, y + 5);
          doc.text("Potential Profit", colX.profit + 3, y + 5);
          
          y += rowHeight;
          doc.font("Helvetica").fontSize(8);
        }

        drawHeader();
        let subtotalQty = 0;
        let totalValue = 0;
        let totalRevenue = 0;
        let totalProfit = 0;
        let rowsOnPage = 0;

        for (const it of items) {
          if (rowsOnPage === 10) {
            doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
            y = 40;
            rowsOnPage = 0;
            drawHeader();
          }

          const qty = Number(it.quantity || 0);
          const cost = Number(it.unitCost || 0);
          const price = Number(it.unitPrice || 0);
          const val = qty * cost;
          const rev = qty * price;
          const profit = rev - val;
          
          subtotalQty += qty;
          totalValue += val;
          totalRevenue += rev;
          totalProfit += profit;

          // Draw continuous table data row
          let currentX = colX.sku;
          doc.rect(currentX, y, width.sku, rowHeight).stroke();
          currentX += width.sku;
          doc.rect(currentX, y, width.name, rowHeight).stroke();
          currentX += width.name;
          doc.rect(currentX, y, width.category, rowHeight).stroke();
          currentX += width.category;
          doc.rect(currentX, y, width.qty, rowHeight).stroke();
          currentX += width.qty;
          doc.rect(currentX, y, width.cost, rowHeight).stroke();
          currentX += width.cost;
          doc.rect(currentX, y, width.price, rowHeight).stroke();
          currentX += width.price;
          doc.rect(currentX, y, width.value, rowHeight).stroke();
          currentX += width.value;
          doc.rect(currentX, y, width.revenue, rowHeight).stroke();
          currentX += width.revenue;
          doc.rect(currentX, y, width.profit, rowHeight).stroke();
          
          // Data text
          doc.text(it.sku || "", colX.sku + 3, y + 5);
          doc.text(it.name || "", colX.name + 3, y + 5);
          doc.text(it.category || "", colX.category + 3, y + 5);
          doc.text(String(qty), colX.qty + 3, y + 5);
          doc.text(`RM ${cost.toFixed(2)}`, colX.cost + 3, y + 5);
          doc.text(`RM ${price.toFixed(2)}`, colX.price + 3, y + 5);
          doc.text(`RM ${val.toFixed(2)}`, colX.value + 3, y + 5);
          doc.text(`RM ${rev.toFixed(2)}`, colX.revenue + 3, y + 5);
          doc.text(`RM ${profit.toFixed(2)}`, colX.profit + 3, y + 5);
          
          y += rowHeight;
          rowsOnPage++;
        }

        const lastPageIndex = doc.bufferedPageRange().count - 1;
        doc.switchToPage(lastPageIndex);
        let boxY = y + 20;
        if (boxY > 480) boxY = 480;
        doc.rect(560, boxY, 230, 88).stroke();
        doc.font("Helvetica-Bold").fontSize(10);
        doc.text(`Subtotal (Quantity): ${subtotalQty} units`, 570, boxY + 10);
        doc.text(`Total Inventory Value: RM ${totalValue.toFixed(2)}`, 570, boxY + 28);
        doc.text(`Total Potential Revenue: RM ${totalRevenue.toFixed(2)}`, 570, boxY + 46);
        doc.text(`Total Potential Profit: RM ${totalProfit.toFixed(2)}`, 570, boxY + 64);

        doc.flushPages();

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(9).text("Generated by L&B Company Inventory System", 0, doc.page.height - 40, { align: "center" });
          doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: "center" });
        }
        
        doc.end();

      } catch (error) {
        reject(error);
      }
    });

    console.log(`💾 Saving PDF to database: ${pdfBuffer.length} bytes`);

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf"
    });

    console.log(`✅ PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

    console.log(`📤 PDF sent to browser: ${filename}`);

  } catch (err) {
    console.error("❌ PDF Generation Error:", err);
    res.status(500).json({ message: "PDF generation failed: " + err.message });
  }
});

// ============================================================================
//                           XLSX REPORT - UPDATED WITH POTENTIAL PROFIT
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
      ["SKU", "Name", "Category", "Quantity", "Unit Cost", "Unit Price", 
       "Total Inventory Value", "Total Potential Revenue", "Potential Profit"]
    ];

    let totalValue = 0;
    let totalRevenue = 0;
    let totalProfit = 0;

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;
      const profit = rev - invVal;

      totalValue += invVal;
      totalRevenue += rev;
      totalProfit += profit;

      ws_data.push([
        it.sku || "",
        it.name || "",
        it.category || "",
        qty,
        uc.toFixed(2),
        up.toFixed(2),
        invVal.toFixed(2),
        rev.toFixed(2),
        profit.toFixed(2)
      ]);
    });

    ws_data.push([]);
    ws_data.push(["", "", "", "Totals", "", "", 
                 totalValue.toFixed(2), totalRevenue.toFixed(2), totalProfit.toFixed(2)]);

    const ws = xlsx.utils.aoa_to_sheet(ws_data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Inventory Report");
    
    const wb_out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    if (!wb_out || wb_out.length === 0) {
      throw new Error("Generated XLSX buffer is empty");
    }

    console.log(`XLSX generated, size: ${wb_out.length} bytes`);

    const savedDoc = await Doc.create({ 
      name: filename, 
      size: wb_out.length, 
      date: new Date(),
      data: wb_out,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    console.log(`XLSX saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Inventory Report XLSX: ${filename}`);

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
//                       DOCUMENTS UPLOAD - COMPLETELY REWRITTEN
// ============================================================================
app.post("/api/documents", async (req, res) => {
  console.log("📤 Document upload request received");
  
  try {
    // Get the raw body as buffer
    const chunks = [];
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', async () => {
      try {
        const fileBuffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type']; 
        const fileName = req.headers['x-file-name'];     
        const username = req.headers["x-username"];

        console.log(`📄 Upload details:`, {
          fileName,
          contentType,
          fileSize: fileBuffer.length,
          username
        });

        if (!fileBuffer || fileBuffer.length === 0) {
          console.error("❌ Empty file buffer received");
          return res.status(400).json({ 
            message: "No file content received. File is empty." 
          });
        }

        if (!fileName) {
          console.error("❌ No filename provided");
          return res.status(400).json({ 
            message: "Filename is required." 
          });
        }

        // Validate file size (max 50MB)
        if (fileBuffer.length > 50 * 1024 * 1024) {
          console.error("❌ File too large:", fileBuffer.length);
          return res.status(400).json({ 
            message: "File size exceeds 50MB limit." 
          });
        }

        console.log(`✅ File validated: ${fileName}, size: ${fileBuffer.length} bytes`);

        // Save to database
        const docu = await Doc.create({
          name: fileName,
          size: fileBuffer.length,
          date: new Date(),
          data: fileBuffer,
          contentType: contentType || "application/octet-stream"
        });
        
        console.log(`💾 File saved to database:`, {
          id: docu._id,
          name: docu.name,
          size: docu.size,
          contentType: docu.contentType
        });
        
        await logActivity(username, `Uploaded document: ${fileName}`);
        
        // Return success response
        res.status(201).json([{ 
          ...docu.toObject(), 
          id: docu._id.toString() 
        }]);

        console.log(`✅ Upload completed successfully: ${fileName}`);

      } catch (error) {
        console.error("❌ Upload processing error:", error);
        res.status(500).json({ 
          message: "File processing failed: " + error.message 
        });
      }
    });

    req.on('error', (error) => {
      console.error("❌ Request error during upload:", error);
      res.status(500).json({ 
        message: "Upload failed due to connection error." 
      });
    });

  } catch (error) {
    console.error("❌ Upload endpoint error:", error);
    res.status(500).json({ 
      message: "Upload failed: " + error.message 
    });
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

// Document check route - to verify if file has data
app.get("/api/documents/:id/check", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id);
    if (!docu) {
      return res.status(404).json({ hasData: false });
    }
    
    res.json({
      hasData: !!(docu.data && docu.data.length > 0),
      size: docu.size,
      name: docu.name
    });
  } catch (err) {
    console.error("Document check error:", err);
    res.status(500).json({ hasData: false });
  }
});

// ============================================================================
//                    DOCUMENT VERIFICATION ENDPOINT
// ============================================================================
app.get("/api/documents/:id/verify", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id);
    if (!docu) {
      return res.status(404).json({ valid: false, message: "Document not found" });
    }
    
    const isValid = docu.data && 
                   Buffer.isBuffer(docu.data) && 
                   docu.data.length > 0 && 
                   docu.data.length === docu.size;
    
    res.json({
      valid: isValid,
      name: docu.name,
      storedSize: docu.size,
      actualDataLength: docu.data ? docu.data.length : 0,
      hasData: !!docu.data,
      isBuffer: Buffer.isBuffer(docu.data),
      contentType: docu.contentType,
      date: docu.date
    });
  } catch (err) {
    console.error("Document verification error:", err);
    res.status(500).json({ valid: false, message: "Verification failed" });
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
//                             DOCUMENTS DOWNLOAD - FIXED VERSION
// ============================================================================
app.get("/api/documents/download/:id", async (req, res) => {
  try {
    console.log(`📥 Download request for document: ${req.params.id}`);
    
    const docu = await Doc.findById(req.params.id);
    
    if (!docu) {
      console.log('❌ Document not found');
      return res.status(404).json({ message: "Document not found" });
    }

    console.log(`📄 Found document: ${docu.name}, database size: ${docu.size} bytes`);

    // More comprehensive data validation
    if (!docu.data || 
        !Buffer.isBuffer(docu.data) || 
        docu.data.length === 0 ||
        docu.size === 0 ||
        docu.data.length !== docu.size) {
      
      console.error('❌ Document data is invalid:', {
        hasData: !!docu.data,
        isBuffer: Buffer.isBuffer(docu.data),
        dataLength: docu.data ? docu.data.length : 0,
        storedSize: docu.size,
        isValid: docu.data && docu.data.length === docu.size
      });
      
      return res.status(400).json({ 
        message: "File content not available or corrupted. This file may have been uploaded before the fix." 
      });
    }

    // Set headers for file download
    res.setHeader("Content-Disposition", `attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType || "application/octet-stream");
    res.setHeader("Content-Length", docu.data.length);
    res.setHeader("Cache-Control", "no-cache");
    
    console.log(`✅ Sending file: ${docu.name}, size: ${docu.data.length} bytes`);
    
    // Send the binary data
    res.send(docu.data);

    await logActivity(req.headers["x-username"] || "System", `Downloaded document: ${docu.name}`);

  } catch (err) {
    console.error("❌ Document download error:", err); 
    res.status(500).json({ message: "Server error during download: " + err.message });
  }
});

// ============================================================================
//                    DEBUG ROUTE - CHECK SPECIFIC DOCUMENT
// ============================================================================
app.get("/api/debug/document/:id", async (req, res) => {
  try {
    console.log(`🔍 Debug request for document: ${req.params.id}`);
    
    const docu = await Doc.findById(req.params.id);
    if (!docu) {
      console.log('Document not found');
      return res.status(404).json({ error: "Document not found" });
    }
    
    const debugInfo = {
      id: docu._id.toString(),
      name: docu.name,
      size: docu.size,
      contentType: docu.contentType,
      hasData: !!docu.data,
      dataLength: docu.data ? docu.data.length : 0,
      dataType: typeof docu.data,
      isBuffer: Buffer.isBuffer(docu.data),
      date: docu.date,
      isSizeValid: docu.size > 0 && docu.size === (docu.data ? docu.data.length : 0)
    };
    
    console.log(`🔍 Debug info for ${docu.name}:`, debugInfo);
    res.json(debugInfo);
  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({ error: err.message });
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
