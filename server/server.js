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

// ===== Helper functions for UTC+8 date formatting =====
function formatDateUTC8(date) {
  if (!date) return '';
  const d = new Date(date);
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  const day = utc8Time.getDate().toString().padStart(2, '0');
  const month = (utc8Time.getMonth() + 1).toString().padStart(2, '0');
  const year = utc8Time.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimeUTC8(date) {
  if (!date) return '';
  const d = new Date(date);
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  const day = utc8Time.getDate().toString().padStart(2, '0');
  const month = (utc8Time.getMonth() + 1).toString().padStart(2, '0');
  const year = utc8Time.getFullYear();
  
  let hours = utc8Time.getHours();
  const minutes = utc8Time.getMinutes().toString().padStart(2, '0');
  const seconds = utc8Time.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = hours.toString().padStart(2, '0');
  
  return `${day}/${month}/${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
}

// ===== Counter for sequential invoice numbers =====
let invoiceCounter = {
  inventory: 0,
  purchase: 0,
  sales: 0
};

async function getNextInvoiceNumber(type) {
  try {
    let latestDoc;
    switch(type) {
      case 'inventory':
        latestDoc = await Inventory.findOne().sort({ createdAt: -1 });
        break;
      case 'purchase':
        latestDoc = await Purchase.findOne().sort({ createdAt: -1 });
        break;
      case 'sales':
        latestDoc = await Sales.findOne().sort({ createdAt: -1 });
        break;
    }
    
    if (latestDoc) {
      let counter = 0;
      if (type === 'inventory' && latestDoc.reportId) {
        const match = latestDoc.reportId.match(/\d+/);
        counter = match ? parseInt(match[0]) : 0;
      } else if (type === 'purchase' && latestDoc.purchaseId) {
        const match = latestDoc.purchaseId.match(/\d+/);
        counter = match ? parseInt(match[0]) : 0;
      } else if (type === 'sales' && latestDoc.salesId) {
        const match = latestDoc.salesId.match(/\d+/);
        counter = match ? parseInt(match[0]) : 0;
      }
      invoiceCounter[type] = counter + 1;
    } else {
      invoiceCounter[type] = 1;
    }
    
    return invoiceCounter[type].toString().padStart(9, '0');
  } catch (err) {
    console.error('Error getting invoice number:', err);
    return Date.now().toString().slice(-9);
  }
}

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
  supplierContact: String,
  purchaseDate: { type: Date, default: Date.now },
  notes: String,
  items: [PurchaseItemSchema],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", PurchaseSchema);

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
  customerContact: String,
  salesDate: { type: Date, default: Date.now },
  notes: String,
  items: [SalesItemSchema],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Sales = mongoose.model("Sales", SalesSchema);

const FolderSchema = new Schema({
  name: { type: String, required: true },
  parentFolder: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
  path: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: String
});
const Folder = mongoose.model("Folder", FolderSchema);

const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: { type: Date, default: Date.now },
  data: Buffer,
  contentType: String,
  folder: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
  tags: [String],
  createdBy: String
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  device: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// ===== Duplicate Log Protection =====
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action, device = 'Unknown Device') {
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
      device: device,
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
    await logActivity("System", `Registered user: ${username}`, req.headers['user-agent'] || 'Unknown Device');

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

    await logActivity(username, "Logged in", req.headers['user-agent'] || 'Unknown Device');
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

    await logActivity(username, "Updated company information", req.headers['user-agent'] || 'Unknown Device');
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

    await logActivity(username, "Changed password", req.headers['user-agent'] || 'Unknown Device');
    
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

    await logActivity("System", `Deleted user account: ${username}`, req.headers['user-agent'] || 'Unknown Device');
    
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
      id: i._id.toString(),
      createdAt: formatDateUTC8(i.createdAt)
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
    await logActivity(req.headers["x-username"], `Added: ${item.name}`, req.headers['user-agent'] || 'Unknown Device');

    res.status(201).json({
      ...item.toObject(),
      id: item._id.toString(),
      createdAt: formatDateUTC8(item.createdAt)
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

    await logActivity(req.headers["x-username"], `Updated: ${item.name}`, req.headers['user-agent'] || 'Unknown Device');
    res.json({
      ...item.toObject(),
      id: item._id.toString(),
      createdAt: formatDateUTC8(item.createdAt)
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

    await logActivity(req.headers["x-username"], `Deleted: ${item.name}`, req.headers['user-agent'] || 'Unknown Device');
    res.status(204).send();

  } catch (err) {
    console.error("inventory delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    ENHANCED PDF REPORT WITH DATE RANGE - UPDATED LAYOUT
// ============================================================================
app.post("/api/inventory/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate, reportType = 'inventory' } = req.body;
    
    console.log(`📊 Generating inventory report with date range:`, {
      startDate,
      endDate,
      reportType
    });

    let query = {};
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      query.createdAt = {
        $gte: start,
        $lte: end
      };
      
      console.log(`Querying items between ${start} and ${end}`);
    } else if (startDate) {
      const start = new Date(startDate);
      query.createdAt = { $gte: start };
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $lte: end };
    }

    let items = await Inventory.find(query).lean();
    
    console.log(`Found ${items.length} items for report`);

    if (items.length === 0 && (startDate || endDate)) {
      console.log(`No items found in date range, showing all items`);
      items = await Inventory.find({}).lean();
    }

    const company = await getCompanyInfo();
    const now = new Date();
    const printDate = formatDateTimeUTC8(now);
    
    const reportNumber = await getNextInvoiceNumber('inventory');
    const reportId = `INVR-${reportNumber}`;
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${formatDateUTC8(startDate)} to ${formatDateUTC8(endDate)}`
      : 'All Dates';
    
    const filename = `Inventory_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`📊 Generating PDF report: ${filename}, Report ID: ${reportId}`);

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

        // Header with improved design
        doc.rect(40, 40, 740, 80).stroke();
        
        // Company info with line wrapping
        doc.fontSize(18).font("Helvetica-Bold").text(company.name, 50, 50);
        doc.fontSize(10).font("Helvetica");
        
        const addressLines = doc.textOfHeight(company.address, 200);
        let addressY = 75;
        addressLines.forEach(line => {
          doc.text(line, 50, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 50, addressY + 5);
        doc.text(`Email: ${company.email}`, 50, addressY + 20);

        // Report info section
        doc.font("Helvetica-Bold").fontSize(16)
           .text("INVENTORY REPORT", 620, 50);

        doc.font("Helvetica").fontSize(10);
        doc.text(`Report No: ${reportId}`, 620, 73);
        doc.text(`Print Date: ${printDate}`, 620, 88);
        doc.text(`Date Range: ${dateRangeText}`, 620, 103);
        doc.text(`Printed by: ${printedBy}`, 620, 118);

        doc.moveTo(40, 130).lineTo(780, 130).stroke();

        const rowHeight = 18;
        
        const columns = [
          { name: "NO", x: 40, width: 30 },
          { name: "SKU", x: 70, width: 70 },
          { name: "Product Name", x: 140, width: 100 },
          { name: "Category", x: 240, width: 70 },
          { name: "Quantity", x: 310, width: 50 },
          { name: "Unit Cost", x: 360, width: 60 },
          { name: "Unit Price", x: 420, width: 60 },
          { name: "Total Cost", x: 480, width: 70 },
          { name: "Total Price", x: 550, width: 70 },
          { name: "Date", x: 620, width: 60 },
          { name: "Status", x: 680, width: 80 }
        ];
        
        let y = 150;

        function drawTableHeader() {
          doc.rect(columns[0].x, y, 740, rowHeight).fillAndStroke('#f0f0f0', '#333');
          
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          doc.font("Helvetica-Bold").fontSize(9).fillColor('#333');
          columns.forEach(col => {
            doc.text(col.name, col.x + 3, y + 5);
          });
          
          y += rowHeight;
        }

        function drawTableRow(item, index) {
          const qty = Number(item.quantity || 0);
          const cost = Number(item.unitCost || 0);
          const price = Number(item.unitPrice || 0);
          const totalCost = qty * cost;
          const totalPrice = qty * price;
          
          let status = '';
          if (qty === 0) {
            status = 'Out of Stock';
          } else if (qty < 10) {
            status = 'Low Stock';
          } else {
            status = 'In Stock';
          }

          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          doc.font("Helvetica").fontSize(8).fillColor('#000');
          doc.text(String(index + 1), columns[0].x + 3, y + 5);
          doc.text(item.sku || "", columns[1].x + 3, y + 5);
          doc.text(item.name || "", columns[2].x + 3, y + 5);
          doc.text(item.category || "", columns[3].x + 3, y + 5);
          doc.text(String(qty), columns[4].x + 3, y + 5);
          doc.text(`RM ${cost.toFixed(2)}`, columns[5].x + 3, y + 5);
          doc.text(`RM ${price.toFixed(2)}`, columns[6].x + 3, y + 5);
          doc.text(`RM ${totalCost.toFixed(2)}`, columns[7].x + 3, y + 5);
          doc.text(`RM ${totalPrice.toFixed(2)}`, columns[8].x + 3, y + 5);
          doc.text(item.createdAt ? formatDateUTC8(item.createdAt) : '', columns[9].x + 3, y + 5);
          doc.text(status, columns[10].x + 3, y + 5);
          
          y += rowHeight;
          
          return {
            qty,
            totalCost,
            totalPrice
          };
        }

        drawTableHeader();
        
        let subtotalQty = 0;
        let grandTotalCost = 0;
        let grandTotalPrice = 0;
        let rowsOnPage = 0;

        for (let i = 0; i < items.length; i++) {
          if (y > 450) {
            doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
            y = 40;
            rowsOnPage = 0;
            drawTableHeader();
          }

          const calculations = drawTableRow(items[i], i);
          
          subtotalQty += calculations.qty;
          grandTotalCost += calculations.totalCost;
          grandTotalPrice += calculations.totalPrice;
          
          rowsOnPage++;
        }

        const lastPageIndex = doc.bufferedPageRange().count - 1;
        doc.switchToPage(lastPageIndex);
        
        let boxY = y + 20;
        if (boxY > 450) {
          doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
          boxY = 40;
        }
        
        // Summary box with border
        doc.rect(560, boxY, 220, 80).stroke();
        doc.font("Helvetica-Bold").fontSize(10).fillColor('#333');
        doc.text(`Total Products: ${items.length}`, 570, boxY + 10);
        doc.text(`Total Quantity: ${subtotalQty} units`, 570, boxY + 25);
        doc.text(`Total Cost: RM ${grandTotalCost.toFixed(2)}`, 570, boxY + 40);
        doc.text(`Total Retail Price: RM ${grandTotalPrice.toFixed(2)}`, 570, boxY + 55);

        doc.fontSize(9).font("Helvetica").fillColor('#666')
           .text(`Generated by ${company.name} Inventory System`, 
                 40, doc.page.height - 40, { align: "center" });
        doc.text(`Report No: ${reportId} | Page 1 of 1`, 
                 40, doc.page.height - 25, { align: "center" });
        
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
      tags: ['inventory-report', 'pdf']
    });

    console.log(`✅ PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Inventory Report PDF: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

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
//                               PURCHASE CRUD
// ============================================================================
app.get("/api/purchases", async (req, res) => {
  try {
    const purchases = await Purchase.find({}).sort({ purchaseDate: -1 }).lean();
    const normalized = purchases.map(p => ({
      ...p,
      id: p._id.toString(),
      purchaseDate: formatDateUTC8(p.purchaseDate)
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
    
    const response = {
      ...purchase,
      id: purchase._id.toString(),
      _id: purchase._id.toString(),
      purchaseDate: formatDateUTC8(purchase.purchaseDate)
    };
    
    res.json(response);
  } catch (err) {
    console.error("purchase get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/purchases", async (req, res) => {
  try {
    const { supplier, supplierContact, purchaseDate, notes, items } = req.body;
    
    const purchaseNumber = await getNextInvoiceNumber('purchase');
    const purchaseId = `PUR-${purchaseNumber}`;
    
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
      supplierContact: supplierContact || supplier || 'N/A',
      purchaseDate: purchaseDate || new Date(),
      notes,
      items: purchaseItems,
      totalAmount
    });

    await logActivity(req.headers["x-username"], `Created purchase order: ${purchaseId} with ${items.length} items`, req.headers['user-agent'] || 'Unknown Device');

    res.status(201).json({
      ...purchase.toObject(),
      id: purchase._id.toString(),
      purchaseId: purchase.purchaseId,
      purchaseDate: formatDateUTC8(purchase.purchaseDate)
    });

  } catch (err) {
    console.error("purchase post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                               SALES CRUD
// ============================================================================
app.get("/api/sales", async (req, res) => {
  try {
    const sales = await Sales.find({}).sort({ salesDate: -1 }).lean();
    const normalized = sales.map(s => ({
      ...s,
      id: s._id.toString(),
      salesDate: formatDateUTC8(s.salesDate)
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
    
    const response = {
      ...sale,
      id: sale._id.toString(),
      _id: sale._id.toString(),
      salesDate: formatDateUTC8(sale.salesDate)
    };
    
    res.json(response);
  } catch (err) {
    console.error("sales get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    const { customer, customerContact, salesDate, notes, items } = req.body;
    
    const salesNumber = await getNextInvoiceNumber('sales');
    const salesId = `SAL-${salesNumber}`;
    
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
      customerContact: customerContact || customer || 'N/A',
      salesDate: salesDate || new Date(),
      notes,
      items: salesItems,
      totalAmount
    });

    await logActivity(req.headers["x-username"], `Created sales order: ${salesId} with ${items.length} items`, req.headers['user-agent'] || 'Unknown Device');

    res.status(201).json({
      ...sale.toObject(),
      id: sale._id.toString(),
      salesId: sale.salesId,
      salesDate: formatDateUTC8(sale.salesDate)
    });

  } catch (err) {
    console.error("sales post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    ENHANCED SINGLE PURCHASE INVOICE PDF
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
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 40,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header with border
        doc.rect(40, 40, 520, 100).stroke();
        
        // Company info with line wrapping
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 50, 50);
        
        doc.fontSize(10).font('Helvetica');
        const addressLines = doc.textOfHeight(company.address, 300);
        let addressY = 75;
        addressLines.forEach(line => {
          doc.text(line, 50, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 50, addressY + 5);
        doc.text(`Email: ${company.email}`, 50, addressY + 20);

        // Invoice info
        doc.fontSize(18).font('Helvetica-Bold')
           .text('PURCHASE INVOICE', 370, 50);
        
        doc.fontSize(11).font('Helvetica')
           .text(`Invoice No: ${purchase.purchaseId}`, 370, 80, { align: 'right' })
           .text(`Date: ${formatDateUTC8(purchase.purchaseDate)}`, { align: 'right' })
           .text('Status: PAID', { align: 'right' });

        // Supplier info box
        doc.rect(40, 160, 520, 50).stroke();
        doc.fontSize(12).font('Helvetica-Bold')
           .text('SUPPLIER DETAILS:', 50, 170);
        
        doc.font('Helvetica').fontSize(10)
           .text(`${purchase.supplier || 'Supplier'}`, 50, 190);
        
        if (purchase.supplierContact) {
          doc.text(`Contact: ${purchase.supplierContact}`, 50, 205);
        }

        const tableTop = 230;
        const colX = { 
          no: 40, 
          item: 70, 
          sku: 200, 
          qty: 320, 
          price: 380, 
          total: 470 
        };
        
        doc.fontSize(11).font('Helvetica-Bold')
           .text('NO', colX.no, tableTop)
           .text('PRODUCT', colX.item, tableTop)
           .text('SKU', colX.sku, tableTop)
           .text('QTY', colX.qty, tableTop)
           .text('PRICE', colX.price, tableTop, { width: 80, align: 'right' })
           .text('TOTAL', colX.total, tableTop, { width: 80, align: 'right' });

        doc.moveTo(40, tableTop + 20).lineTo(560, tableTop + 20).stroke();

        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 30;
        let itemCount = 0;
        
        purchase.items.forEach((item, index) => {
          itemCount++;
          if (y > 600) {
            // For single page, we'll wrap text if needed
            if (itemCount > 15) break;
          }

          doc.text(String(index + 1), colX.no, y, { width: 20, align: 'center' });
          doc.text(item.productName || 'N/A', colX.item, y, { width: 120 });
          doc.text(item.sku || 'N/A', colX.sku, y, { width: 110 });
          doc.text(String(item.quantity || 0), colX.qty, y, { width: 50, align: 'center' });
          doc.text(`RM ${Number(item.purchasePrice || 0).toFixed(2)}`, colX.price, y, { width: 80, align: 'right' });
          doc.text(`RM ${Number(item.totalAmount || 0).toFixed(2)}`, colX.total, y, { width: 80, align: 'right' });
          
          y += 20;
        });

        // Totals section
        const totalsY = Math.max(y + 20, 620);
        doc.moveTo(400, totalsY).lineTo(560, totalsY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('SUB TOTAL', 400, totalsY + 15, { width: 120, align: 'right' });
        doc.text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, 490, totalsY + 15, { width: 70, align: 'right' });
        
        doc.text('TAX (0%)', 400, totalsY + 35, { width: 120, align: 'right' });
        doc.text('RM 0.00', 490, totalsY + 35, { width: 70, align: 'right' });
        
        doc.moveTo(400, totalsY + 55).lineTo(560, totalsY + 55).stroke();
        doc.fontSize(14)
           .text('GRAND TOTAL', 400, totalsY + 70, { width: 120, align: 'right' });
        doc.text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, 490, totalsY + 70, { width: 70, align: 'right' });

        // Notes section with bordered box
        const notesY = totalsY + 100;
        if (purchase.notes && purchase.notes.trim()) {
          doc.rect(40, notesY, 520, 60).stroke();
          doc.fontSize(11).font('Helvetica-Bold')
             .text('NOTES:', 50, notesY + 10);
          
          const notesLines = doc.textOfHeight(purchase.notes, 500);
          let noteY = notesY + 30;
          notesLines.slice(0, 3).forEach(line => {
            doc.font('Helvetica').fontSize(10)
               .text(line, 50, noteY);
            noteY += 12;
          });
        }

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Thank you for your business. Generated by ${company.name} Inventory System`, 
                 40, 750, { align: 'center', width: 520 })
           .text(`Invoice No: ${purchase.purchaseId} | Page 1 of 1`, 
                 40, 765, { align: 'center', width: 520 });

        doc.end();

      } catch (error) {
        reject(error);
      }
    });

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
//                    ENHANCED SINGLE SALES INVOICE PDF
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
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 40,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header with border
        doc.rect(40, 40, 520, 100).stroke();
        
        // Company info with line wrapping
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 50, 50);
        
        doc.fontSize(10).font('Helvetica');
        const addressLines = doc.textOfHeight(company.address, 300);
        let addressY = 75;
        addressLines.forEach(line => {
          doc.text(line, 50, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 50, addressY + 5);
        doc.text(`Email: ${company.email}`, 50, addressY + 20);

        // Invoice info
        doc.fontSize(18).font('Helvetica-Bold')
           .text('SALES INVOICE', 370, 50);
        
        doc.fontSize(11).font('Helvetica')
           .text(`Invoice No: ${sale.salesId}`, 370, 80, { align: 'right' })
           .text(`Date: ${formatDateUTC8(sale.salesDate)}`, { align: 'right' })
           .text('Status: PAID', { align: 'right' });

        // Customer info box
        doc.rect(40, 160, 520, 50).stroke();
        doc.fontSize(12).font('Helvetica-Bold')
           .text('CUSTOMER DETAILS:', 50, 170);
        
        doc.font('Helvetica').fontSize(10)
           .text(`${sale.customer || 'Customer'}`, 50, 190);
        
        if (sale.customerContact) {
          doc.text(`Contact: ${sale.customerContact}`, 50, 205);
        }

        const tableTop = 230;
        const colX = { 
          no: 40, 
          item: 70, 
          sku: 200, 
          qty: 320, 
          price: 380, 
          total: 470 
        };
        
        doc.fontSize(11).font('Helvetica-Bold')
           .text('NO', colX.no, tableTop)
           .text('PRODUCT', colX.item, tableTop)
           .text('SKU', colX.sku, tableTop)
           .text('QTY', colX.qty, tableTop)
           .text('PRICE', colX.price, tableTop, { width: 80, align: 'right' })
           .text('TOTAL', colX.total, tableTop, { width: 80, align: 'right' });

        doc.moveTo(40, tableTop + 20).lineTo(560, tableTop + 20).stroke();

        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 30;
        let itemCount = 0;
        
        sale.items.forEach((item, index) => {
          itemCount++;
          if (y > 600) {
            if (itemCount > 15) break;
          }

          doc.text(String(index + 1), colX.no, y, { width: 20, align: 'center' });
          doc.text(item.productName || 'N/A', colX.item, y, { width: 120 });
          doc.text(item.sku || 'N/A', colX.sku, y, { width: 110 });
          doc.text(String(item.quantity || 0), colX.qty, y, { width: 50, align: 'center' });
          doc.text(`RM ${Number(item.salePrice || 0).toFixed(2)}`, colX.price, y, { width: 80, align: 'right' });
          doc.text(`RM ${Number(item.totalAmount || 0).toFixed(2)}`, colX.total, y, { width: 80, align: 'right' });
          
          y += 20;
        });

        // Totals section
        const totalsY = Math.max(y + 20, 620);
        doc.moveTo(400, totalsY).lineTo(560, totalsY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('SUB TOTAL', 400, totalsY + 15, { width: 120, align: 'right' });
        doc.text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, 490, totalsY + 15, { width: 70, align: 'right' });
        
        doc.text('TAX (0%)', 400, totalsY + 35, { width: 120, align: 'right' });
        doc.text('RM 0.00', 490, totalsY + 35, { width: 70, align: 'right' });
        
        doc.moveTo(400, totalsY + 55).lineTo(560, totalsY + 55).stroke();
        doc.fontSize(14)
           .text('GRAND TOTAL', 400, totalsY + 70, { width: 120, align: 'right' });
        doc.text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, 490, totalsY + 70, { width: 70, align: 'right' });

        // Notes section with bordered box
        const notesY = totalsY + 100;
        if (sale.notes && sale.notes.trim()) {
          doc.rect(40, notesY, 520, 60).stroke();
          doc.fontSize(11).font('Helvetica-Bold')
             .text('NOTES:', 50, notesY + 10);
          
          const notesLines = doc.textOfHeight(sale.notes, 500);
          let noteY = notesY + 30;
          notesLines.slice(0, 3).forEach(line => {
            doc.font('Helvetica').fontSize(10)
               .text(line, 50, noteY);
            noteY += 12;
          });
        }

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Thank you for your business. Generated by ${company.name} Inventory System`, 
                 40, 750, { align: 'center', width: 520 })
           .text(`Invoice No: ${sale.salesId} | Page 1 of 1`, 
                 40, 765, { align: 'center', width: 520 });

        doc.end();

      } catch (error) {
        reject(error);
      }
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Sales Invoice Generation Error:", err);
    res.status(500).json({ message: "Sales invoice generation failed: " + err.message });
  }
});

// ============================================================================
//                    SAVE PURCHASE INVOICE TO DOCUMENTS
// ============================================================================
app.post("/api/purchases/save-invoice/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const company = await getCompanyInfo();
    const username = req.headers["x-username"] || "System";

    const filename = `Purchase_Invoice_${purchase.purchaseId}.pdf`;
    
    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 40,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header with border
        doc.rect(40, 40, 520, 100).stroke();
        
        // Company info with line wrapping
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 50, 50);
        
        doc.fontSize(10).font('Helvetica');
        const addressLines = doc.textOfHeight(company.address, 300);
        let addressY = 75;
        addressLines.forEach(line => {
          doc.text(line, 50, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 50, addressY + 5);
        doc.text(`Email: ${company.email}`, 50, addressY + 20);

        // Invoice info
        doc.fontSize(18).font('Helvetica-Bold')
           .text('PURCHASE INVOICE', 370, 50);
        
        doc.fontSize(11).font('Helvetica')
           .text(`Invoice No: ${purchase.purchaseId}`, 370, 80, { align: 'right' })
           .text(`Date: ${formatDateUTC8(purchase.purchaseDate)}`, { align: 'right' })
           .text('Status: PAID', { align: 'right' });

        // Supplier info box
        doc.rect(40, 160, 520, 50).stroke();
        doc.fontSize(12).font('Helvetica-Bold')
           .text('SUPPLIER DETAILS:', 50, 170);
        
        doc.font('Helvetica').fontSize(10)
           .text(`${purchase.supplier || 'Supplier'}`, 50, 190);
        
        if (purchase.supplierContact) {
          doc.text(`Contact: ${purchase.supplierContact}`, 50, 205);
        }

        const tableTop = 230;
        const colX = { 
          no: 40, 
          item: 70, 
          sku: 200, 
          qty: 320, 
          price: 380, 
          total: 470 
        };
        
        doc.fontSize(11).font('Helvetica-Bold')
           .text('NO', colX.no, tableTop)
           .text('PRODUCT', colX.item, tableTop)
           .text('SKU', colX.sku, tableTop)
           .text('QTY', colX.qty, tableTop)
           .text('PRICE', colX.price, tableTop, { width: 80, align: 'right' })
           .text('TOTAL', colX.total, tableTop, { width: 80, align: 'right' });

        doc.moveTo(40, tableTop + 20).lineTo(560, tableTop + 20).stroke();

        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 30;
        let itemCount = 0;
        
        purchase.items.forEach((item, index) => {
          itemCount++;
          if (y > 600) {
            if (itemCount > 15) break;
          }

          doc.text(String(index + 1), colX.no, y, { width: 20, align: 'center' });
          doc.text(item.productName || 'N/A', colX.item, y, { width: 120 });
          doc.text(item.sku || 'N/A', colX.sku, y, { width: 110 });
          doc.text(String(item.quantity || 0), colX.qty, y, { width: 50, align: 'center' });
          doc.text(`RM ${Number(item.purchasePrice || 0).toFixed(2)}`, colX.price, y, { width: 80, align: 'right' });
          doc.text(`RM ${Number(item.totalAmount || 0).toFixed(2)}`, colX.total, y, { width: 80, align: 'right' });
          
          y += 20;
        });

        // Totals section
        const totalsY = Math.max(y + 20, 620);
        doc.moveTo(400, totalsY).lineTo(560, totalsY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('SUB TOTAL', 400, totalsY + 15, { width: 120, align: 'right' });
        doc.text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, 490, totalsY + 15, { width: 70, align: 'right' });
        
        doc.text('TAX (0%)', 400, totalsY + 35, { width: 120, align: 'right' });
        doc.text('RM 0.00', 490, totalsY + 35, { width: 70, align: 'right' });
        
        doc.moveTo(400, totalsY + 55).lineTo(560, totalsY + 55).stroke();
        doc.fontSize(14)
           .text('GRAND TOTAL', 400, totalsY + 70, { width: 120, align: 'right' });
        doc.text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, 490, totalsY + 70, { width: 70, align: 'right' });

        // Notes section with bordered box
        const notesY = totalsY + 100;
        if (purchase.notes && purchase.notes.trim()) {
          doc.rect(40, notesY, 520, 60).stroke();
          doc.fontSize(11).font('Helvetica-Bold')
             .text('NOTES:', 50, notesY + 10);
          
          const notesLines = doc.textOfHeight(purchase.notes, 500);
          let noteY = notesY + 30;
          notesLines.slice(0, 3).forEach(line => {
            doc.font('Helvetica').fontSize(10)
               .text(line, 50, noteY);
            noteY += 12;
          });
        }

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Thank you for your business. Generated by ${company.name} Inventory System`, 
                 40, 750, { align: 'center', width: 520 })
           .text(`Invoice No: ${purchase.purchaseId} | Page 1 of 1`, 
                 40, 765, { align: 'center', width: 520 });

        doc.end();

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
      tags: ['purchase-invoice', 'pdf', 'statement'],
      createdBy: username
    });

    await logActivity(username, `Saved purchase invoice: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

    const docObject = savedDoc.toObject();
    delete docObject.data;
    res.json({
      ...docObject,
      id: docObject._id.toString()
    });

  } catch (err) {
    console.error("❌ Save Purchase Invoice Error:", err);
    res.status(500).json({ message: "Failed to save purchase invoice: " + err.message });
  }
});

// ============================================================================
//                    SAVE SALES INVOICE TO DOCUMENTS
// ============================================================================
app.post("/api/sales/save-invoice/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }

    const company = await getCompanyInfo();
    const username = req.headers["x-username"] || "System";

    const filename = `Sales_Invoice_${sale.salesId}.pdf`;
    
    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ 
          size: 'A4', 
          margin: 40,
          bufferPages: true
        });
        
        const bufs = [];
        doc.on('data', (d) => bufs.push(d));
        doc.on('end', () => resolve(Buffer.concat(bufs)));

        // Header with border
        doc.rect(40, 40, 520, 100).stroke();
        
        // Company info with line wrapping
        doc.fontSize(16).font('Helvetica-Bold')
           .text(company.name, 50, 50);
        
        doc.fontSize(10).font('Helvetica');
        const addressLines = doc.textOfHeight(company.address, 300);
        let addressY = 75;
        addressLines.forEach(line => {
          doc.text(line, 50, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 50, addressY + 5);
        doc.text(`Email: ${company.email}`, 50, addressY + 20);

        // Invoice info
        doc.fontSize(18).font('Helvetica-Bold')
           .text('SALES INVOICE', 370, 50);
        
        doc.fontSize(11).font('Helvetica')
           .text(`Invoice No: ${sale.salesId}`, 370, 80, { align: 'right' })
           .text(`Date: ${formatDateUTC8(sale.salesDate)}`, { align: 'right' })
           .text('Status: PAID', { align: 'right' });

        // Customer info box
        doc.rect(40, 160, 520, 50).stroke();
        doc.fontSize(12).font('Helvetica-Bold')
           .text('CUSTOMER DETAILS:', 50, 170);
        
        doc.font('Helvetica').fontSize(10)
           .text(`${sale.customer || 'Customer'}`, 50, 190);
        
        if (sale.customerContact) {
          doc.text(`Contact: ${sale.customerContact}`, 50, 205);
        }

        const tableTop = 230;
        const colX = { 
          no: 40, 
          item: 70, 
          sku: 200, 
          qty: 320, 
          price: 380, 
          total: 470 
        };
        
        doc.fontSize(11).font('Helvetica-Bold')
           .text('NO', colX.no, tableTop)
           .text('PRODUCT', colX.item, tableTop)
           .text('SKU', colX.sku, tableTop)
           .text('QTY', colX.qty, tableTop)
           .text('PRICE', colX.price, tableTop, { width: 80, align: 'right' })
           .text('TOTAL', colX.total, tableTop, { width: 80, align: 'right' });

        doc.moveTo(40, tableTop + 20).lineTo(560, tableTop + 20).stroke();

        doc.font('Helvetica').fontSize(10);
        let y = tableTop + 30;
        let itemCount = 0;
        
        sale.items.forEach((item, index) => {
          itemCount++;
          if (y > 600) {
            if (itemCount > 15) break;
          }

          doc.text(String(index + 1), colX.no, y, { width: 20, align: 'center' });
          doc.text(item.productName || 'N/A', colX.item, y, { width: 120 });
          doc.text(item.sku || 'N/A', colX.sku, y, { width: 110 });
          doc.text(String(item.quantity || 0), colX.qty, y, { width: 50, align: 'center' });
          doc.text(`RM ${Number(item.salePrice || 0).toFixed(2)}`, colX.price, y, { width: 80, align: 'right' });
          doc.text(`RM ${Number(item.totalAmount || 0).toFixed(2)}`, colX.total, y, { width: 80, align: 'right' });
          
          y += 20;
        });

        // Totals section
        const totalsY = Math.max(y + 20, 620);
        doc.moveTo(400, totalsY).lineTo(560, totalsY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('SUB TOTAL', 400, totalsY + 15, { width: 120, align: 'right' });
        doc.text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, 490, totalsY + 15, { width: 70, align: 'right' });
        
        doc.text('TAX (0%)', 400, totalsY + 35, { width: 120, align: 'right' });
        doc.text('RM 0.00', 490, totalsY + 35, { width: 70, align: 'right' });
        
        doc.moveTo(400, totalsY + 55).lineTo(560, totalsY + 55).stroke();
        doc.fontSize(14)
           .text('GRAND TOTAL', 400, totalsY + 70, { width: 120, align: 'right' });
        doc.text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, 490, totalsY + 70, { width: 70, align: 'right' });

        // Notes section with bordered box
        const notesY = totalsY + 100;
        if (sale.notes && sale.notes.trim()) {
          doc.rect(40, notesY, 520, 60).stroke();
          doc.fontSize(11).font('Helvetica-Bold')
             .text('NOTES:', 50, notesY + 10);
          
          const notesLines = doc.textOfHeight(sale.notes, 500);
          let noteY = notesY + 30;
          notesLines.slice(0, 3).forEach(line => {
            doc.font('Helvetica').fontSize(10)
               .text(line, 50, noteY);
            noteY += 12;
          });
        }

        // Footer
        doc.fontSize(9).font('Helvetica')
           .text(`Thank you for your business. Generated by ${company.name} Inventory System`, 
                 40, 750, { align: 'center', width: 520 })
           .text(`Invoice No: ${sale.salesId} | Page 1 of 1`, 
                 40, 765, { align: 'center', width: 520 });

        doc.end();

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
      tags: ['sales-invoice', 'pdf', 'statement'],
      createdBy: username
    });

    await logActivity(username, `Saved sales invoice: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

    const docObject = savedDoc.toObject();
    delete docObject.data;
    res.json({
      ...docObject,
      id: docObject._id.toString()
    });

  } catch (err) {
    console.error("❌ Save Sales Invoice Error:", err);
    res.status(500).json({ message: "Failed to save sales invoice: " + err.message });
  }
});

// ============================================================================
//                    FOLDER MANAGEMENT
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

    await logActivity(username, `Created folder: ${name}`, req.headers['user-agent'] || 'Unknown Device');

    res.status(201).json({
      ...folder.toObject(),
      id: folder._id.toString()
    });

  } catch (err) {
    console.error("folder post error", err);
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
        
        await logActivity(username, `Uploaded document: ${fileName}`, req.headers['user-agent'] || 'Unknown Device');
        
        res.status(201).json([{ 
          ...docu.toObject(), 
          id: docu._id.toString(),
          date: formatDateTimeUTC8(docu.date)
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
      id: d._id.toString(),
      date: formatDateTimeUTC8(d.date)
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

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
      date: formatDateTimeUTC8(docu.date)
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

    await logActivity(req.headers["x-username"], `Deleted document: ${docu.name}`, req.headers['user-agent'] || 'Unknown Device');
    res.status(204).send();

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

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

    await logActivity(req.headers["x-username"] || "System", `Downloaded document: ${docu.name}`, req.headers['user-agent'] || 'Unknown Device');

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
//                    STATEMENTS - GET REPORTS BY TYPE
// ============================================================================
app.get("/api/statements/:type", async (req, res) => {
  try {
    const { type } = req.params;
    
    let query = { tags: { $in: [] } };
    
    switch (type) {
      case 'inventory-reports':
        query.tags.$in = ['inventory-report', 'pdf'];
        break;
      case 'purchase-invoices':
        query.tags.$in = ['purchase-invoice', 'purchase-report', 'pdf', 'statement'];
        break;
      case 'sales-invoices':
        query.tags.$in = ['sales-invoice', 'sales-report', 'pdf', 'statement'];
        break;
      case 'all-reports':
        query.tags.$in = ['inventory-report', 'purchase-report', 'sales-report', 'comprehensive-report', 'purchase-invoice', 'sales-invoice', 'pdf', 'statement'];
        break;
      default:
        return res.status(400).json({ message: "Invalid statement type" });
    }

    const docs = await Doc.find(query).select('-data').sort({ date: -1 }).lean();

    const result = docs.map(d => ({
      ...d,
      id: d._id.toString(),
      date: formatDateTimeUTC8(d.date)
    }));

    res.json(result);
  } catch (err) {
    console.error("Statements get error:", err);
    res.status(500).json({ message: "Server error" });
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
      device: l.device || 'Unknown Device',
      time: formatDateTimeUTC8(l.time)
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
    let totalCost = 0;
    let totalPrice = 0;
    let totalNetProfit = 0;
    let totalStock = 0;
    
    inventoryItems.forEach(item => {
      const qty = Number(item.quantity || 0);
      const cost = Number(item.unitCost || 0);
      const price = Number(item.unitPrice || 0);
      const itemCost = qty * cost;
      const itemPrice = qty * price;
      const itemNetProfit = itemPrice - itemCost;
      
      totalCost += itemCost;
      totalPrice += itemPrice;
      totalNetProfit += itemNetProfit;
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
          cost: totalCost,
          price: totalPrice,
          netProfit: totalNetProfit,
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
        recentActivity: recentLogs.map(log => ({
          ...log,
          time: formatDateTimeUTC8(log.time)
        })),
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
      await logActivity("System", "Default admin user created", 'System');
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
    
    await logActivity("System", `Server started on port ${PORT}`, 'System');
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
