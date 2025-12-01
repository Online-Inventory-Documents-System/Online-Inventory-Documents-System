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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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

const CompanySchema = new Schema({
  name: { type: String, default: "L&B Company" },
  address: { type: String, default: "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka" },
  phone: { type: String, default: "01133127622" },
  email: { type: String, default: "lbcompany@gmail.com" },
  updatedAt: { type: Date, default: Date.now }
});
const Company = mongoose.model("Company", CompanySchema);

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

// ===== Updated Purchase Schema for Multiple Products =====
const PurchaseItemSchema = new Schema({
  sku: String,
  productName: String,
  quantity: { type: Number, default: 0 },
  purchasePrice: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 }
});

const PurchaseSchema = new Schema({
  purchaseId: { type: String, unique: true, required: true },
  supplier: String,
  purchaseDate: { type: Date, default: Date.now },
  notes: String,
  items: [PurchaseItemSchema],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", PurchaseSchema);

// ===== NEW: Sales Schema =====
const SalesItemSchema = new Schema({
  sku: String,
  productName: String,
  quantity: { type: Number, default: 0 },
  salePrice: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 }
});

const SalesSchema = new Schema({
  salesId: { type: String, unique: true, required: true },
  customer: String,
  salesDate: { type: Date, default: Date.now },
  notes: String,
  items: [SalesItemSchema],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Sales = mongoose.model("Sales", SalesSchema);

// ===== NEW: Folder Schema for Document Management =====
const FolderSchema = new Schema({
  name: { type: String, required: true },
  parentFolder: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
  path: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: String
});
const Folder = mongoose.model("Folder", FolderSchema);

// ===== Updated Document Schema with Folder Support =====
const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  data: Buffer,
  contentType: String,
  folder: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
  tags: [String],
  createdBy: String,
  reportType: { type: String, default: '' }
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

// ===== NEW: Get Company Information =====
async function getCompanyInfo() {
  try {
    let company = await Company.findOne({});
    if (!company) {
      company = await Company.create({});
    }
    return company;
  } catch (err) {
    console.error("Company info error:", err);
    return {
      name: "L&B Company",
      address: "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka",
      phone: "01133127622",
      email: "lbcompany@gmail.com"
    };
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
//                           COMPANY INFORMATION
// ============================================================================
app.get("/api/company", async (req, res) => {
  try {
    const company = await getCompanyInfo();
    res.json(company);
  } catch (err) {
    console.error("Company get error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/company", async (req, res) => {
  try {
    const { name, address, phone, email } = req.body;
    const username = req.headers["x-username"];

    let company = await Company.findOne({});
    if (!company) {
      company = await Company.create({ name, address, phone, email });
    } else {
      company.name = name;
      company.address = address;
      company.phone = phone;
      company.email = email;
      company.updatedAt = new Date();
      await company.save();
    }

    await logActivity(username, "Updated company information");
    res.json({ success: true, message: "Company information updated" });
  } catch (err) {
    console.error("Company update error:", err);
    res.status(500).json({ message: "Server error" });
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

  if (username !== currentUser) {
    return res.status(403).json({ success: false, message: "You can only change your own password" });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

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
//                    ENHANCED PDF REPORT WITH DATE RANGE
// ============================================================================
app.post("/api/inventory/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate, reportType = 'inventory' } = req.body;
    let items = await Inventory.find({}).lean();

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      items = items.filter(item => {
        const itemDate = new Date(item.createdAt);
        return itemDate >= start && itemDate <= end;
      });
    }

    const company = await getCompanyInfo();
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

    const reportId = `INV-REP-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
      : 'All Dates';
    
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`📊 Generating PDF report: ${filename}, Date Range: ${dateRangeText}`);

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
        doc.fontSize(22).font("Helvetica-Bold").text(company.name, 40, 40);
        doc.fontSize(10).font("Helvetica");
        doc.text(company.address, 40, 70);
        doc.text(`Phone: ${company.phone}`, 40, 85);
        doc.text(`Email: ${company.email}`, 40, 100);

        doc.font("Helvetica-Bold").fontSize(15)
           .text("INVENTORY REPORT", 620, 40);

        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 620, 63);
        doc.text(`Report ID: ${reportId}`, 620, 78);
        doc.text(`Date Range: ${dateRangeText}`, 620, 93);
        doc.text(`Printed by: ${printedBy}`, 620, 108);

        doc.moveTo(40, 130).lineTo(800, 130).stroke();

        const rowHeight = 18;
        
        const columns = [
          { name: "SKU", x: 40, width: 70 },
          { name: "Product Name", x: 110, width: 110 },
          { name: "Category", x: 220, width: 80 },
          { name: "Quantity", x: 300, width: 60 },
          { name: "Unit Cost", x: 360, width: 70 },
          { name: "Unit Price", x: 430, width: 70 },
          { name: "Inventory Value", x: 500, width: 85 },
          { name: "Potential Revenue", x: 585, width: 95 },
          { name: "Potential Profit", x: 680, width: 100 }
        ];
        
        let y = 150;

        function drawTableHeader() {
          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          doc.font("Helvetica-Bold").fontSize(9);
          columns.forEach(col => {
            doc.text(col.name, col.x + 3, y + 5);
          });
          
          y += rowHeight;
        }

        function drawTableRow(item) {
          const qty = Number(item.quantity || 0);
          const cost = Number(item.unitCost || 0);
          const price = Number(item.unitPrice || 0);
          const inventoryValue = qty * cost;
          const potentialRevenue = qty * price;
          const potentialProfit = potentialRevenue - inventoryValue;

          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          doc.font("Helvetica").fontSize(8);
          doc.text(item.sku || "", columns[0].x + 3, y + 5);
          doc.text(item.name || "", columns[1].x + 3, y + 5);
          doc.text(item.category || "", columns[2].x + 3, y + 5);
          doc.text(String(qty), columns[3].x + 3, y + 5);
          doc.text(`RM ${cost.toFixed(2)}`, columns[4].x + 3, y + 5);
          doc.text(`RM ${price.toFixed(2)}`, columns[5].x + 3, y + 5);
          doc.text(`RM ${inventoryValue.toFixed(2)}`, columns[6].x + 3, y + 5);
          doc.text(`RM ${potentialRevenue.toFixed(2)}`, columns[7].x + 3, y + 5);
          doc.text(`RM ${potentialProfit.toFixed(2)}`, columns[8].x + 3, y + 5);
          
          y += rowHeight;
          
          return {
            qty,
            inventoryValue,
            potentialRevenue,
            potentialProfit
          };
        }

        drawTableHeader();
        
        let subtotalQty = 0;
        let totalValue = 0;
        let totalRevenue = 0;
        let totalProfit = 0;
        let rowsOnPage = 0;

        for (const item of items) {
          if (rowsOnPage === 10) {
            doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
            y = 40;
            rowsOnPage = 0;
            drawTableHeader();
          }

          const calculations = drawTableRow(item);
          
          subtotalQty += calculations.qty;
          totalValue += calculations.inventoryValue;
          totalRevenue += calculations.potentialRevenue;
          totalProfit += calculations.potentialProfit;
          
          rowsOnPage++;
        }

        const lastPageIndex = doc.bufferedPageRange().count - 1;
        doc.switchToPage(lastPageIndex);
        
        let boxY = y + 20;
        if (boxY > 450) {
          doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
          boxY = 40;
        }
        
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
          doc.fontSize(9).text(`Generated by ${company.name} Inventory System`, 0, doc.page.height - 40, { align: "center" });
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
      contentType: "application/pdf",
      tags: ['inventory-report', 'pdf', 'report'],
      reportType: 'inventory-report',
      createdBy: printedBy
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
//                    FIXED: ENHANCED PURCHASE REPORT WITH BETTER LAYOUT
// ============================================================================
app.post("/api/purchases/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    let purchases = await Purchase.find({}).sort({ purchaseDate: -1 }).lean();

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      purchases = purchases.filter(purchase => {
        const purchaseDate = new Date(purchase.purchaseDate);
        return purchaseDate >= start && purchaseDate <= end;
      });
    }

    const company = await getCompanyInfo();
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
      : 'All Dates';
    
    const filename = `Purchase_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`📊 Generating Purchase PDF report: ${filename}, Date Range: ${dateRangeText}`);

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 36,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header
        const topY = 36;
        
        // Company Info
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 36, topY);
        doc.fontSize(10).font('Helvetica')
           .text(company.address, 36, topY + 22);
        doc.text(`Phone: ${company.phone}`, 36, topY + 37);
        doc.text(`Email: ${company.email}`, 36, topY + 52);

        // Report Title
        doc.fontSize(14).font('Helvetica-Bold')
           .text('PURCHASE REPORT', 36, topY + 80);
        doc.fontSize(10).font('Helvetica')
           .text(`Date Range: ${dateRangeText}`, 36, topY + 100);
        doc.text(`Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 36, topY + 115);
        doc.text(`By: ${printedBy}`, 36, topY + 130);
        
        // Calculate totals
        const grandTotal = purchases.reduce((sum, purchase) => sum + (purchase.totalAmount || 0), 0);
        const totalOrders = purchases.length;
        const totalItems = purchases.reduce((sum, purchase) => sum + purchase.items.length, 0);
        
        // Summary box
        doc.rect(360, topY + 80, 200, 80).stroke();
        doc.font('Helvetica-Bold').fontSize(10)
           .text('SUMMARY', 370, topY + 85);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Total Orders: ${totalOrders}`, 370, topY + 102);
        doc.text(`Total Items: ${totalItems}`, 370, topY + 117);
        doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, 370, topY + 132);

        // Start purchases table
        let y = topY + 180;
        
        // Check if we need a new page
        if (y > 700) {
          doc.addPage();
          y = 36;
        }

        // Table header
        const tableTop = y;
        const colX = { 
          order: 36, 
          supplier: 100, 
          date: 250, 
          items: 320, 
          total: 420, 
          status: 500
        };

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Order ID', colX.order, tableTop);
        doc.text('Supplier', colX.supplier, tableTop);
        doc.text('Date', colX.date, tableTop);
        doc.text('Items', colX.items, tableTop, { width: 50, align: 'center' });
        doc.text('Amount', colX.total, tableTop, { width: 70, align: 'right' });
        doc.text('Status', colX.status, tableTop, { width: 70, align: 'center' });

        // Table header line
        doc.moveTo(36, tableTop + 16).lineTo(570, tableTop + 16).stroke();

        // Table rows
        doc.font('Helvetica').fontSize(9);
        let currentY = tableTop + 24;
        
        purchases.forEach((purchase, index) => {
          // Check for page break
          if (currentY > 700) {
            doc.addPage();
            currentY = 36;
            
            // Redraw table header
            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Order ID', colX.order, currentY);
            doc.text('Supplier', colX.supplier, currentY);
            doc.text('Date', colX.date, currentY);
            doc.text('Items', colX.items, currentY, { width: 50, align: 'center' });
            doc.text('Amount', colX.total, currentY, { width: 70, align: 'right' });
            doc.text('Status', colX.status, currentY, { width: 70, align: 'center' });
            doc.moveTo(36, currentY + 16).lineTo(570, currentY + 16).stroke();
            currentY += 24;
            doc.font('Helvetica').fontSize(9);
          }

          // Alternate row background
          if (index % 2 === 0) {
            doc.rect(36, currentY - 4, 534, 18)
               .fillColor('#f5f5f5')
               .fill();
          }

          doc.fillColor('#000000')
             .text(purchase.purchaseId || 'N/A', colX.order, currentY, { width: 60 })
             .text(purchase.supplier || 'N/A', colX.supplier, currentY, { width: 140 })
             .text(new Date(purchase.purchaseDate).toLocaleDateString(), colX.date, currentY, { width: 60 })
             .text(String(purchase.items?.length || 0), colX.items, currentY, { width: 50, align: 'center' })
             .text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, colX.total, currentY, { width: 70, align: 'right' })
             .text('✓ Completed', colX.status, currentY, { width: 70, align: 'center' });

          currentY += 18;
          
          // Add space for item details if needed
          if (purchase.items && purchase.items.length > 0) {
            purchase.items.forEach(item => {
              if (currentY > 700) {
                doc.addPage();
                currentY = 36;
              }
              
              const indent = 50;
              doc.fontSize(8)
                 .text(`• ${item.productName} (${item.sku}): ${item.quantity} x RM ${item.purchasePrice.toFixed(2)} = RM ${item.totalAmount.toFixed(2)}`, 
                       colX.order + indent, currentY, { width: 450 });
              currentY += 12;
            });
            currentY += 5;
          }
        });

        // Final summary
        const summaryY = Math.min(currentY + 20, 720);
        doc.moveTo(360, summaryY).lineTo(560, summaryY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('FINAL SUMMARY', 370, summaryY + 12);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Total Purchase Orders: ${totalOrders}`, 370, summaryY + 30);
        doc.text(`Total Items Purchased: ${totalItems}`, 370, summaryY + 45);
        doc.font('Helvetica-Bold')
           .text(`Grand Total Amount: RM ${grandTotal.toFixed(2)}`, 370, summaryY + 65);

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Generated by ${company.name} Inventory System`, 36, doc.page.height - 40, { align: 'center', width: doc.page.width - 72 });

        // Page numbers
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(8)
             .fillColor('#666666')
             .text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { 
               align: 'center', 
               width: doc.page.width - 72 
             });
        }

        doc.end();

      } catch (error) {
        reject(error);
      }
    });

    console.log(`💾 Saving Purchase PDF to database: ${pdfBuffer.length} bytes`);

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf",
      tags: ['purchase-report', 'pdf', 'report'],
      reportType: 'purchase-report',
      createdBy: printedBy
    });

    console.log(`✅ Purchase PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Purchase Report PDF: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Purchase PDF Generation Error:", err);
    res.status(500).json({ message: "Purchase PDF generation failed: " + err.message });
  }
});

// ============================================================================
//                    FIXED: ENHANCED SALES REPORT WITH BETTER LAYOUT
// ============================================================================
app.post("/api/sales/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    let sales = await Sales.find({}).sort({ salesDate: -1 }).lean();

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      sales = sales.filter(sale => {
        const salesDate = new Date(sale.salesDate);
        return salesDate >= start && salesDate <= end;
      });
    }

    const company = await getCompanyInfo();
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`
      : 'All Dates';
    
    const filename = `Sales_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`📊 Generating Sales PDF report: ${filename}, Date Range: ${dateRangeText}`);

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 36,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header
        const topY = 36;
        
        // Company Info
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 36, topY);
        doc.fontSize(10).font('Helvetica')
           .text(company.address, 36, topY + 22);
        doc.text(`Phone: ${company.phone}`, 36, topY + 37);
        doc.text(`Email: ${company.email}`, 36, topY + 52);

        // Report Title
        doc.fontSize(14).font('Helvetica-Bold')
           .text('SALES REPORT', 36, topY + 80);
        doc.fontSize(10).font('Helvetica')
           .text(`Date Range: ${dateRangeText}`, 36, topY + 100);
        doc.text(`Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 36, topY + 115);
        doc.text(`By: ${printedBy}`, 36, topY + 130);
        
        // Calculate totals
        const grandTotal = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const totalOrders = sales.length;
        const totalItems = sales.reduce((sum, sale) => sum + sale.items.length, 0);
        
        // Summary box
        doc.rect(360, topY + 80, 200, 80).stroke();
        doc.font('Helvetica-Bold').fontSize(10)
           .text('SUMMARY', 370, topY + 85);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Total Orders: ${totalOrders}`, 370, topY + 102);
        doc.text(`Total Items: ${totalItems}`, 370, topY + 117);
        doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, 370, topY + 132);

        // Start sales table
        let y = topY + 180;
        
        // Check if we need a new page
        if (y > 700) {
          doc.addPage();
          y = 36;
        }

        // Table header
        const tableTop = y;
        const colX = { 
          order: 36, 
          customer: 100, 
          date: 250, 
          items: 320, 
          total: 420, 
          status: 500
        };

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Order ID', colX.order, tableTop);
        doc.text('Customer', colX.customer, tableTop);
        doc.text('Date', colX.date, tableTop);
        doc.text('Items', colX.items, tableTop, { width: 50, align: 'center' });
        doc.text('Amount', colX.total, tableTop, { width: 70, align: 'right' });
        doc.text('Status', colX.status, tableTop, { width: 70, align: 'center' });

        // Table header line
        doc.moveTo(36, tableTop + 16).lineTo(570, tableTop + 16).stroke();

        // Table rows
        doc.font('Helvetica').fontSize(9);
        let currentY = tableTop + 24;
        
        sales.forEach((sale, index) => {
          // Check for page break
          if (currentY > 700) {
            doc.addPage();
            currentY = 36;
            
            // Redraw table header
            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Order ID', colX.order, currentY);
            doc.text('Customer', colX.customer, currentY);
            doc.text('Date', colX.date, currentY);
            doc.text('Items', colX.items, currentY, { width: 50, align: 'center' });
            doc.text('Amount', colX.total, currentY, { width: 70, align: 'right' });
            doc.text('Status', colX.status, currentY, { width: 70, align: 'center' });
            doc.moveTo(36, currentY + 16).lineTo(570, currentY + 16).stroke();
            currentY += 24;
            doc.font('Helvetica').fontSize(9);
          }

          // Alternate row background
          if (index % 2 === 0) {
            doc.rect(36, currentY - 4, 534, 18)
               .fillColor('#f5f5f5')
               .fill();
          }

          doc.fillColor('#000000')
             .text(sale.salesId || 'N/A', colX.order, currentY, { width: 60 })
             .text(sale.customer || 'N/A', colX.customer, currentY, { width: 140 })
             .text(new Date(sale.salesDate).toLocaleDateString(), colX.date, currentY, { width: 60 })
             .text(String(sale.items?.length || 0), colX.items, currentY, { width: 50, align: 'center' })
             .text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, colX.total, currentY, { width: 70, align: 'right' })
             .text('✓ Completed', colX.status, currentY, { width: 70, align: 'center' });

          currentY += 18;
          
          // Add space for item details if needed
          if (sale.items && sale.items.length > 0) {
            sale.items.forEach(item => {
              if (currentY > 700) {
                doc.addPage();
                currentY = 36;
              }
              
              const indent = 50;
              doc.fontSize(8)
                 .text(`• ${item.productName} (${item.sku}): ${item.quantity} x RM ${item.salePrice.toFixed(2)} = RM ${item.totalAmount.toFixed(2)}`, 
                       colX.order + indent, currentY, { width: 450 });
              currentY += 12;
            });
            currentY += 5;
          }
        });

        // Final summary
        const summaryY = Math.min(currentY + 20, 720);
        doc.moveTo(360, summaryY).lineTo(560, summaryY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('FINAL SUMMARY', 370, summaryY + 12);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Total Sales Orders: ${totalOrders}`, 370, summaryY + 30);
        doc.text(`Total Items Sold: ${totalItems}`, 370, summaryY + 45);
        doc.font('Helvetica-Bold')
           .text(`Grand Total Revenue: RM ${grandTotal.toFixed(2)}`, 370, summaryY + 65);

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Generated by ${company.name} Inventory System`, 36, doc.page.height - 40, { align: 'center', width: doc.page.width - 72 });

        // Page numbers
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(8)
             .fillColor('#666666')
             .text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 30, { 
               align: 'center', 
               width: doc.page.width - 72 
             });
        }

        doc.end();

      } catch (error) {
        reject(error);
      }
    });

    console.log(`💾 Saving Sales PDF to database: ${pdfBuffer.length} bytes`);

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf",
      tags: ['sales-report', 'pdf', 'report'],
      reportType: 'sales-report',
      createdBy: printedBy
    });

    console.log(`✅ Sales PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Sales Report PDF: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Sales PDF Generation Error:", err);
    res.status(500).json({ message: "Sales PDF generation failed: " + err.message });
  }
});

// ============================================================================
//                    GENERATE ALL REPORTS
// ============================================================================
app.post("/api/reports/generate-all", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const printedBy = req.headers["x-username"] || "System";
    
    console.log(`📊 Generating all reports for date range: ${startDate} to ${endDate}`);

    // Generate inventory report
    const inventoryBuffer = await generateInventoryReportBuffer(startDate, endDate, printedBy);
    const inventoryDoc = await saveReportToDatabase(
      `Inventory_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`,
      inventoryBuffer,
      printedBy,
      'inventory-report'
    );

    // Generate purchase report
    const purchaseBuffer = await generatePurchaseReportBuffer(startDate, endDate, printedBy);
    const purchaseDoc = await saveReportToDatabase(
      `Purchase_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`,
      purchaseBuffer,
      printedBy,
      'purchase-report'
    );

    // Generate sales report
    const salesBuffer = await generateSalesReportBuffer(startDate, endDate, printedBy);
    const salesDoc = await saveReportToDatabase(
      `Sales_Report_${new Date().toISOString().slice(0, 10)}_${Date.now()}.pdf`,
      salesBuffer,
      printedBy,
      'sales-report'
    );

    res.json({
      success: true,
      message: "All reports generated successfully!",
      reports: [
        { type: 'inventory', id: inventoryDoc._id, name: inventoryDoc.name },
        { type: 'purchase', id: purchaseDoc._id, name: purchaseDoc.name },
        { type: 'sales', id: salesDoc._id, name: salesDoc.name }
      ]
    });

  } catch (err) {
    console.error("❌ Generate all reports error:", err);
    res.status(500).json({ success: false, message: "Failed to generate reports: " + err.message });
  }
});

// Helper function to save report to database
async function saveReportToDatabase(filename, buffer, printedBy, reportType) {
  console.log(`💾 Saving ${reportType} to database: ${buffer.length} bytes`);

  const savedDoc = await Doc.create({
    name: filename,
    size: buffer.length,
    date: new Date(),
    data: buffer,
    contentType: "application/pdf",
    tags: [reportType, 'pdf', 'report'],
    reportType: reportType,
    createdBy: printedBy
  });

  console.log(`✅ ${reportType} saved to database with ID: ${savedDoc._id}`);
  await logActivity(printedBy, `Generated ${reportType} PDF: ${filename}`);
  
  return savedDoc;
}

// Helper functions for report generation
async function generateInventoryReportBuffer(startDate, endDate, printedBy) {
  return new Promise(async (resolve, reject) => {
    try {
      let items = await Inventory.find({}).lean();

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        items = items.filter(item => {
          const itemDate = new Date(item.createdAt);
          return itemDate >= start && itemDate <= end;
        });
      }

      const company = await getCompanyInfo();
      
      const pdfBuffer = await new Promise((innerResolve, innerReject) => {
        try {
          const doc = new PDFDocument({
            size: "A4",
            layout: "landscape",
            margin: 40,
            bufferPages: true
          });
          
          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => innerResolve(Buffer.concat(chunks)));
          
          doc.fontSize(22).font("Helvetica-Bold").text(company.name, 40, 40);
          doc.fontSize(10).font("Helvetica");
          doc.text(company.address, 40, 70);
          doc.text(`Phone: ${company.phone}`, 40, 85);
          doc.text(`Email: ${company.email}`, 40, 100);

          doc.font("Helvetica-Bold").fontSize(15)
             .text("INVENTORY REPORT", 620, 40);

          doc.font("Helvetica").fontSize(10);
          doc.text(`Print Date: ${new Date().toLocaleString()}`, 620, 63);
          doc.text(`Date Range: ${startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All Dates'}`, 620, 78);
          doc.text(`Printed by: ${printedBy}`, 620, 93);

          doc.moveTo(40, 130).lineTo(800, 130).stroke();

          const rowHeight = 18;
          const columns = [
            { name: "SKU", x: 40, width: 70 },
            { name: "Product Name", x: 110, width: 110 },
            { name: "Category", x: 220, width: 80 },
            { name: "Quantity", x: 300, width: 60 },
            { name: "Unit Cost", x: 360, width: 70 },
            { name: "Unit Price", x: 430, width: 70 },
            { name: "Inventory Value", x: 500, width: 85 },
            { name: "Potential Revenue", x: 585, width: 95 },
            { name: "Potential Profit", x: 680, width: 100 }
          ];
          
          let y = 150;

          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          doc.font("Helvetica-Bold").fontSize(9);
          columns.forEach(col => {
            doc.text(col.name, col.x + 3, y + 5);
          });
          
          y += rowHeight;

          doc.font("Helvetica").fontSize(8);
          items.forEach(item => {
            const qty = Number(item.quantity || 0);
            const cost = Number(item.unitCost || 0);
            const price = Number(item.unitPrice || 0);
            const inventoryValue = qty * cost;
            const potentialRevenue = qty * price;
            const potentialProfit = potentialRevenue - inventoryValue;

            doc.rect(columns[0].x, y, 740, rowHeight).stroke();
            for (let i = 1; i < columns.length; i++) {
              doc.moveTo(columns[i].x, y)
                 .lineTo(columns[i].x, y + rowHeight)
                 .stroke();
            }
            
            doc.text(item.sku || "", columns[0].x + 3, y + 5);
            doc.text(item.name || "", columns[1].x + 3, y + 5);
            doc.text(item.category || "", columns[2].x + 3, y + 5);
            doc.text(String(qty), columns[3].x + 3, y + 5);
            doc.text(`RM ${cost.toFixed(2)}`, columns[4].x + 3, y + 5);
            doc.text(`RM ${price.toFixed(2)}`, columns[5].x + 3, y + 5);
            doc.text(`RM ${inventoryValue.toFixed(2)}`, columns[6].x + 3, y + 5);
            doc.text(`RM ${potentialRevenue.toFixed(2)}`, columns[7].x + 3, y + 5);
            doc.text(`RM ${potentialProfit.toFixed(2)}`, columns[8].x + 3, y + 5);
            
            y += rowHeight;
          });

          doc.end();
        } catch (error) {
          innerReject(error);
        }
      });

      resolve(pdfBuffer);
    } catch (error) {
      reject(error);
    }
  });
}

async function generatePurchaseReportBuffer(startDate, endDate, printedBy) {
  return new Promise(async (resolve, reject) => {
    try {
      let purchases = await Purchase.find({}).sort({ purchaseDate: -1 }).lean();

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        purchases = purchases.filter(purchase => {
          const purchaseDate = new Date(purchase.purchaseDate);
          return purchaseDate >= start && purchaseDate <= end;
        });
      }

      const company = await getCompanyInfo();
      
      const pdfBuffer = await new Promise((innerResolve, innerReject) => {
        try {
          const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 36,
            bufferPages: true
          });
          
          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => innerResolve(Buffer.concat(chunks)));
          
          const topY = 36;
          
          doc.fontSize(16).font('Helvetica-Bold')
             .text(company.name, 36, topY);
          doc.fontSize(10).font('Helvetica')
             .text(company.address, 36, topY + 22);
          doc.text(`Phone: ${company.phone}`, 36, topY + 37);
          doc.text(`Email: ${company.email}`, 36, topY + 52);

          doc.fontSize(14).font('Helvetica-Bold')
             .text('PURCHASE REPORT', 36, topY + 80);
          doc.fontSize(10).font('Helvetica')
             .text(`Date Range: ${startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All Dates'}`, 36, topY + 100);
          doc.text(`Generated: ${new Date().toLocaleDateString()}`, 36, topY + 115);
          doc.text(`By: ${printedBy}`, 36, topY + 130);
          
          const grandTotal = purchases.reduce((sum, purchase) => sum + (purchase.totalAmount || 0), 0);
          const totalOrders = purchases.length;
          
          doc.rect(360, topY + 80, 200, 60).stroke();
          doc.font('Helvetica-Bold').fontSize(10)
             .text('SUMMARY', 370, topY + 85);
          doc.font('Helvetica').fontSize(9);
          doc.text(`Total Orders: ${totalOrders}`, 370, topY + 102);
          doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, 370, topY + 117);

          let y = topY + 180;
          
          purchases.forEach((purchase, index) => {
            if (y > 700) {
              doc.addPage();
              y = 36;
            }

            doc.fontSize(11).font('Helvetica-Bold')
               .text(`Purchase Order: ${purchase.purchaseId}`, 36, y);
            doc.fontSize(10).font('Helvetica')
               .text(`Supplier: ${purchase.supplier || 'N/A'}`, 36, y + 18);
            doc.text(`Date: ${new Date(purchase.purchaseDate).toLocaleDateString()}`, 36, y + 33);
            doc.text(`Total: RM ${(purchase.totalAmount || 0).toFixed(2)}`, 36, y + 48);
            
            y += 70;

            const itemTableTop = y;
            const colX = { 
              sku: 36, 
              name: 120, 
              qty: 350, 
              price: 420, 
              total: 500 
            };

            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('SKU', colX.sku, itemTableTop);
            doc.text('Product Name', colX.name, itemTableTop);
            doc.text('Qty', colX.qty, itemTableTop, { width: 60, align: 'center' });
            doc.text('Unit Price', colX.price, itemTableTop, { width: 70, align: 'right' });
            doc.text('Total', colX.total, itemTableTop, { width: 70, align: 'right' });

            doc.moveTo(36, itemTableTop + 16).lineTo(560, itemTableTop + 16).stroke();

            doc.font('Helvetica').fontSize(9);
            let itemY = itemTableTop + 24;
            
            purchase.items.forEach((item, itemIndex) => {
              if (itemIndex % 2 === 0) {
                doc.rect(36, itemY - 4, 524, 18)
                   .fillColor('#f5f5f5')
                   .fill();
              }

              doc.fillColor('#000000')
                 .text(item.sku || 'N/A', colX.sku, itemY, { width: 80 })
                 .text(item.productName || 'N/A', colX.name, itemY, { width: 220 })
                 .text(String(item.quantity || 0), colX.qty, itemY, { width: 60, align: 'center' })
                 .text(`RM ${(item.purchasePrice || 0).toFixed(2)}`, colX.price, itemY, { width: 70, align: 'right' })
                 .text(`RM ${(item.totalAmount || 0).toFixed(2)}`, colX.total, itemY, { width: 70, align: 'right' });

              itemY += 18;
            });
            
            y = itemY + 20;
            
            if (index < purchases.length - 1) {
              doc.moveTo(36, y).lineTo(560, y).stroke();
              y += 30;
            }
          });

          doc.end();
        } catch (error) {
          innerReject(error);
        }
      });

      resolve(pdfBuffer);
    } catch (error) {
      reject(error);
    }
  });
}

async function generateSalesReportBuffer(startDate, endDate, printedBy) {
  return new Promise(async (resolve, reject) => {
    try {
      let sales = await Sales.find({}).sort({ salesDate: -1 }).lean();

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        sales = sales.filter(sale => {
          const salesDate = new Date(sale.salesDate);
          return salesDate >= start && salesDate <= end;
        });
      }

      const company = await getCompanyInfo();
      
      const pdfBuffer = await new Promise((innerResolve, innerReject) => {
        try {
          const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 36,
            bufferPages: true
          });
          
          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          doc.on('end', () => innerResolve(Buffer.concat(chunks)));
          
          const topY = 36;
          
          doc.fontSize(16).font('Helvetica-Bold')
             .text(company.name, 36, topY);
          doc.fontSize(10).font('Helvetica')
             .text(company.address, 36, topY + 22);
          doc.text(`Phone: ${company.phone}`, 36, topY + 37);
          doc.text(`Email: ${company.email}`, 36, topY + 52);

          doc.fontSize(14).font('Helvetica-Bold')
             .text('SALES REPORT', 36, topY + 80);
          doc.fontSize(10).font('Helvetica')
             .text(`Date Range: ${startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All Dates'}`, 36, topY + 100);
          doc.text(`Generated: ${new Date().toLocaleDateString()}`, 36, topY + 115);
          doc.text(`By: ${printedBy}`, 36, topY + 130);
          
          const grandTotal = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
          const totalOrders = sales.length;
          
          doc.rect(360, topY + 80, 200, 60).stroke();
          doc.font('Helvetica-Bold').fontSize(10)
             .text('SUMMARY', 370, topY + 85);
          doc.font('Helvetica').fontSize(9);
          doc.text(`Total Orders: ${totalOrders}`, 370, topY + 102);
          doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, 370, topY + 117);

          let y = topY + 180;
          
          sales.forEach((sale, index) => {
            if (y > 700) {
              doc.addPage();
              y = 36;
            }

            doc.fontSize(11).font('Helvetica-Bold')
               .text(`Sales Order: ${sale.salesId}`, 36, y);
            doc.fontSize(10).font('Helvetica')
               .text(`Customer: ${sale.customer || 'N/A'}`, 36, y + 18);
            doc.text(`Date: ${new Date(sale.salesDate).toLocaleDateString()}`, 36, y + 33);
            doc.text(`Total: RM ${(sale.totalAmount || 0).toFixed(2)}`, 36, y + 48);
            
            y += 70;

            const itemTableTop = y;
            const colX = { 
              sku: 36, 
              name: 120, 
              qty: 350, 
              price: 420, 
              total: 500 
            };

            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('SKU', colX.sku, itemTableTop);
            doc.text('Product Name', colX.name, itemTableTop);
            doc.text('Qty', colX.qty, itemTableTop, { width: 60, align: 'center' });
            doc.text('Unit Price', colX.price, itemTableTop, { width: 70, align: 'right' });
            doc.text('Total', colX.total, itemTableTop, { width: 70, align: 'right' });

            doc.moveTo(36, itemTableTop + 16).lineTo(560, itemTableTop + 16).stroke();

            doc.font('Helvetica').fontSize(9);
            let itemY = itemTableTop + 24;
            
            sale.items.forEach((item, itemIndex) => {
              if (itemIndex % 2 === 0) {
                doc.rect(36, itemY - 4, 524, 18)
                   .fillColor('#f5f5f5')
                   .fill();
              }

              doc.fillColor('#000000')
                 .text(item.sku || 'N/A', colX.sku, itemY, { width: 80 })
                 .text(item.productName || 'N/A', colX.name, itemY, { width: 220 })
                 .text(String(item.quantity || 0), colX.qty, itemY, { width: 60, align: 'center' })
                 .text(`RM ${(item.salePrice || 0).toFixed(2)}`, colX.price, itemY, { width: 70, align: 'right' })
                 .text(`RM ${(item.totalAmount || 0).toFixed(2)}`, colX.total, itemY, { width: 70, align: 'right' });

              itemY += 18;
            });
            
            y = itemY + 20;
            
            if (index < sales.length - 1) {
              doc.moveTo(36, y).lineTo(560, y).stroke();
              y += 30;
            }
          });

          doc.end();
        } catch (error) {
          innerReject(error);
        }
      });

      resolve(pdfBuffer);
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
//                               PURCHASE CRUD
// ============================================================================
app.get("/api/purchases", async (req, res) => {
  try {
    const purchases = await Purchase.find({}).sort({ purchaseDate: -1 }).lean();
    const normalized = purchases.map(p => ({
      ...p,
      id: p._id.toString()
    }));
    res.json(normalized);
  } catch (err) {
    console.error("purchases get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/purchases/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }
    
    res.json({
      ...purchase,
      id: purchase._id.toString()
    });
  } catch (err) {
    console.error("purchase get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/purchases", async (req, res) => {
  try {
    const { supplier, purchaseDate, notes, items } = req.body;
    
    const purchaseId = `PUR-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    let totalAmount = 0;
    const purchaseItems = [];

    for (const item of items) {
      const itemTotal = item.quantity * item.purchasePrice;
      totalAmount += itemTotal;

      purchaseItems.push({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
        totalAmount: itemTotal
      });

      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = (inventoryItem.quantity || 0) + item.quantity;
        if (item.purchasePrice > 0) {
          inventoryItem.unitCost = item.purchasePrice;
        }
        await inventoryItem.save();
      }
    }

    const purchase = await Purchase.create({
      purchaseId,
      supplier,
      purchaseDate: purchaseDate || new Date(),
      notes,
      items: purchaseItems,
      totalAmount
    });

    await logActivity(req.headers["x-username"], `Created purchase order: ${purchaseId} with ${items.length} items`);

    res.status(201).json({
      ...purchase.toObject(),
      id: purchase._id.toString()
    });

  } catch (err) {
    console.error("purchase post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/purchases/:id", async (req, res) => {
  try {
    const { supplier, purchaseDate, notes, items } = req.body;
    
    const existingPurchase = await Purchase.findById(req.params.id);
    if (!existingPurchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    for (const oldItem of existingPurchase.items) {
      const inventoryItem = await Inventory.findOne({ sku: oldItem.sku });
      if (inventoryItem) {
        inventoryItem.quantity = Math.max(0, (inventoryItem.quantity || 0) - oldItem.quantity);
        await inventoryItem.save();
      }
    }

    let totalAmount = 0;
    const purchaseItems = [];

    for (const item of items) {
      const itemTotal = item.quantity * item.purchasePrice;
      totalAmount += itemTotal;

      purchaseItems.push({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
        totalAmount: itemTotal
      });

      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = (inventoryItem.quantity || 0) + item.quantity;
        if (item.purchasePrice > 0) {
          inventoryItem.unitCost = item.purchasePrice;
        }
        await inventoryItem.save();
      }
    }

    const purchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      {
        supplier,
        purchaseDate,
        notes,
        items: purchaseItems,
        totalAmount
      },
      { new: true }
    );

    await logActivity(req.headers["x-username"], `Updated purchase order: ${purchase.purchaseId}`);

    res.json({
      ...purchase.toObject(),
      id: purchase._id.toString()
    });

  } catch (err) {
    console.error("purchase update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/purchases/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase)
      return res.status(404).json({ message: "Purchase not found" });

    for (const item of purchase.items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = Math.max(0, (inventoryItem.quantity || 0) - item.quantity);
        await inventoryItem.save();
      }
    }

    await Purchase.findByIdAndDelete(req.params.id);
    await logActivity(req.headers["x-username"], `Deleted purchase order: ${purchase.purchaseId}`);
    res.status(204).send();

  } catch (err) {
    console.error("purchase delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                               SALES CRUD (NEW)
// ============================================================================
app.get("/api/sales", async (req, res) => {
  try {
    const sales = await Sales.find({}).sort({ salesDate: -1 }).lean();
    const normalized = sales.map(s => ({
      ...s,
      id: s._id.toString()
    }));
    res.json(normalized);
  } catch (err) {
    console.error("sales get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/sales/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }
    
    res.json({
      ...sale,
      id: sale._id.toString()
    });
  } catch (err) {
    console.error("sales get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    const { customer, salesDate, notes, items } = req.body;
    
    const salesId = `SAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    let totalAmount = 0;
    const salesItems = [];

    for (const item of items) {
      const itemTotal = item.quantity * item.salePrice;
      totalAmount += itemTotal;

      salesItems.push({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        salePrice: item.salePrice,
        totalAmount: itemTotal
      });

      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        if (inventoryItem.quantity < item.quantity) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${item.productName}. Available: ${inventoryItem.quantity}, Requested: ${item.quantity}` 
          });
        }
        inventoryItem.quantity = (inventoryItem.quantity || 0) - item.quantity;
        await inventoryItem.save();
      }
    }

    const sale = await Sales.create({
      salesId,
      customer,
      salesDate: salesDate || new Date(),
      notes,
      items: salesItems,
      totalAmount
    });

    await logActivity(req.headers["x-username"], `Created sales order: ${salesId} with ${items.length} items`);

    res.status(201).json({
      ...sale.toObject(),
      id: sale._id.toString()
    });

  } catch (err) {
    console.error("sales post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/sales/:id", async (req, res) => {
  try {
    const { customer, salesDate, notes, items } = req.body;
    
    const existingSale = await Sales.findById(req.params.id);
    if (!existingSale) {
      return res.status(404).json({ message: "Sales not found" });
    }

    for (const oldItem of existingSale.items) {
      const inventoryItem = await Inventory.findOne({ sku: oldItem.sku });
      if (inventoryItem) {
        inventoryItem.quantity = (inventoryItem.quantity || 0) + oldItem.quantity;
        await inventoryItem.save();
      }
    }

    let totalAmount = 0;
    const salesItems = [];

    for (const item of items) {
      const itemTotal = item.quantity * item.salePrice;
      totalAmount += itemTotal;

      salesItems.push({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        salePrice: item.salePrice,
        totalAmount: itemTotal
      });

      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        if (inventoryItem.quantity < item.quantity) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${item.productName}. Available: ${inventoryItem.quantity}, Requested: ${item.quantity}` 
          });
        }
        inventoryItem.quantity = (inventoryItem.quantity || 0) - item.quantity;
        await inventoryItem.save();
      }
    }

    const sale = await Sales.findByIdAndUpdate(
      req.params.id,
      {
        customer,
        salesDate,
        notes,
        items: salesItems,
        totalAmount
      },
      { new: true }
    );

    await logActivity(req.headers["x-username"], `Updated sales order: ${sale.salesId}`);

    res.json({
      ...sale.toObject(),
      id: sale._id.toString()
    });

  } catch (err) {
    console.error("sales update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id);
    if (!sale)
      return res.status(404).json({ message: "Sales not found" });

    for (const item of sale.items) {
      const inventoryItem = await Inventory.findOne({ sku: item.sku });
      if (inventoryItem) {
        inventoryItem.quantity = (inventoryItem.quantity || 0) + item.quantity;
        await inventoryItem.save();
      }
    }

    await Sales.findByIdAndDelete(req.params.id);
    await logActivity(req.headers["x-username"], `Deleted sales order: ${sale.salesId}`);
    res.status(204).send();

  } catch (err) {
    console.error("sales delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    SINGLE PURCHASE INVOICE PDF
// ============================================================================
app.get("/api/purchases/invoice/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const company = await getCompanyInfo();
    const filename = `Purchase_Invoice_${purchase.purchaseId}.pdf`;

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const invoiceData = {
          title: 'PURCHASE INVOICE',
          companyInfo: {
            name: company.name,
            address: company.address,
            phone: company.phone,
            email: company.email
          },
          docMeta: {
            reference: purchase.purchaseId,
            dateString: new Date(purchase.purchaseDate).toLocaleDateString(),
            status: 'PURCHASE'
          },
          customer: {
            name: purchase.supplier || 'Supplier',
            contact: purchase.supplier || 'N/A'
          },
          items: purchase.items.map(item => ({
            name: item.productName || 'N/A',
            sku: item.sku || 'N/A',
            qty: item.quantity || 0,
            price: item.purchasePrice || 0,
            total: item.totalAmount || 0
          })),
          totals: {
            subtotal: purchase.subtotal || purchase.totalAmount,
            tax: 0,
            grandTotal: purchase.totalAmount || 0
          },
          extraNotes: purchase.notes || ''
        };

        const buffer = await generateInvoicePDFBuffer(invoiceData);
        resolve(buffer);

      } catch (error) {
        reject(error);
      }
    });

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf",
      tags: ['purchase-invoice', 'pdf', 'invoice'],
      reportType: 'purchase-invoice',
      createdBy: req.headers["x-username"] || "System"
    });

    console.log(`✅ Purchase invoice saved to database with ID: ${savedDoc._id}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Purchase Invoice Generation Error:", err);
    res.status(500).json({ message: "Purchase invoice generation failed: " + err.message });
  }
});

// ============================================================================
//                    SINGLE SALES INVOICE PDF (NEW)
// ============================================================================
app.get("/api/sales/invoice/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }

    const company = await getCompanyInfo();
    const filename = `Sales_Invoice_${sale.salesId}.pdf`;

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const invoiceData = {
          title: 'SALES INVOICE',
          companyInfo: {
            name: company.name,
            address: company.address,
            phone: company.phone,
            email: company.email
          },
          docMeta: {
            reference: sale.salesId,
            dateString: new Date(sale.salesDate).toLocaleDateString(),
            status: 'SALES'
          },
          customer: {
            name: sale.customer || 'Customer',
            contact: sale.customer || 'N/A'
          },
          items: sale.items.map(item => ({
            name: item.productName || 'N/A',
            sku: item.sku || 'N/A',
            qty: item.quantity || 0,
            price: item.salePrice || 0,
            total: item.totalAmount || 0
          })),
          totals: {
            subtotal: sale.subtotal || sale.totalAmount,
            tax: 0,
            grandTotal: sale.totalAmount || 0
          },
          extraNotes: sale.notes || ''
        };

        const buffer = await generateInvoicePDFBuffer(invoiceData);
        resolve(buffer);

      } catch (error) {
        reject(error);
      }
    });

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf",
      tags: ['sales-invoice', 'pdf', 'invoice'],
      reportType: 'sales-invoice',
      createdBy: req.headers["x-username"] || "System"
    });

    console.log(`✅ Sales invoice saved to database with ID: ${savedDoc._id}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Sales Invoice Generation Error:", err);
    res.status(500).json({ message: "Sales invoice generation failed: " + err.message });
  }
});

// ===== IMPROVED Helper: generate PDF buffer using PDFKit (two-column professional invoice) =====
function generateInvoicePDFBuffer({ title = 'Invoice', companyInfo = {}, docMeta = {}, customer = {}, items = [], totals = {}, extraNotes = '' }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4', 
        margin: 36,
        bufferPages: true 
      });
      
      const bufs = [];
      doc.on('data', (d) => bufs.push(d));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      // Header - two column design
      const topY = 36;
      
      // Left column - Company Info
      doc.fontSize(14).font('Helvetica-Bold')
         .text(companyInfo.name || 'L&B COMPANY', 36, topY);
      doc.fontSize(10).font('Helvetica')
         .text(companyInfo.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 36, topY + 18, { continued: false });
      doc.text(`Phone: ${companyInfo.phone || '01133127622'}`);
      doc.text(`Email: ${companyInfo.email || 'lbcompany@gmail.com'}`);

      // Right column - Invoice Meta
      const rightX = 360;
      doc.fontSize(12).font('Helvetica-Bold')
         .text(title, rightX, topY, { align: 'right' });
      doc.fontSize(10).font('Helvetica')
         .text(`No: ${docMeta.reference || ''}`, rightX, topY + 20, { align: 'right' });
      doc.text(`Date: ${docMeta.dateString || new Date().toLocaleDateString()}`, { align: 'right' });
      doc.text(`Status: ${docMeta.status || 'INVOICE'}`, { align: 'right' });

      // Customer Information
      const customerY = 120;
      doc.fontSize(10).font('Helvetica-Bold')
         .text(title.includes('PURCHASE') ? 'Supplier:' : 'Customer:', 36, customerY);
      doc.font('Helvetica')
         .text(customer.name || 'N/A', 36, customerY + 15);
      if (customer.contact) {
        doc.text(`Contact: ${customer.contact}`, 36, doc.y);
      }

      // Items table header
      const tableTop = 170;
      const colX = { 
        item: 36, 
        sku: 260, 
        qty: 360, 
        price: 420, 
        total: 500 
      };
      
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Product Name', colX.item, tableTop);
      doc.text('SKU', colX.sku, tableTop);
      doc.text('Qty', colX.qty, tableTop);
      doc.text('Unit Price', colX.price, tableTop, { width: 70, align: 'right' });
      doc.text('Total', colX.total, tableTop, { width: 70, align: 'right' });

      // Table header line
      doc.moveTo(36, tableTop + 16).lineTo(560, tableTop + 16).stroke();

      // Table rows
      doc.font('Helvetica').fontSize(9);
      let y = tableTop + 24;
      
      items.forEach((item, index) => {
        if (y > 700) {
          doc.addPage();
          y = 60;
          doc.fontSize(10).font('Helvetica-Bold');
          doc.text('Product Name', colX.item, y);
          doc.text('SKU', colX.sku, y);
          doc.text('Qty', colX.qty, y);
          doc.text('Unit Price', colX.price, y, { width: 70, align: 'right' });
          doc.text('Total', colX.total, y, { width: 70, align: 'right' });
          doc.moveTo(36, y + 16).lineTo(560, y + 16).stroke();
          y += 24;
          doc.font('Helvetica').fontSize(9);
        }

        if (index % 2 === 0) {
          doc.rect(36, y - 4, 524, 18)
             .fillColor('#f5f5f5')
             .fill();
        }

        doc.fillColor('#000000')
           .text(item.name || 'N/A', colX.item, y, { width: 220 })
           .text(item.sku || 'N/A', colX.sku, y, { width: 90 })
           .text(String(item.qty || 0), colX.qty, y, { width: 50, align: 'center' })
           .text(`RM ${Number(item.price || 0).toFixed(2)}`, colX.price, y, { width: 70, align: 'right' })
           .text(`RM ${Number(item.total || 0).toFixed(2)}`, colX.total, y, { width: 70, align: 'right' });
        
        y += 18;
      });

      // Totals section
      const totalsY = Math.max(y + 10, 650);
      doc.moveTo(400, totalsY).lineTo(560, totalsY).stroke();
      
      const subtotal = totals.subtotal || items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
      const tax = totals.tax || 0;
      const grand = totals.grandTotal || subtotal + tax;
      
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Subtotal', 400, totalsY + 12, { width: 90, align: 'right' });
      doc.text(`RM ${Number(subtotal).toFixed(2)}`, 500, totalsY + 12, { width: 70, align: 'right' });
      
      doc.text('Tax (0%)', 400, totalsY + 30, { width: 90, align: 'right' });
      doc.text(`RM ${Number(tax).toFixed(2)}`, 500, totalsY + 30, { width: 70, align: 'right' });
      
      doc.moveTo(400, totalsY + 48).lineTo(560, totalsY + 48).stroke();
      doc.text('Total Amount', 400, totalsY + 60, { width: 90, align: 'right' });
      doc.text(`RM ${Number(grand).toFixed(2)}`, 500, totalsY + 60, { width: 70, align: 'right' });

      // Notes section
      if (extraNotes) {
        doc.moveDown(2);
        doc.font('Helvetica').fontSize(9)
           .text('Notes:', 36, totalsY + 90)
           .text(extraNotes, 36, totalsY + 105, { width: 500 });
      }

      // Footer
      doc.fontSize(9).font('Helvetica')
         .text(`Thank you for your business. Generated by ${companyInfo.name} Inventory System`, 
               36, 760, { align: 'center', width: 520 });

      // Page numbers
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
           .fillColor('#666666')
           .text(`Page ${i + 1} of ${range.count}`, 
                 36, doc.page.height - 30, 
                 { align: 'center', width: doc.page.width - 72 });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================================
//                    FOLDER MANAGEMENT (NEW)
// ============================================================================
app.get("/api/folders", async (req, res) => {
  try {
    const folders = await Folder.find({}).sort({ name: 1 }).lean();
    const normalized = folders.map(f => ({
      ...f,
      id: f._id.toString()
    }));
    res.json(normalized);
  } catch (err) {
    console.error("folders get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const { name, parentFolder } = req.body;
    const username = req.headers["x-username"];

    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    const existingFolder = await Folder.findOne({ 
      name, 
      parentFolder: parentFolder || null 
    });
    
    if (existingFolder) {
      return res.status(409).json({ message: "Folder with this name already exists" });
    }

    const folder = await Folder.create({
      name,
      parentFolder: parentFolder || null,
      createdBy: username
    });

    await logActivity(username, `Created folder: ${name}`);

    res.status(201).json({
      ...folder.toObject(),
      id: folder._id.toString()
    });

  } catch (err) {
    console.error("folder post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/folders/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const username = req.headers["x-username"];

    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    const folder = await Folder.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );

    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    await logActivity(username, `Renamed folder to: ${name}`);

    res.json({
      ...folder.toObject(),
      id: folder._id.toString()
    });

  } catch (err) {
    console.error("folder update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/folders/:id", async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.id);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    const subfolders = await Folder.find({ parentFolder: req.params.id });
    if (subfolders.length > 0) {
      return res.status(400).json({ 
        message: "Cannot delete folder that contains subfolders. Please delete subfolders first." 
      });
    }

    const documents = await Doc.find({ folder: req.params.id });
    if (documents.length > 0) {
      return res.status(400).json({ 
        message: "Cannot delete folder that contains documents. Please move or delete documents first." 
      });
    }

    await Folder.findByIdAndDelete(req.params.id);
    await logActivity(req.headers["x-username"], `Deleted folder: ${folder.name}`);
    res.status(204).send();

  } catch (err) {
    console.error("folder delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    DOCUMENTS UPLOAD WITH FOLDER SUPPORT
// ============================================================================
app.post("/api/documents", async (req, res) => {
  console.log("📤 Document upload request received");
  
  try {
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
        const folderId = req.headers['x-folder-id'];

        console.log(`📄 Upload details:`, {
          fileName,
          contentType,
          fileSize: fileBuffer.length,
          username,
          folderId
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

        if (fileBuffer.length > 50 * 1024 * 1024) {
          console.error("❌ File too large:", fileBuffer.length);
          return res.status(400).json({ 
            message: "File size exceeds 50MB limit." 
          });
        }

        console.log(`✅ File validated: ${fileName}, size: ${fileBuffer.length} bytes`);

        const docu = await Doc.create({
          name: fileName,
          size: fileBuffer.length,
          date: new Date(),
          data: fileBuffer,
          contentType: contentType || "application/octet-stream",
          folder: folderId || null,
          createdBy: username
        });
        
        console.log(`💾 File saved to database:`, {
          id: docu._id,
          name: docu.name,
          size: docu.size,
          contentType: docu.contentType,
          folder: docu.folder
        });
        
        await logActivity(username, `Uploaded document: ${fileName}`);
        
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
//                    DOCUMENTS WITH FOLDER SUPPORT
// ============================================================================
app.get("/api/documents", async (req, res) => {
  try {
    const { folder } = req.query;
    let query = {};
    
    if (folder) {
      if (folder === 'root') {
        query.folder = null;
      } else {
        query.folder = folder;
      }
    }

    const docs = await Doc.find(query).select('-data').sort({ date: -1 }).lean();
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

// Document check route
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
//                    DOCUMENT MOVE TO FOLDER
// ============================================================================
app.put("/api/documents/:id/move", async (req, res) => {
  try {
    const { folderId } = req.body;
    const username = req.headers["x-username"];

    const docu = await Doc.findByIdAndUpdate(
      req.params.id,
      { folder: folderId || null },
      { new: true }
    );

    if (!docu) {
      return res.status(404).json({ message: "Document not found" });
    }

    await logActivity(username, `Moved document: ${docu.name} to folder`);
    res.json({
      ...docu.toObject(),
      id: docu._id.toString()
    });

  } catch (err) {
    console.error("document move error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    DOCUMENT PREVIEW ENDPOINT
// ============================================================================
app.get("/api/documents/preview/:id", async (req, res) => {
  try {
    const docu = await Doc.findById(req.params.id);
    
    if (!docu) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (!docu.data || docu.data.length === 0) {
      return res.status(400).json({ message: "Document content not available" });
    }

    res.setHeader("Content-Type", docu.contentType || "application/octet-stream");
    res.setHeader("Content-Length", docu.data.length);
    res.setHeader("Content-Disposition", `inline; filename="${docu.name}"`);
    res.send(docu.data);

  } catch (err) {
    console.error("Document preview error:", err);
    res.status(500).json({ message: "Preview failed" });
  }
});

// ============================================================================
//                             DOCUMENTS DOWNLOAD
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
        message: "File content not available or corrupted." 
      });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType || "application/octet-stream");
    res.setHeader("Content-Length", docu.data.length);
    res.setHeader("Cache-Control", "no-cache");
    
    console.log(`✅ Sending file: ${docu.name}, size: ${docu.data.length} bytes`);
    
    res.send(docu.data);

    await logActivity(req.headers["x-username"] || "System", `Downloaded document: ${docu.name}`);

  } catch (err) {
    console.error("❌ Document download error:", err); 
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
//                    FIXED: GET REPORTS BY TYPE WITH PROPER QUERY
// ============================================================================
app.get("/api/statements/:type", async (req, res) => {
  try {
    const { type } = req.params;
    
    let query = {};
    
    switch (type) {
      case 'inventory-reports':
        query = { 
          $or: [
            { reportType: 'inventory-report' },
            { tags: { $in: ['inventory-report', 'report'] } },
            { name: { $regex: /inventory.*report/i } }
          ]
        };
        break;
      case 'purchase-invoices':
        query = { 
          $or: [
            { reportType: 'purchase-invoice' },
            { tags: { $in: ['purchase-invoice', 'invoice'] } },
            { name: { $regex: /purchase.*invoice/i } }
          ]
        };
        break;
      case 'sales-invoices':
        query = { 
          $or: [
            { reportType: 'sales-invoice' },
            { tags: { $in: ['sales-invoice', 'invoice'] } },
            { name: { $regex: /sales.*invoice/i } }
          ]
        };
        break;
      case 'purchase-reports':
        query = { 
          $or: [
            { reportType: 'purchase-report' },
            { tags: { $in: ['purchase-report', 'report'] } },
            { name: { $regex: /purchase.*report/i } }
          ]
        };
        break;
      case 'sales-reports':
        query = { 
          $or: [
            { reportType: 'sales-report' },
            { tags: { $in: ['sales-report', 'report'] } },
            { name: { $regex: /sales.*report/i } }
          ]
        };
        break;
      case 'all-reports':
        query = { 
          $or: [
            { reportType: { $regex: /report$/i } },
            { tags: { $in: ['report'] } },
            { name: { $regex: /report/i } }
          ]
        };
        break;
      case 'all-invoices':
        query = { 
          $or: [
            { reportType: { $regex: /invoice$/i } },
            { tags: { $in: ['invoice'] } },
            { name: { $regex: /invoice/i } }
          ]
        };
        break;
      default:
        return res.status(400).json({ message: "Invalid statement type" });
    }

    const docs = await Doc.find(query).select('-data').sort({ date: -1 }).lean();

    const result = docs.map(d => ({
      ...d,
      id: d._id.toString()
    }));

    const totalCount = result.length;
    const totalSize = result.reduce((sum, doc) => sum + (doc.size || 0), 0);

    res.json({
      documents: result,
      summary: {
        totalCount,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
      }
    });

  } catch (err) {
    console.error("Statements get error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    GET STATEMENTS SUMMARY
// ============================================================================
app.get("/api/statements-summary", async (req, res) => {
  try {
    const inventoryReports = await Doc.countDocuments({ 
      $or: [
        { reportType: 'inventory-report' },
        { tags: { $in: ['inventory-report', 'report'] } },
        { name: { $regex: /inventory.*report/i } }
      ]
    });
    
    const purchaseInvoices = await Doc.countDocuments({ 
      $or: [
        { reportType: 'purchase-invoice' },
        { tags: { $in: ['purchase-invoice', 'invoice'] } },
        { name: { $regex: /purchase.*invoice/i } }
      ]
    });
    
    const salesInvoices = await Doc.countDocuments({ 
      $or: [
        { reportType: 'sales-invoice' },
        { tags: { $in: ['sales-invoice', 'invoice'] } },
        { name: { $regex: /sales.*invoice/i } }
      ]
    });
    
    const purchaseReports = await Doc.countDocuments({ 
      $or: [
        { reportType: 'purchase-report' },
        { tags: { $in: ['purchase-report', 'report'] } },
        { name: { $regex: /purchase.*report/i } }
      ]
    });
    
    const salesReports = await Doc.countDocuments({ 
      $or: [
        { reportType: 'sales-report' },
        { tags: { $in: ['sales-report', 'report'] } },
        { name: { $regex: /sales.*report/i } }
      ]
    });

    res.json({
      success: true,
      summary: {
        inventoryReports,
        purchaseInvoices,
        salesInvoices,
        purchaseReports,
        salesReports,
        totalReports: inventoryReports + purchaseReports + salesReports,
        totalInvoices: purchaseInvoices + salesInvoices,
        totalDocuments: inventoryReports + purchaseInvoices + salesInvoices + purchaseReports + salesReports
      }
    });

  } catch (err) {
    console.error("Statements summary error:", err);
    res.status(500).json({ success: false, message: "Server error" });
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
//                          GET ALL DATA FOR DASHBOARD
// ============================================================================
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const inventoryCount = await Inventory.countDocuments({});
    const purchaseCount = await Purchase.countDocuments({});
    const salesCount = await Sales.countDocuments({});
    const documentCount = await Doc.countDocuments({});
    
    const inventoryItems = await Inventory.find({}).lean();
    let inventoryValue = 0;
    let inventoryRevenue = 0;
    let inventoryProfit = 0;
    let totalStock = 0;
    
    inventoryItems.forEach(item => {
      const qty = Number(item.quantity || 0);
      const cost = Number(item.unitCost || 0);
      const price = Number(item.unitPrice || 0);
      const itemValue = qty * cost;
      const itemRevenue = qty * price;
      const itemProfit = itemRevenue - itemValue;
      
      inventoryValue += itemValue;
      inventoryRevenue += itemRevenue;
      inventoryProfit += itemProfit;
      totalStock += qty;
    });
    
    const purchases = await Purchase.find({}).lean();
    const purchaseTotal = purchases.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
    
    const sales = await Sales.find({}).lean();
    const salesTotal = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    const recentLogs = await ActivityLog.find({}).sort({ time: -1 }).limit(5).lean();
    
    const lowStockItems = await Inventory.find({ quantity: { $lt: 10 } }).lean();
    
    res.json({
      success: true,
      stats: {
        inventory: {
          count: inventoryCount,
          value: inventoryValue,
          revenue: inventoryRevenue,
          profit: inventoryProfit,
          stock: totalStock,
          lowStock: lowStockItems.length
        },
        purchases: {
          count: purchaseCount,
          total: purchaseTotal
        },
        sales: {
          count: salesCount,
          total: salesTotal
        },
        documents: {
          count: documentCount
        },
        recentActivity: recentLogs,
        lowStockItems: lowStockItems.slice(0, 5)
      }
    });
    
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ success: false, message: "Server error" });
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

    await getCompanyInfo();
    
    const rootFolders = ['Reports', 'Invoices', 'Documents', 'Backups'];
    for (const folderName of rootFolders) {
      const exists = await Folder.findOne({ name: folderName, parentFolder: null });
      if (!exists) {
        await Folder.create({
          name: folderName,
          parentFolder: null,
          createdBy: 'System'
        });
      }
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

// Export app for testing
module.exports = app;
