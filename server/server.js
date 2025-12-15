// server/server.js
// MongoDB (Mongoose) based server for Online Inventory & Documents Management System

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

// ===== Counter for invoice numbers =====
let invoiceCounter = {
  inventory: 0,
  purchase: 0,
  sales: 0
};

// Initialize counters from database
async function initializeCounters() {
  try {
    const purchases = await Purchase.countDocuments({});
    const sales = await Sales.countDocuments({});
    const inventoryReports = await Doc.countDocuments({ tags: 'inventory-report' });
    
    invoiceCounter.purchase = purchases;
    invoiceCounter.sales = sales;
    invoiceCounter.inventory = inventoryReports;
  } catch (err) {
    console.error("Counter initialization error:", err);
  }
}

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
  // Convert to UTC+8
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  const day = utc8Time.getDate().toString().padStart(2, '0');
  const month = (utc8Time.getMonth() + 1).toString().padStart(2, '0');
  const year = utc8Time.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimeUTC8(date) {
  if (!date) return '';
  const d = new Date(date);
  // Convert to UTC+8
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  const day = utc8Time.getDate().toString().padStart(2, '0');
  const month = (utc8Time.getMonth() + 1).toString().padStart(2, '0');
  const year = utc8Time.getFullYear();
  
  let hours = utc8Time.getHours();
  const minutes = utc8Time.getMinutes().toString().padStart(2, '0');
  const seconds = utc8Time.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const strHours = hours.toString().padStart(2, '0');
  
  return `${day}/${month}/${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
}

function formatDateForDisplay(date) {
  if (!date) return '';
  const d = new Date(date);
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  return utc8Time.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatTime12Hour(date) {
  if (!date) return '';
  const d = new Date(date);
  const utc8Time = new Date(d.getTime() + (8 * 60 * 60 * 1000));
  return utc8Time.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// ===== Generate invoice numbers =====
function generateInvoiceNumber(type) {
  invoiceCounter[type] = invoiceCounter[type] + 1;
  const prefix = type === 'inventory' ? 'INVR' : type === 'purchase' ? 'PUR' : 'SAL';
  const number = invoiceCounter[type].toString().padStart(9, '0');
  return `${prefix}-${number}`;
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
  supplierContact: String,
  purchaseDate: { type: Date, default: Date.now },
  notes: String,
  items: [PurchaseItemSchema],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", PurchaseSchema);

// ===== UPDATED Sales Schema with customerContact =====
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
  createdBy: String
});
const Doc = mongoose.model("Doc", DocumentSchema);

// ===== UPDATED Log Schema with device info =====
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
      createdAt: formatDateUTC8(i.createdAt) // Format date to DD/MM/YYYY
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
//                    FIXED: Small text visibility issue at bottom
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
    
    // Parse dates from DD/MM/YYYY format
    if (startDate && endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const start = parseDateDDMMYYYY(startDate);
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);

      query.createdAt = {
        $gte: start,
        $lte: end
      };
      
      console.log(`Querying items between ${start} and ${end}`);
    } else if (startDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const start = parseDateDDMMYYYY(startDate);
      query.createdAt = { $gte: start };
    } else if (endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const end = parseDateDDMMYYYY(endDate);
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
    const printDate = formatDateTimeUTC8(now); // Use UTC+8 formatted date/time
    
    const reportId = generateInvoiceNumber('inventory');
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${startDate} to ${endDate}`
      : 'All Dates';
    
    const filename = `Inventory_Report_${reportId}.pdf`;

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

        // Company info with line wrapping
        doc.fontSize(22).font("Helvetica-Bold").text(company.name, 40, 40);
        doc.fontSize(10).font("Helvetica");
        
        // Address with line wrapping
        const addressLines = splitTextIntoLines(company.address, 30);
        let addressY = 70;
        addressLines.forEach(line => {
          doc.text(line, 40, addressY);
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 40, addressY);
        doc.text(`Email: ${company.email}`, 40, addressY + 15);

        doc.font("Helvetica-Bold").fontSize(15)
           .text("INVENTORY REPORT", 620, 40);

        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 620, 63);
        doc.text(`Report ID: ${reportId}`, 620, 78);
        doc.text(`Date Range: ${dateRangeText}`, 620, 93);
        doc.text(`Printed by: ${printedBy}`, 620, 108);

        doc.moveTo(40, 130).lineTo(800, 130).stroke();

        const rowHeight = 18;
        
        // UPDATED: New column layout with NO, Date, Status
        const columns = [
          { name: "NO", x: 40, width: 30 },
          { name: "SKU", x: 70, width: 70 },
          { name: "Product Name", x: 140, width: 100 },
          { name: "Category", x: 240, width: 70 },
          { name: "Quantity", x: 310, width: 50 },
          { name: "Unit Cost", x: 360, width: 60 },
          { name: "Unit Price", x: 420, width: 60 },
          { name: "Total Cost", x: 480, width: 70 }, // Changed from "Inventory Value"
          { name: "Total Price", x: 550, width: 70 }, // Changed from "Potential Revenue"
          { name: "Date", x: 620, width: 60 },
          { name: "Status", x: 680, width: 80 }
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

        function drawTableRow(item, index) {
          const qty = Number(item.quantity || 0);
          const cost = Number(item.unitCost || 0);
          const price = Number(item.unitPrice || 0);
          const totalCost = qty * cost; // Changed from inventoryValue
          const totalPrice = qty * price; // Changed from potentialRevenue
          
          // Determine status
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
          
          doc.font("Helvetica").fontSize(8);
          doc.text(String(index + 1), columns[0].x + 3, y + 5); // NO column
          doc.text(item.sku || "", columns[1].x + 3, y + 5);
          doc.text(item.name || "", columns[2].x + 3, y + 5);
          doc.text(item.category || "", columns[3].x + 3, y + 5);
          doc.text(String(qty), columns[4].x + 3, y + 5);
          doc.text(`RM ${cost.toFixed(2)}`, columns[5].x + 3, y + 5);
          doc.text(`RM ${price.toFixed(2)}`, columns[6].x + 3, y + 5);
          doc.text(`RM ${totalCost.toFixed(2)}`, columns[7].x + 3, y + 5); // Changed from inventoryValue
          doc.text(`RM ${totalPrice.toFixed(2)}`, columns[8].x + 3, y + 5); // Changed from potentialRevenue
          doc.text(item.createdAt ? formatDateUTC8(item.createdAt) : '', columns[9].x + 3, y + 5); // Date column
          doc.text(status, columns[10].x + 3, y + 5); // Status column
          
          y += rowHeight;
          
          return {
            qty,
            totalCost,
            totalPrice
          };
        }

        drawTableHeader();
        
        let subtotalQty = 0;
        let grandTotalCost = 0; // Changed from totalValue
        let grandTotalPrice = 0; // Changed from totalRevenue
        let rowsOnPage = 0;

        for (let i = 0; i < items.length; i++) {
          if (rowsOnPage === 10) {
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
        
        // UPDATED: New summary format
        doc.rect(560, boxY, 230, 72).stroke();
        doc.font("Helvetica-Bold").fontSize(10);
        doc.text(`Total Products: ${items.length}`, 570, boxY + 10);
        doc.text(`Total Quantity: ${subtotalQty} units`, 570, boxY + 25);
        doc.text(`Total Cost: RM ${grandTotalCost.toFixed(2)}`, 570, boxY + 40); // Changed from "Total Inventory Value"
        doc.text(`Total Retail Price: RM ${grandTotalPrice.toFixed(2)}`, 570, boxY + 55); // Changed from "Total Potential Revenue"

        doc.flushPages();

        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          // FIXED: Increased font size and better positioning for footer text
          doc.fontSize(10).font("Helvetica")
             .text(`This document is not subject to Sales & Service Tax (SST).`, 
                    0, doc.page.height - 40, { align: "center" });
          doc.text(`Generated by ${company.name} Inventory System`, 
                    0, doc.page.height - 25, { align: "center" });
          doc.text(`Page ${i + 1} of ${pages.count}`, 
                    0, doc.page.height - 10, { align: "center" });
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
//                    PURCHASE REPORT WITH DATE RANGE
// ============================================================================
app.post("/api/purchases/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    let query = {};
    
    // Parse dates from DD/MM/YYYY format
    if (startDate && endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const start = parseDateDDMMYYYY(startDate);
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);

      query.purchaseDate = {
        $gte: start,
        $lte: end
      };
    } else if (startDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const start = parseDateDDMMYYYY(startDate);
      query.purchaseDate = { $gte: start };
    } else if (endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);
      query.purchaseDate = { $lte: end };
    }

    let purchases = await Purchase.find(query).sort({ purchaseDate: -1 }).lean();

    if (purchases.length === 0 && (startDate || endDate)) {
      purchases = await Purchase.find({}).sort({ purchaseDate: -1 }).lean();
    }

    const company = await getCompanyInfo();
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${startDate} to ${endDate}`
      : 'All Dates';
    
    const filename = `Purchase_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

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

        const topY = 36;
        
        doc.fontSize(14).font('Helvetica-Bold')
           .text(company.name, 36, topY);
        doc.fontSize(10).font('Helvetica')
        
        // Address with line wrapping
        const addressLines = splitTextIntoLines(company.address, 30);
        let addressY = topY + 18;
        addressLines.forEach(line => {
          doc.text(line, 36, addressY, { continued: false });
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 36, addressY);
        doc.text(`Email: ${company.email}`, 36, addressY + 12);

        const rightX = 360;
        doc.fontSize(12).font('Helvetica-Bold')
           .text('PURCHASE REPORT', rightX, topY, { align: 'right' });
        doc.fontSize(10).font('Helvetica')
           .text(`Generated: ${formatDateTimeUTC8(new Date())}`, rightX, topY + 20, { align: 'right' });
        doc.text(`By: ${printedBy}`, { align: 'right' });
        doc.text(`Date Range: ${dateRangeText}`, { align: 'right' });
        doc.text(`Total Orders: ${purchases.length}`, { align: 'right' });

        const grandTotal = purchases.reduce((sum, purchase) => sum + (purchase.totalAmount || 0), 0);
        doc.font('Helvetica-Bold')
           .text(`Grand Total: RM ${grandTotal.toFixed(2)}`, { align: 'right' });

        doc.moveDown(2);

        const tableTop = 140;
        const colX = { 
          purchaseId: 36, 
          supplier: 180, 
          items: 320, 
          amount: 420, 
          date: 500 
        };

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Purchase ID', colX.purchaseId, tableTop);
        doc.text('Supplier', colX.supplier, tableTop);
        doc.text('Items', colX.items, tableTop);
        doc.text('Amount', colX.amount, tableTop, { width: 70, align: 'right' });
        doc.text('Date', colX.date, tableTop, { width: 70, align: 'center' });

        doc.moveTo(36, tableTop + 16).lineTo(560, tableTop + 16).stroke();

        doc.font('Helvetica').fontSize(9);
        let y = tableTop + 24;
        
        purchases.forEach((purchase, index) => {
          if (y > 700) {
            doc.addPage();
            y = 60;
            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Purchase ID', colX.purchaseId, y);
            doc.text('Supplier', colX.supplier, y);
            doc.text('Items', colX.items, y);
            doc.text('Amount', colX.amount, y, { width: 70, align: 'right' });
            doc.text('Date', colX.date, y, { width: 70, align: 'center' });
            doc.moveTo(36, y + 16).lineTo(560, y + 16).stroke();
            y += 24;
            doc.font('Helvetica').fontSize(9);
          }

          if (index % 2 === 0) {
            doc.rect(36, y - 4, 524, 18)
               .fillColor('#f8f9fa')
               .fill();
          }

          doc.fillColor('#000000')
             .text(purchase.purchaseId || 'N/A', colX.purchaseId, y, { width: 140 })
             .text(purchase.supplier || 'N/A', colX.supplier, y, { width: 130 })
             .text(`${purchase.items.length} items`, colX.items, y, { width: 90, align: 'center' })
             .text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, colX.amount, y, { width: 70, align: 'right' })
             .text(formatDateUTC8(purchase.purchaseDate), colX.date, y, { width: 70, align: 'center' });

          y += 18;
        });

        const summaryY = Math.min(y + 20, 720);
        doc.moveTo(300, summaryY).lineTo(560, summaryY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('GRAND TOTAL', 400, summaryY + 12, { width: 90, align: 'right' });
        doc.text(`RM ${grandTotal.toFixed(2)}`, 500, summaryY + 12, { width: 70, align: 'right' });

        // FIXED: Increased font size for footer text
        doc.fontSize(10).font('Helvetica')
           .text(`This document is not subject to Sales & Service Tax (SST).`, 36, 750, { align: 'center', width: 520 });
        
        doc.text(`Generated by ${company.name} Inventory System`, 36, 765, { align: 'center', width: 520 });

        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(9) // Increased from 8
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
      tags: ['purchase-report', 'pdf']
    });

    console.log(`✅ Purchase PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Purchase Report PDF: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

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
//                    SALES REPORT WITH DATE RANGE
// ============================================================================
app.post("/api/sales/report/pdf", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    let query = {};
    
    // Parse dates from DD/MM/YYYY format
    if (startDate && endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const start = parseDateDDMMYYYY(startDate);
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);

      query.salesDate = {
        $gte: start,
        $lte: end
      };
    } else if (startDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const start = parseDateDDMMYYYY(startDate);
      query.salesDate = { $gte: start };
    } else if (endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);
      query.salesDate = { $lte: end };
    }

    let sales = await Sales.find(query).sort({ salesDate: -1 }).lean();

    if (sales.length === 0 && (startDate || endDate)) {
      sales = await Sales.find({}).sort({ salesDate: -1 }).lean();
    }

    const company = await getCompanyInfo();
    const printedBy = req.headers["x-username"] || "System";
    const dateRangeText = startDate && endDate 
      ? `${startDate} to ${endDate}`
      : 'All Dates';
    
    const filename = `Sales_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

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

        const topY = 36;
        
        doc.fontSize(14).font('Helvetica-Bold')
           .text(company.name, 36, topY);
        doc.fontSize(10).font('Helvetica')
        
        // Address with line wrapping
        const addressLines = splitTextIntoLines(company.address, 30);
        let addressY = topY + 18;
        addressLines.forEach(line => {
          doc.text(line, 36, addressY, { continued: false });
          addressY += 12;
        });
        
        doc.text(`Phone: ${company.phone}`, 36, addressY);
        doc.text(`Email: ${company.email}`, 36, addressY + 12);

        const rightX = 360;
        doc.fontSize(12).font('Helvetica-Bold')
           .text('SALES REPORT', rightX, topY, { align: 'right' });
        doc.fontSize(10).font('Helvetica')
           .text(`Generated: ${formatDateTimeUTC8(new Date())}`, rightX, topY + 20, { align: 'right' });
        doc.text(`By: ${printedBy}`, { align: 'right' });
        doc.text(`Date Range: ${dateRangeText}`, { align: 'right' });
        doc.text(`Total Orders: ${sales.length}`, { align: 'right' });

        const grandTotal = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        doc.font('Helvetica-Bold')
           .text(`Grand Total: RM ${grandTotal.toFixed(2)}`, { align: 'right' });

        doc.moveDown(2);

        const tableTop = 140;
        const colX = { 
          salesId: 36, 
          customer: 180, 
          items: 320, 
          amount: 420, 
          date: 500 
        };

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Sales ID', colX.salesId, tableTop);
        doc.text('Customer', colX.customer, tableTop);
        doc.text('Items', colX.items, tableTop);
        doc.text('Amount', colX.amount, tableTop, { width: 70, align: 'right' });
        doc.text('Date', colX.date, tableTop, { width: 70, align: 'center' });

        doc.moveTo(36, tableTop + 16).lineTo(560, tableTop + 16).stroke();

        doc.font('Helvetica').fontSize(9);
        let y = tableTop + 24;
        
        sales.forEach((sale, index) => {
          if (y > 700) {
            doc.addPage();
            y = 60;
            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Sales ID', colX.salesId, y);
            doc.text('Customer', colX.customer, y);
            doc.text('Items', colX.items, y);
            doc.text('Amount', colX.amount, y, { width: 70, align: 'right' });
            doc.text('Date', colX.date, y, { width: 70, align: 'center' });
            doc.moveTo(36, y + 16).lineTo(560, y + 16).stroke();
            y += 24;
            doc.font('Helvetica').fontSize(9);
          }

          if (index % 2 === 0) {
            doc.rect(36, y - 4, 524, 18)
               .fillColor('#f8f9fa')
               .fill();
          }

          doc.fillColor('#000000')
             .text(sale.salesId || 'N/A', colX.salesId, y, { width: 140 })
             .text(sale.customer || 'N/A', colX.customer, y, { width: 130 })
             .text(`${sale.items.length} items`, colX.items, y, { width: 90, align: 'center' })
             .text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, colX.amount, y, { width: 70, align: 'right' })
             .text(formatDateUTC8(sale.salesDate), colX.date, y, { width: 70, align: 'center' });

          y += 18;
        });

        const summaryY = Math.min(y + 20, 720);
        doc.moveTo(300, summaryY).lineTo(560, summaryY).stroke();
        
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('GRAND TOTAL', 400, summaryY + 12, { width: 90, align: 'right' });
        doc.text(`RM ${grandTotal.toFixed(2)}`, 500, summaryY + 12, { width: 70, align: 'right' });

        // FIXED: Increased font size for footer text
        doc.fontSize(10).font('Helvetica')
           .text(`This document is not subject to Sales & Service Tax (SST).`, 36, 750, { align: 'center', width: 520 });
        
        doc.text(`Generated by ${company.name} Inventory System`, 36, 765, { align: 'center', width: 520 });

        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(9) // Increased from 8
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
      tags: ['sales-report', 'pdf']
    });

    console.log(`✅ Sales PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Sales Report PDF: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

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
//                    GENERATE ALL REPORTS - UPDATED NAMES
// ============================================================================
app.post("/api/reports/generate-all", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const printedBy = req.headers["x-username"] || "System";
    
    console.log(`📊 Generating all reports for date range: ${startDate} to ${endDate}`);

    let inventoryQuery = {};
    let purchaseQuery = {};
    let salesQuery = {};
    
    // Parse dates from DD/MM/YYYY format
    if (startDate && endDate) {
      const parseDateDDMMYYYY = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return new Date(dateStr);
        return new Date(parts[2], parts[1] - 1, parts[0]);
      };
      
      const start = parseDateDDMMYYYY(startDate);
      const end = parseDateDDMMYYYY(endDate);
      end.setHours(23, 59, 59, 999);

      inventoryQuery.createdAt = { $gte: start, $lte: end };
      purchaseQuery.purchaseDate = { $gte: start, $lte: end };
      salesQuery.salesDate = { $gte: start, $lte: end };
    }

    let inventoryItems = await Inventory.find(inventoryQuery).lean();
    let purchases = await Purchase.find(purchaseQuery).sort({ purchaseDate: -1 }).lean();
    let sales = await Sales.find(salesQuery).sort({ salesDate: -1 }).lean();

    const company = await getCompanyInfo();
    const now = new Date();
    const dateRangeText = startDate && endDate 
      ? `${startDate} to ${endDate}`
      : 'All Dates';

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

        doc.fontSize(16).font('Helvetica-Bold')
           .text('COMPREHENSIVE BUSINESS REPORT', 36, 36, { align: 'center' });
        
        doc.fontSize(10).font('Helvetica')
           .text(`${company.name}`, 36, 70, { align: 'center' })
           .text(`${company.address} | Phone: ${company.phone} | Email: ${company.email}`, 36, 85, { align: 'center' })
           .text(`Date Range: ${dateRangeText} | Generated: ${formatDateTimeUTC8(new Date())}`, 36, 100, { align: 'center' })
           .text(`Generated by: ${printedBy}`, 36, 115, { align: 'center' });

        doc.moveDown();

        doc.fontSize(12).font('Helvetica-Bold')
           .text('EXECUTIVE SUMMARY', 36, 150);
        
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`• Inventory Items: ${inventoryItems.length}`);
        doc.text(`• Purchase Orders: ${purchases.length}`);
        doc.text(`• Sales Orders: ${sales.length}`);
        
        const purchaseTotal = purchases.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
        const salesTotal = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
        const totalCost = inventoryItems.reduce((sum, item) => {
          return sum + ((item.quantity || 0) * (item.unitCost || 0));
        }, 0);
        
        // UPDATED: Changed names
        doc.text(`• Total Purchase Amount: RM ${purchaseTotal.toFixed(2)}`);
        doc.text(`• Total Sales Amount: RM ${salesTotal.toFixed(2)}`);
        doc.text(`• Total Inventory Cost: RM ${totalCost.toFixed(2)}`); // Changed from "Total Inventory Value"
        doc.text(`• Total Net Profit: RM ${(salesTotal - purchaseTotal).toFixed(2)}`); // Changed from "Gross Profit/Loss"

        doc.moveDown();
        doc.moveTo(36, doc.y).lineTo(560, doc.y).stroke();

        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold')
           .text('INVENTORY REPORT', 36, 36);
        
        doc.fontSize(10);
        doc.text(`Total Items: ${inventoryItems.length}`, 36, 60);
        
        const invTableTop = 90;
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('SKU', 36, invTableTop);
        doc.text('Product', 100, invTableTop);
        doc.text('Category', 250, invTableTop);
        doc.text('Qty', 350, invTableTop);
        doc.text('Cost', 400, invTableTop);
        doc.text('Price', 450, invTableTop);
        doc.text('Total Cost', 500, invTableTop); // Changed from "Value"

        doc.moveTo(36, invTableTop + 8).lineTo(560, invTableTop + 8).stroke();

        doc.font('Helvetica').fontSize(8);
        let invY = invTableTop + 16;
        
        inventoryItems.slice(0, 30).forEach((item, index) => {
          if (invY > 700) {
            doc.addPage();
            invY = 36;
          }

          const totalCost = (item.quantity || 0) * (item.unitCost || 0);
          
          doc.text(item.sku || 'N/A', 36, invY, { width: 60 });
          doc.text(item.name || 'N/A', 100, invY, { width: 140 });
          doc.text(item.category || 'N/A', 250, invY, { width: 90 });
          doc.text(String(item.quantity || 0), 350, invY, { width: 40, align: 'right' });
          doc.text(`RM ${(item.unitCost || 0).toFixed(2)}`, 400, invY, { width: 40, align: 'right' });
          doc.text(`RM ${(item.unitPrice || 0).toFixed(2)}`, 450, invY, { width: 40, align: 'right' });
          doc.text(`RM ${totalCost.toFixed(2)}`, 500, invY, { width: 50, align: 'right' }); // Changed from "Value"
          
          invY += 12;
        });

        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold')
           .text('PURCHASE REPORT', 36, 36);
        
        doc.fontSize(10);
        doc.text(`Total Purchase Orders: ${purchases.length} | Total Amount: RM ${purchaseTotal.toFixed(2)}`, 36, 60);

        const purTableTop = 90;
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('Purchase ID', 36, purTableTop);
        doc.text('Supplier', 150, purTableTop);
        doc.text('Items', 300, purTableTop);
        doc.text('Amount', 400, purTableTop);
        doc.text('Date', 480, purTableTop);

        doc.moveTo(36, purTableTop + 8).lineTo(560, purTableTop + 8).stroke();

        doc.font('Helvetica').fontSize(8);
        let purY = purTableTop + 16;
        
        purchases.slice(0, 30).forEach((purchase, index) => {
          if (purY > 700) {
            doc.addPage();
            purY = 36;
          }

          doc.text(purchase.purchaseId || 'N/A', 36, purY, { width: 110 });
          doc.text(purchase.supplier || 'N/A', 150, purY, { width: 140 });
          doc.text(`${purchase.items.length} items`, 300, purY, { width: 90, align: 'center' });
          doc.text(`RM ${(purchase.totalAmount || 0).toFixed(2)}`, 400, purY, { width: 70, align: 'right' });
          doc.text(formatDateUTC8(purchase.purchaseDate), 480, purY, { width: 70, align: 'center' });
          
          purY += 12;
        });

        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold')
           .text('SALES REPORT', 36, 36);
        
        doc.fontSize(10);
        doc.text(`Total Sales Orders: ${sales.length} | Total Amount: RM ${salesTotal.toFixed(2)}`, 36, 60);

        const salesTableTop = 90;
        doc.font('Helvetica-Bold').fontSize(9);
        doc.text('Sales ID', 36, salesTableTop);
        doc.text('Customer', 150, salesTableTop);
        doc.text('Items', 300, salesTableTop);
        doc.text('Amount', 400, salesTableTop);
        doc.text('Date', 480, salesTableTop);

        doc.moveTo(36, salesTableTop + 8).lineTo(560, salesTableTop + 8).stroke();

        doc.font('Helvetica').fontSize(8);
        let salesY = salesTableTop + 16;
        
        sales.slice(0, 30).forEach((sale, index) => {
          if (salesY > 700) {
            doc.addPage();
            salesY = 36;
          }

          doc.text(sale.salesId || 'N/A', 36, salesY, { width: 110 });
          doc.text(sale.customer || 'N/A', 150, salesY, { width: 140 });
          doc.text(`${sale.items.length} items`, 300, salesY, { width: 90, align: 'center' });
          doc.text(`RM ${(sale.totalAmount || 0).toFixed(2)}`, 400, salesY, { width: 70, align: 'right' });
          doc.text(formatDateUTC8(sale.salesDate), 480, salesY, { width: 70, align: 'center' });
          
          salesY += 12;
        });

        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold')
           .text('FINAL SUMMARY', 36, 36, { align: 'center' });
        
        doc.moveDown();
        doc.fontSize(12);
        
        const summaryY = 90;
        doc.text(`Inventory Summary:`, 36, summaryY);
        doc.text(`• Total Items: ${inventoryItems.length}`, 50, summaryY + 20);
        doc.text(`• Total Inventory Cost: RM ${totalCost.toFixed(2)}`, 50, summaryY + 35); // Changed from "Total Inventory Value"
        
        doc.text(`Purchase Summary:`, 36, summaryY + 60);
        doc.text(`• Total Purchase Orders: ${purchases.length}`, 50, summaryY + 80);
        doc.text(`• Total Purchase Amount: RM ${purchaseTotal.toFixed(2)}`, 50, summaryY + 95);
        
        doc.text(`Sales Summary:`, 36, summaryY + 120);
        doc.text(`• Total Sales Orders: ${sales.length}`, 50, summaryY + 140);
        doc.text(`• Total Sales Amount: RM ${salesTotal.toFixed(2)}`, 50, summaryY + 155);
        
        doc.text(`Financial Summary:`, 36, summaryY + 180);
        doc.text(`• Total Net Profit: RM ${(salesTotal - purchaseTotal).toFixed(2)}`, 50, summaryY + 200); // Changed from "Gross Profit/Loss"
        
        if (salesTotal > purchaseTotal) {
          doc.fillColor('green').text(`• Status: PROFITABLE`, 50, summaryY + 215);
        } else {
          doc.fillColor('red').text(`• Status: LOSS`, 50, summaryY + 215);
        }
        doc.fillColor('black');

        // FIXED: Increased font size for footer text
        doc.fontSize(10).font('Helvetica')
           .text(`This document is not subject to Sales & Service Tax (SST).`, 36, 750, { align: 'center', width: 520 });
           
        doc.text(`Generated by ${company.name} Inventory System - Comprehensive Report`, 
                 36, 765, { align: 'center', width: 520 });

        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(9) // Increased from 8
             .fillColor('#666666')
             .text(`Page ${i + 1} of ${range.count} - Comprehensive Report`, 
                   36, doc.page.height - 30, { 
                     align: 'center', 
                     width: doc.page.width - 72 
                   });
        }

        doc.end();

      } catch (error) {
        reject(error);
      }
    });

    const filename = `Comprehensive_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

    console.log(`💾 Saving Comprehensive PDF to database: ${pdfBuffer.length} bytes`);

    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf",
      tags: ['comprehensive-report', 'all-reports', 'pdf']
    });

    console.log(`✅ Comprehensive PDF saved to database with ID: ${savedDoc._id}`);
    await logActivity(printedBy, `Generated Comprehensive Report PDF: ${filename}`, req.headers['user-agent'] || 'Unknown Device');

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Comprehensive Report Generation Error:", err);
    res.status(500).json({ message: "Comprehensive report generation failed: " + err.message });
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

// ===== FIXED: Purchase Details Endpoint =====
app.get("/api/purchases/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }
    
    // Include both id and _id for compatibility
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
    
    const purchaseId = generateInvoiceNumber('purchase');
    
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

app.put("/api/purchases/:id", async (req, res) => {
  try {
    const { supplier, supplierContact, purchaseDate, notes, items } = req.body;
    
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
        supplierContact: supplierContact || supplier || 'N/A',
        purchaseDate,
        notes,
        items: purchaseItems,
        totalAmount
      },
      { new: true }
    );

    await logActivity(req.headers["x-username"], `Updated purchase order: ${purchase.purchaseId}`, req.headers['user-agent'] || 'Unknown Device');

    res.json({
      ...purchase.toObject(),
      id: purchase._id.toString(),
      purchaseDate: formatDateUTC8(purchase.purchaseDate)
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
    await logActivity(req.headers["x-username"], `Deleted purchase order: ${purchase.purchaseId}`, req.headers['user-agent'] || 'Unknown Device');
    res.status(204).send();

  } catch (err) {
    console.error("purchase delete error", err);
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

// ===== FIXED: Sales Details Endpoint =====
app.get("/api/sales/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }
    
    // Include both id and _id for compatibility
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
    
    const salesId = generateInvoiceNumber('sales');
    
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

app.put("/api/sales/:id", async (req, res) => {
  try {
    const { customer, customerContact, salesDate, notes, items } = req.body;
    
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
        customerContact: customerContact || customer || 'N/A',
        salesDate,
        notes,
        items: salesItems,
        totalAmount
      },
      { new: true }
    );

    await logActivity(req.headers["x-username"], `Updated sales order: ${sale.salesId}`, req.headers['user-agent'] || 'Unknown Device');

    res.json({
      ...sale.toObject(),
      id: sale._id.toString(),
      salesDate: formatDateUTC8(sale.salesDate)
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
    await logActivity(req.headers["x-username"], `Deleted sales order: ${sale.salesId}`, req.headers['user-agent'] || 'Unknown Device');
    res.status(204).send();

  } catch (err) {
    console.error("sales delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    UPDATED: SINGLE PURCHASE INVOICE PDF WITH SINGLE PAGE
// ============================================================================
app.get("/api/purchases/invoice/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const company = await getCompanyInfo();
    const filename = `Invoice_${purchase.purchaseId}.pdf`;

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
            dateString: formatDateUTC8(purchase.purchaseDate),
            status: 'PURCHASE'
          },
          customer: {
            name: purchase.supplier || 'Supplier',
            contact: purchase.supplierContact || purchase.supplier || 'N/A'
          },
          items: purchase.items.map((item, index) => ({
            no: index + 1, // Add sequential number
            name: item.productName || 'N/A',
            sku: item.sku || 'N/A',
            qty: item.quantity || 0,
            price: item.purchasePrice || 0,
            total: item.totalAmount || 0
          })),
          totals: {
            subtotal: purchase.totalAmount || 0,
            tax: 0,
            grandTotal: purchase.totalAmount || 0
          },
          extraNotes: purchase.notes || ''
        };

        const buffer = await generateSinglePageInvoicePDFBuffer(invoiceData);
        resolve(buffer);

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
//                    SAVE PURCHASE INVOICE TO DOCUMENTS (NEW ENDPOINT)
// ============================================================================
app.post("/api/purchases/save-invoice/:id", async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const company = await getCompanyInfo();
    const username = req.headers["x-username"] || "System";

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
        dateString: formatDateUTC8(purchase.purchaseDate),
        status: 'PURCHASE'
      },
      customer: {
        name: purchase.supplier || 'Supplier',
        contact: purchase.supplierContact || purchase.supplier || 'N/A'
      },
      items: purchase.items.map((item, index) => ({
        no: index + 1, // Add sequential number
        name: item.productName || 'N/A',
        sku: item.sku || 'N/A',
        qty: item.quantity || 0,
        price: item.purchasePrice || 0,
        total: item.totalAmount || 0
      })),
      totals: {
        subtotal: purchase.totalAmount || 0,
        tax: 0,
        grandTotal: purchase.totalAmount || 0
      },
      extraNotes: purchase.notes || ''
    };

    const pdfBuffer = await generateSinglePageInvoicePDFBuffer(invoiceData);

    const filename = `Invoice_${purchase.purchaseId}.pdf`;
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
//                    UPDATED: SINGLE SALES INVOICE PDF WITH SINGLE PAGE
// ============================================================================
app.get("/api/sales/invoice/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }

    const company = await getCompanyInfo();
    const filename = `Invoice_${sale.salesId}.pdf`;

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
            dateString: formatDateUTC8(sale.salesDate),
            status: 'SALES'
          },
          customer: {
            name: sale.customer || 'Customer',
            contact: sale.customerContact || sale.customer || 'N/A'
          },
          items: sale.items.map((item, index) => ({
            no: index + 1, // Add sequential number
            name: item.productName || 'N/A',
            sku: item.sku || 'N/A',
            qty: item.quantity || 0,
            price: item.salePrice || 0,
            total: item.totalAmount || 0
          })),
          totals: {
            subtotal: sale.totalAmount || 0,
            tax: 0,
            grandTotal: sale.totalAmount || 0
          },
          extraNotes: sale.notes || ''
        };

        const buffer = await generateSinglePageInvoicePDFBuffer(invoiceData);
        resolve(buffer);

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
//                    SAVE SALES INVOICE TO DOCUMENTS (NEW ENDPOINT)
// ============================================================================
app.post("/api/sales/save-invoice/:id", async (req, res) => {
  try {
    const sale = await Sales.findById(req.params.id).lean();
    if (!sale) {
      return res.status(404).json({ message: "Sales not found" });
    }

    const company = await getCompanyInfo();
    const username = req.headers["x-username"] || "System";

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
        dateString: formatDateUTC8(sale.salesDate),
        status: 'SALES'
      },
      customer: {
        name: sale.customer || 'Customer',
        contact: sale.customerContact || sale.customer || 'N/A'
      },
      items: sale.items.map((item, index) => ({
        no: index + 1, // Add sequential number
        name: item.productName || 'N/A',
        sku: item.sku || 'N/A',
        qty: item.quantity || 0,
        price: item.salePrice || 0,
        total: item.totalAmount || 0
      })),
      totals: {
        subtotal: sale.totalAmount || 0,
        tax: 0,
        grandTotal: sale.totalAmount || 0
      },
      extraNotes: sale.notes || ''
    };

    const pdfBuffer = await generateSinglePageInvoicePDFBuffer(invoiceData);

    const filename = `Invoice_${sale.salesId}.pdf`;
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

// ===== Helper function to split text into lines =====
function splitTextIntoLines(text, maxLineLength) {
  if (!text) return [];
  
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + ' ' + word).length <= maxLineLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ===== UPDATED: Generate SINGLE PAGE PDF buffer with all improvements =====
function generateSinglePageInvoicePDFBuffer({ title = 'Invoice', companyInfo = {}, docMeta = {}, customer = {}, items = [], totals = {}, extraNotes = '' }) {
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

      const topY = 36;
      
      // Company name
      doc.fontSize(14).font('Helvetica-Bold')
         .text(companyInfo.name || 'L&B COMPANY', 36, topY);
      
      // Address with line wrapping
      doc.fontSize(10).font('Helvetica');
      const addressLines = splitTextIntoLines(companyInfo.address || 'Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 40);
      let addressY = topY + 18;
      addressLines.forEach(line => {
        doc.text(line, 36, addressY);
        addressY += 12;
      });
      
      doc.text(`Phone: ${companyInfo.phone || '01133127622'}`, 36, addressY);
      doc.text(`Email: ${companyInfo.email || 'lbcompany@gmail.com'}`, 36, addressY + 15);

      // Invoice header
      const rightX = 360;
      doc.fontSize(12).font('Helvetica-Bold')
         .text(title, rightX, topY, { align: 'right' });
      doc.fontSize(10).font('Helvetica')
         .text(`Invoice No: ${docMeta.reference || generateInvoiceNumber(title.includes('PURCHASE') ? 'purchase' : 'sales')}`, rightX, topY + 20, { align: 'right' });
      doc.text(`Date: ${docMeta.dateString || formatDateUTC8(new Date())}`, { align: 'right' });
      doc.text(`Status: ${docMeta.status || 'INVOICE'}`, { align: 'right' });

      // Customer/Supplier information
      const customerY = Math.max(addressY + 30, 120);
      doc.fontSize(10).font('Helvetica-Bold')
         .text(title.includes('PURCHASE') ? 'Supplier:' : 'Customer:', 36, customerY);
      doc.font('Helvetica')
         .text(customer.name || 'N/A', 36, customerY + 15);
      if (customer.contact) {
        doc.text(`Contact: ${customer.contact}`, 36, doc.y);
      }

      // Table header
      const tableTop = customerY + 50;
      const colX = { 
        no: 36,      // NO column
        item: 60,    // Product Name
        sku: 260, 
        qty: 360, 
        price: 420, 
        total: 500 
      };
      
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('NO', colX.no, tableTop);
      doc.text('Product Name', colX.item, tableTop);
      doc.text('SKU', colX.sku, tableTop);
      doc.text('Qty', colX.qty, tableTop);
      doc.text('Unit Price', colX.price, tableTop, { width: 70, align: 'right' });
      doc.text('Total', colX.total, tableTop, { width: 70, align: 'right' });

      doc.moveTo(36, tableTop + 16).lineTo(560, tableTop + 16).stroke();

      // Table content
      doc.font('Helvetica').fontSize(9);
      let y = tableTop + 24;
      
      // Calculate maximum items that can fit on one page
      const maxItemsPerPage = Math.floor((700 - y) / 18);
      const itemsToDisplay = items.slice(0, maxItemsPerPage);
      
      itemsToDisplay.forEach((item, index) => {
        if (y > 700) return; // Should not happen with maxItemsPerPage calculation
        
        if (index % 2 === 0) {
          doc.rect(36, y - 4, 524, 18)
             .fillColor('#f8f9fa')
             .fill();
        }

        doc.fillColor('#000000')
           .text(String(item.no || (index + 1)), colX.no, y, { width: 20, align: 'center' })
           .text(item.name || 'N/A', colX.item, y, { width: 190 })
           .text(item.sku || 'N/A', colX.sku, y, { width: 90 })
           .text(String(item.qty || 0), colX.qty, y, { width: 50, align: 'center' })
           .text(`RM ${Number(item.price || 0).toFixed(2)}`, colX.price, y, { width: 70, align: 'right' })
           .text(`RM ${Number(item.total || 0).toFixed(2)}`, colX.total, y, { width: 70, align: 'right' });
        
        y += 18;
      });

      // Notes section with box - only if there are notes
      let totalsY = y + 20;
      
      if (extraNotes && extraNotes.trim()) {
        const notesBoxHeight = 60;
        
        // Draw notes box
        doc.rect(36, totalsY, 524, notesBoxHeight).stroke();
        
        // Notes title
        doc.font('Helvetica-Bold').fontSize(10)
           .text('Notes:', 40, totalsY + 10);
        
        // Notes content with line wrapping
        doc.font('Helvetica').fontSize(9);
        const noteLines = splitTextIntoLines(extraNotes, 70);
        let noteY = totalsY + 25;
        noteLines.forEach((line, index) => {
          if (noteY < totalsY + notesBoxHeight - 10) {
            doc.text(line, 40, noteY);
            noteY += 12;
          }
        });
        
        totalsY += notesBoxHeight + 10;
      }

      // Totals section
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

      // FIXED: Increased font size for footer text
      doc.fontSize(10).font('Helvetica')
         .text(`This invoice is not subject to Sales & Service Tax (SST).`, 
               36, 750, { align: 'center', width: 520 });

      // Footer
      doc.text(`Thank you for your business. Generated by ${companyInfo.name} Inventory System`, 
               36, 765, { align: 'center', width: 520 });

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(9) // Increased from 8
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

    await logActivity(username, `Renamed folder to: ${name}`, req.headers['user-agent'] || 'Unknown Device');

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
    await logActivity(req.headers["x-username"], `Deleted folder: ${folder.name}`, req.headers['user-agent'] || 'Unknown Device');
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
        
        await logActivity(username, `Uploaded document: ${fileName}`, req.headers['user-agent'] || 'Unknown Device');
        
        res.status(201).json([{ 
          ...docu.toObject(), 
          id: docu._id.toString(),
          date: formatDateTimeUTC8(docu.date) // Format date to UTC+8
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
      date: formatDateTimeUTC8(d.date) // Format date to UTC+8
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

    await logActivity(username, `Moved document: ${docu.name} to folder`, req.headers['user-agent'] || 'Unknown Device');
    res.json({
      ...docu.toObject(),
      id: docu._id.toString(),
      date: formatDateTimeUTC8(docu.date)
    });

  } catch (err) {
    console.error("document move error", err);
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
//                               ACTIVITY LOGS
// ============================================================================
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    res.json(logs.map(l => ({
      user: l.user,
      action: l.action,
      device: l.device || 'Unknown Device',
      time: formatDateTimeUTC8(l.time) // Format to UTC+8 with 12-hour format
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                               CLEAR ACTIVITY LOGS
// ============================================================================
app.delete("/api/logs/clear", async (req, res) => {
  try {
    const result = await ActivityLog.deleteMany({});
    
    console.log(`Cleared ${result.deletedCount} activity logs`);
    await logActivity(req.headers["x-username"] || "System", "Cleared all activity logs", req.headers['user-agent'] || 'Unknown Device');
    
    res.json({ 
      success: true, 
      message: `Cleared ${result.deletedCount} activity logs`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error("Clear logs error:", err);
    res.status(500).json({ success: false, message: "Failed to clear logs" });
  }
});

// ============================================================================
//                               LOGIN HISTORY ENDPOINT
// ============================================================================
app.get("/api/logs/login-history", async (req, res) => {
  try {
    const loginLogs = await ActivityLog.find({ 
      action: 'Logged in' 
    }).sort({ time: -1 }).limit(100).lean();
    
    res.json(loginLogs.map(log => ({
      user: log.user,
      time: formatDateTimeUTC8(log.time),
      device: log.device || 'Unknown Device'
    })));
  } catch (err) {
    console.error("Login history error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                          GET ALL DATA FOR DASHBOARD - UPDATED NAMES
// ============================================================================
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const inventoryCount = await Inventory.countDocuments({});
    const purchaseCount = await Purchase.countDocuments({});
    const salesCount = await Sales.countDocuments({});
    const documentCount = await Doc.countDocuments({});
    
    const inventoryItems = await Inventory.find({}).lean();
    let totalCost = 0; // Changed from inventoryValue
    let totalPrice = 0; // Changed from inventoryRevenue
    let totalNetProfit = 0; // Changed from inventoryProfit
    let totalStock = 0;
    
    inventoryItems.forEach(item => {
      const qty = Number(item.quantity || 0);
      const cost = Number(item.unitCost || 0);
      const price = Number(item.unitPrice || 0);
      const itemCost = qty * cost; // Changed from itemValue
      const itemPrice = qty * price; // Changed from itemRevenue
      const itemNetProfit = itemPrice - itemCost; // Changed from itemProfit
      
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
          cost: totalCost, // Changed from "value"
          price: totalPrice, // Changed from "revenue"
          netProfit: totalNetProfit, // Changed from "profit"
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
//                          SEARCH ACROSS ALL DATA
// ============================================================================
app.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({
        inventory: [],
        purchases: [],
        sales: [],
        documents: []
      });
    }
    
    const searchTerm = q.toLowerCase().trim();
    
    const inventoryResults = await Inventory.find({
      $or: [
        { sku: { $regex: searchTerm, $options: 'i' } },
        { name: { $regex: searchTerm, $options: 'i' } },
        { category: { $regex: searchTerm, $options: 'i' } }
      ]
    }).limit(10).lean();
    
    const purchaseResults = await Purchase.find({
      $or: [
        { purchaseId: { $regex: searchTerm, $options: 'i' } },
        { supplier: { $regex: searchTerm, $options: 'i' } },
        { 'items.productName': { $regex: searchTerm, $options: 'i' } }
      ]
    }).limit(10).lean();
    
    const salesResults = await Sales.find({
      $or: [
        { salesId: { $regex: searchTerm, $options: 'i' } },
        { customer: { $regex: searchTerm, $options: 'i' } },
        { 'items.productName': { $regex: searchTerm, $options: 'i' } }
      ]
    }).limit(10).lean();
    
    const documentResults = await Doc.find({
      name: { $regex: searchTerm, $options: 'i' }
    }).select('-data').limit(10).lean();
    
    res.json({
      inventory: inventoryResults.map(i => ({ 
        ...i, 
        id: i._id.toString(),
        createdAt: formatDateUTC8(i.createdAt)
      })),
      purchases: purchaseResults.map(p => ({ 
        ...p, 
        id: p._id.toString(),
        purchaseDate: formatDateUTC8(p.purchaseDate)
      })),
      sales: salesResults.map(s => ({ 
        ...s, 
        id: s._id.toString(),
        salesDate: formatDateUTC8(s.salesDate)
      })),
      documents: documentResults.map(d => ({ 
        ...d, 
        id: d._id.toString(),
        date: formatDateTimeUTC8(d.date)
      }))
    });
    
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                          SYSTEM HEALTH CHECK
// ============================================================================
app.get("/api/system/health", async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    const inventoryCount = await Inventory.countDocuments({});
    const purchaseCount = await Purchase.countDocuments({});
    const salesCount = await Sales.countDocuments({});
    const documentCount = await Doc.countDocuments({});
    const userCount = await User.countDocuments({});
    
    const recentLogs = await ActivityLog.find({}).sort({ time: -1 }).limit(10).lean();
    const errorLogs = recentLogs.filter(log => log.action && log.action.toLowerCase().includes('error'));
    
    res.json({
      status: 'healthy',
      timestamp: formatDateTimeUTC8(new Date()),
      database: {
        status: dbStatus,
        collections: {
          inventory: inventoryCount,
          purchases: purchaseCount,
          sales: salesCount,
          documents: documentCount,
          users: userCount
        }
      },
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version
      },
      issues: {
        recentErrors: errorLogs.length,
        details: errorLogs.slice(0, 3).map(log => ({
          ...log,
          time: formatDateTimeUTC8(log.time)
        }))
      }
    });
    
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).json({ 
      status: 'unhealthy',
      message: "Health check failed",
      error: err.message 
    });
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
    
    await initializeCounters();
    
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
