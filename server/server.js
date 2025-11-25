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

// ===== NEW SCHEMAS =====
const PurchaseSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
  productName: String,
  sku: String,
  quantityReceived: { type: Number, required: true },
  unitCost: { type: Number, required: true },
  supplier: String,
  date: { type: Date, default: Date.now },
  totalCost: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", PurchaseSchema);

const SaleSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
  productName: String,
  sku: String,
  quantitySold: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  customer: String,
  date: { type: Date, default: Date.now },
  totalRevenue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
const Sale = mongoose.model("Sale", SaleSchema);

const CompanySchema = new Schema({
  name: { type: String, default: "L&B Company" },
  address: { type: String, default: "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka" },
  phone: { type: String, default: "01133127622" },
  email: { type: String, default: "lbcompany@gmail.com" },
  updatedAt: { type: Date, default: Date.now }
});
const Company = mongoose.model("Company", CompanySchema);

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
//                               COMPANY INFORMATION
// ============================================================================
app.get("/api/company", async (req, res) => {
  try {
    let company = await Company.findOne({});
    if (!company) {
      company = await Company.create({});
    }
    res.json(company);
  } catch (err) {
    console.error("company get error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/company", async (req, res) => {
  try {
    const { name, address, phone, email } = req.body;
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

    await logActivity(req.headers["x-username"], "Updated company information");
    res.json({ success: true, message: "Company information updated" });
  } catch (err) {
    console.error("company update error", err);
    res.status(500).json({ message: "Server error" });
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
//                               PURCHASE MANAGEMENT
// ============================================================================
app.get("/api/purchases", async (req, res) => {
  try {
    const purchases = await Purchase.find({}).populate('productId').sort({ date: -1 }).lean();
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

// NEW: Bulk purchase endpoint
app.post("/api/purchases/bulk", async (req, res) => {
  try {
    const { purchases, supplier, date } = req.body;
    
    if (!purchases || !Array.isArray(purchases) || purchases.length === 0) {
      return res.status(400).json({ message: "No purchase items provided" });
    }

    const results = [];
    let totalOverallCost = 0;

    for (const purchaseItem of purchases) {
      const { productId, quantityReceived, unitCost } = purchaseItem;
      
      // Get product details
      const product = await Inventory.findById(productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${productId}` });
      }

      // Update inventory quantity
      product.quantity += quantityReceived;
      await product.save();

      const totalCost = quantityReceived * unitCost;
      totalOverallCost += totalCost;

      // Create purchase record
      const purchase = await Purchase.create({
        productId,
        productName: product.name,
        sku: product.sku,
        quantityReceived,
        unitCost,
        supplier,
        date: date ? new Date(date) : new Date(),
        totalCost
      });

      results.push(purchase);
    }

    await logActivity(req.headers["x-username"], `Bulk purchase: ${results.length} items from ${supplier}, Total: RM ${totalOverallCost.toFixed(2)}`);

    res.status(201).json({
      success: true,
      message: `Bulk purchase completed: ${results.length} items`,
      purchases: results.map(p => ({
        ...p.toObject(),
        id: p._id.toString()
      })),
      totalCost: totalOverallCost
    });

  } catch (err) {
    console.error("bulk purchase error", err);
    res.status(500).json({ message: "Server error during bulk purchase" });
  }
});

app.post("/api/purchases", async (req, res) => {
  try {
    const { productId, quantityReceived, unitCost, supplier, date } = req.body;
    
    // Get product details
    const product = await Inventory.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Update inventory quantity
    product.quantity += quantityReceived;
    await product.save();

    // Create purchase record
    const purchase = await Purchase.create({
      productId,
      productName: product.name,
      sku: product.sku,
      quantityReceived,
      unitCost,
      supplier,
      date: date ? new Date(date) : new Date(),
      totalCost: quantityReceived * unitCost
    });

    await logActivity(req.headers["x-username"], `Purchased: ${product.name} (Qty: ${quantityReceived})`);

    res.status(201).json({
      ...purchase.toObject(),
      id: purchase._id.toString()
    });

  } catch (err) {
    console.error("purchase post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Purchase update and delete endpoints
app.put("/api/purchases/:id", async (req, res) => {
  try {
    const { quantityReceived, unitCost, supplier, date } = req.body;
    
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ message: "Purchase record not found" });
    }

    // Calculate the difference in quantity
    const quantityDiff = quantityReceived - purchase.quantityReceived;

    // Update inventory if quantity changed
    if (quantityDiff !== 0) {
      const product = await Inventory.findById(purchase.productId);
      if (product) {
        product.quantity += quantityDiff;
        await product.save();
      }
    }

    // Update purchase record
    purchase.quantityReceived = quantityReceived;
    purchase.unitCost = unitCost;
    purchase.supplier = supplier;
    purchase.date = date ? new Date(date) : purchase.date;
    purchase.totalCost = quantityReceived * unitCost;
    await purchase.save();

    await logActivity(req.headers["x-username"], `Updated purchase: ${purchase.productName} (Qty: ${quantityReceived})`);

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
    if (!purchase) {
      return res.status(404).json({ message: "Purchase record not found" });
    }

    // Reverse inventory update
    const product = await Inventory.findById(purchase.productId);
    if (product) {
      product.quantity -= purchase.quantityReceived;
      await product.save();
    }

    await Purchase.findByIdAndDelete(req.params.id);
    await logActivity(req.headers["x-username"], `Deleted purchase: ${purchase.productName}`);

    res.status(204).send();

  } catch (err) {
    console.error("purchase delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                               SALES MANAGEMENT
// ============================================================================
app.get("/api/sales", async (req, res) => {
  try {
    const sales = await Sale.find({}).populate('productId').sort({ date: -1 }).lean();
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

// NEW: Bulk sales endpoint
app.post("/api/sales/bulk", async (req, res) => {
  try {
    const { sales, customer, date } = req.body;
    
    if (!sales || !Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ message: "No sale items provided" });
    }

    const results = [];
    let totalOverallRevenue = 0;

    // First, validate all products have sufficient stock
    for (const saleItem of sales) {
      const { productId, quantitySold } = saleItem;
      const product = await Inventory.findById(productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${productId}` });
      }
      if (product.quantity < quantitySold) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${product.name}. Available: ${product.quantity}, Requested: ${quantitySold}` 
        });
      }
    }

    // Process all sales
    for (const saleItem of sales) {
      const { productId, quantitySold, unitPrice } = saleItem;
      
      const product = await Inventory.findById(productId);
      
      // Update inventory quantity
      product.quantity -= quantitySold;
      await product.save();

      const totalRevenue = quantitySold * unitPrice;
      totalOverallRevenue += totalRevenue;

      // Create sale record
      const sale = await Sale.create({
        productId,
        productName: product.name,
        sku: product.sku,
        quantitySold,
        unitPrice,
        customer,
        date: date ? new Date(date) : new Date(),
        totalRevenue
      });

      results.push(sale);
    }

    await logActivity(req.headers["x-username"], `Bulk sale: ${results.length} items to ${customer}, Total: RM ${totalOverallRevenue.toFixed(2)}`);

    res.status(201).json({
      success: true,
      message: `Bulk sale completed: ${results.length} items`,
      sales: results.map(s => ({
        ...s.toObject(),
        id: s._id.toString()
      })),
      totalRevenue: totalOverallRevenue
    });

  } catch (err) {
    console.error("bulk sale error", err);
    res.status(500).json({ message: "Server error during bulk sale" });
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    const { productId, quantitySold, unitPrice, customer, date } = req.body;
    
    // Get product details
    const product = await Inventory.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if enough stock
    if (product.quantity < quantitySold) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    // Update inventory quantity
    product.quantity -= quantitySold;
    await product.save();

    // Create sale record
    const sale = await Sale.create({
      productId,
      productName: product.name,
      sku: product.sku,
      quantitySold,
      unitPrice,
      customer,
      date: date ? new Date(date) : new Date(),
      totalRevenue: quantitySold * unitPrice
    });

    await logActivity(req.headers["x-username"], `Sold: ${product.name} (Qty: ${quantitySold})`);

    res.status(201).json({
      ...sale.toObject(),
      id: sale._id.toString()
    });

  } catch (err) {
    console.error("sale post error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Sales update and delete endpoints
app.put("/api/sales/:id", async (req, res) => {
  try {
    const { quantitySold, unitPrice, customer, date } = req.body;
    
    const sale = await Sale.findById(req.params.id);
    if (!sale) {
      return res.status(404).json({ message: "Sale record not found" });
    }

    // Calculate the difference in quantity
    const quantityDiff = quantitySold - sale.quantitySold;

    // Update inventory if quantity changed
    if (quantityDiff !== 0) {
      const product = await Inventory.findById(sale.productId);
      if (product) {
        product.quantity -= quantityDiff; // Subtract the difference
        await product.save();
      }
    }

    // Update sale record
    sale.quantitySold = quantitySold;
    sale.unitPrice = unitPrice;
    sale.customer = customer;
    sale.date = date ? new Date(date) : sale.date;
    sale.totalRevenue = quantitySold * unitPrice;
    await sale.save();

    await logActivity(req.headers["x-username"], `Updated sale: ${sale.productName} (Qty: ${quantitySold})`);

    res.json({
      ...sale.toObject(),
      id: sale._id.toString()
    });

  } catch (err) {
    console.error("sale update error", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) {
      return res.status(404).json({ message: "Sale record not found" });
    }

    // Reverse inventory update
    const product = await Inventory.findById(sale.productId);
    if (product) {
      product.quantity += sale.quantitySold;
      await product.save();
    }

    await Sale.findByIdAndDelete(req.params.id);
    await logActivity(req.headers["x-username"], `Deleted sale: ${sale.productName}`);

    res.status(204).send();

  } catch (err) {
    console.error("sale delete error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================================
//                    INVENTORY REPORT PDF - UPDATED WITH COMPANY INFO
// ============================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const company = await Company.findOne({}) || {};

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
        doc.fontSize(22).font("Helvetica-Bold").text(company.name || "L&B Company", 40, 40);
        doc.fontSize(10).font("Helvetica");
        doc.text(company.address || "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70);
        doc.text(`Phone: ${company.phone || "01133127622"}`, 40, 85);
        doc.text(`Email: ${company.email || "lbcompany@gmail.com"}`, 40, 100);

        doc.font("Helvetica-Bold").fontSize(15)
           .text("INVENTORY REPORT", 620, 40);

        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 620, 63);
        doc.text(`Report ID: ${reportId}`, 620, 78);
        doc.text(`Status: Generated`, 620, 93);
        doc.text(`Printed by: ${printedBy}`, 620, 108);

        doc.moveTo(40, 130).lineTo(800, 130).stroke();

        const rowHeight = 18;
        
        // PERFECT COLUMN ALIGNMENT - FIXED CALCULATIONS
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
          // Draw header background and borders
          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          
          // Draw vertical lines
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          // Header text
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

          // Draw row background and borders
          doc.rect(columns[0].x, y, 740, rowHeight).stroke();
          
          // Draw vertical lines
          for (let i = 1; i < columns.length; i++) {
            doc.moveTo(columns[i].x, y)
               .lineTo(columns[i].x, y + rowHeight)
               .stroke();
          }
          
          // Data text
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

        // Draw header
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
        
        // FIXED: Better positioning for summary box
        let boxY = y + 20;
        if (boxY > 450) {
          // If we're running out of space, add a new page for summary
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
//                    PURCHASE REPORT PDF - PORTRAIT (FIXED ALIGNMENT)
// ============================================================================
app.get("/api/purchases/report/pdf", async (req, res) => {
  try {
    const purchases = await Purchase.find({}).populate('productId').sort({ date: -1 }).lean();
    const company = await Company.findOne({}) || {};

    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
    });

    const reportId = `PUR-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Purchase_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        let pdfChunks = [];
        const doc = new PDFDocument({ 
          size: "A4", 
          layout: "portrait", 
          margin: 40,
          bufferPages: true 
        });

        doc.on("data", chunk => pdfChunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(pdfChunks)));
        doc.on("error", reject);

        // Company Information - FIXED ALIGNMENT
        doc.fontSize(20).font("Helvetica-Bold")
           .text(company.name || "L&B Company", 40, 40, { width: 500, align: 'left' });
        
        doc.fontSize(10).font("Helvetica");
        doc.text(company.address || "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70, { width: 500, align: 'left' });
        doc.text(`Phone: ${company.phone || "01133127622"}`, 40, 85, { width: 500, align: 'left' });
        doc.text(`Email: ${company.email || "lbcompany@gmail.com"}`, 40, 100, { width: 500, align: 'left' });

        // Report Title and Info - RIGHT ALIGNED
        doc.font("Helvetica-Bold").fontSize(16)
           .text("PURCHASE REPORT", 0, 40, { width: 550, align: 'right' });
        
        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 0, 65, { width: 550, align: 'right' });
        doc.text(`Report ID: ${reportId}`, 0, 80, { width: 550, align: 'right' });
        doc.text(`Printed by: ${printedBy}`, 0, 95, { width: 550, align: 'right' });

        doc.moveTo(40, 120).lineTo(550, 120).stroke();

        let y = 140;
        const rowHeight = 20;
        const pageHeight = 750;

        // Table Headers with better alignment
        doc.font("Helvetica-Bold").fontSize(9);
        
        // Fixed column positions for better alignment
        const columns = [
          { name: "Date", x: 40, width: 70 },
          { name: "Product", x: 120, width: 120 },
          { name: "SKU", x: 250, width: 80 },
          { name: "Supplier", x: 340, width: 80 },
          { name: "Qty", x: 430, width: 40 },
          { name: "Unit Cost", x: 480, width: 70 },
          { name: "Total Cost", x: 560, width: 70 }
        ];

        // Draw header
        doc.rect(40, y, 520, rowHeight).stroke();
        columns.forEach(col => {
          doc.text(col.name, col.x + 3, y + 6);
          if (col.x > 40) {
            doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
          }
        });

        y += rowHeight;
        doc.font("Helvetica").fontSize(8);

        let totalQuantity = 0;
        let totalCost = 0;
        let pageNumber = 1;

        purchases.forEach((p, index) => {
          // Check if we need a new page
          if (y > pageHeight) {
            doc.addPage();
            y = 40;
            pageNumber++;
            
            // Redraw header on new page
            doc.font("Helvetica-Bold").fontSize(9);
            doc.rect(40, y, 520, rowHeight).stroke();
            columns.forEach(col => {
              doc.text(col.name, col.x + 3, y + 6);
              if (col.x > 40) {
                doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
              }
            });
            y += rowHeight;
            doc.font("Helvetica").fontSize(8);
          }

          const dateStr = new Date(p.date).toLocaleDateString();
          const productName = p.productName || "N/A";
          const supplier = p.supplier || "N/A";
          const qty = p.quantityReceived;
          const unitCost = p.unitCost;
          const total = p.totalCost;

          totalQuantity += qty;
          totalCost += total;

          // Draw row
          doc.rect(40, y, 520, rowHeight).stroke();
          
          // Date
          doc.text(dateStr, columns[0].x + 3, y + 6);
          
          // Product name with ellipsis
          doc.text(productName, columns[1].x + 3, y + 6, { 
            width: columns[1].width - 6,
            ellipsis: true 
          });
          
          // SKU
          doc.text(p.sku || "", columns[2].x + 3, y + 6);
          
          // Supplier with ellipsis
          doc.text(supplier, columns[3].x + 3, y + 6, { 
            width: columns[3].width - 6,
            ellipsis: true 
          });
          
          // Quantity
          doc.text(String(qty), columns[4].x + 3, y + 6, { width: columns[4].width - 6, align: 'right' });
          
          // Unit Cost
          doc.text(`RM ${unitCost.toFixed(2)}`, columns[5].x + 3, y + 6, { width: columns[5].width - 6, align: 'right' });
          
          // Total Cost
          doc.text(`RM ${total.toFixed(2)}`, columns[6].x + 3, y + 6, { width: columns[6].width - 6, align: 'right' });

          // Draw vertical lines
          columns.forEach((col, i) => {
            if (i > 0) {
              doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
            }
          });

          y += rowHeight;
        });

        // Summary section
        y += 10;
        if (y > pageHeight - 50) {
          doc.addPage();
          y = 40;
        }
        
        doc.moveTo(40, y).lineTo(560, y).stroke();
        y += 15;
        
        doc.font("Helvetica-Bold").fontSize(9);
        doc.text(`Total Quantity: ${totalQuantity} units`, 400, y, { width: 160, align: 'right' });
        y += 15;
        doc.text(`Total Purchase Cost: RM ${totalCost.toFixed(2)}`, 400, y, { width: 160, align: 'right' });

        // Add page numbers
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

    // Save the PDF to documents collection
    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf"
    });

    await logActivity(printedBy, `Generated Purchase Report PDF: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error("Purchase PDF error:", err);
    res.status(500).json({ message: "PDF generation failed: " + err.message });
  }
});

// ============================================================================
//                    SALES REPORT PDF - PORTRAIT (FIXED ALIGNMENT)
// ============================================================================
app.get("/api/sales/report/pdf", async (req, res) => {
  try {
    const sales = await Sale.find({}).populate('productId').sort({ date: -1 }).lean();
    const company = await Company.findOne({}) || {};

    const now = new Date();
    const printDate = new Date(now).toLocaleString('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
    });

    const reportId = `SAL-${Date.now()}`;
    const printedBy = req.headers["x-username"] || "System";
    const filename = `Sales_Report_${now.toISOString().slice(0, 10)}_${Date.now()}.pdf`;

    console.log(`💰 Generating Sales PDF report: ${filename}, Sales count: ${sales.length}`);

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        let pdfChunks = [];
        const doc = new PDFDocument({ 
          size: "A4", 
          layout: "portrait", 
          margin: 40,
          bufferPages: true 
        });

        doc.on("data", chunk => pdfChunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(pdfChunks)));
        doc.on("error", reject);

        // Company Information - FIXED ALIGNMENT
        doc.fontSize(20).font("Helvetica-Bold")
           .text(company.name || "L&B Company", 40, 40, { width: 500, align: 'left' });
        
        doc.fontSize(10).font("Helvetica");
        doc.text(company.address || "Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", 40, 70, { width: 500, align: 'left' });
        doc.text(`Phone: ${company.phone || "01133127622"}`, 40, 85, { width: 500, align: 'left' });
        doc.text(`Email: ${company.email || "lbcompany@gmail.com"}`, 40, 100, { width: 500, align: 'left' });

        // Report Title and Info - RIGHT ALIGNED
        doc.font("Helvetica-Bold").fontSize(16)
           .text("SALES REPORT", 0, 40, { width: 550, align: 'right' });
        
        doc.font("Helvetica").fontSize(10);
        doc.text(`Print Date: ${printDate}`, 0, 65, { width: 550, align: 'right' });
        doc.text(`Report ID: ${reportId}`, 0, 80, { width: 550, align: 'right' });
        doc.text(`Printed by: ${printedBy}`, 0, 95, { width: 550, align: 'right' });

        doc.moveTo(40, 120).lineTo(550, 120).stroke();

        let y = 140;
        const rowHeight = 20;
        const pageHeight = 750;

        // Table Headers with better alignment
        doc.font("Helvetica-Bold").fontSize(9);
        
        // Fixed column positions for better alignment
        const columns = [
          { name: "Date", x: 40, width: 70 },
          { name: "Product", x: 120, width: 120 },
          { name: "SKU", x: 250, width: 80 },
          { name: "Customer", x: 340, width: 80 },
          { name: "Qty", x: 430, width: 40 },
          { name: "Unit Price", x: 480, width: 70 },
          { name: "Total Revenue", x: 560, width: 70 }
        ];

        // Draw header
        doc.rect(40, y, 520, rowHeight).stroke();
        columns.forEach(col => {
          doc.text(col.name, col.x + 3, y + 6);
          if (col.x > 40) {
            doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
          }
        });

        y += rowHeight;
        doc.font("Helvetica").fontSize(8);

        let totalQuantity = 0;
        let totalRevenue = 0;
        let pageNumber = 1;

        // Handle case when there are no sales
        if (sales.length === 0) {
          doc.rect(40, y, 520, rowHeight).stroke();
          doc.text("No sales records found", 45, y + 6);
          y += rowHeight;
        } else {
          sales.forEach((s, index) => {
            // Check if we need a new page
            if (y > pageHeight) {
              doc.addPage();
              y = 40;
              pageNumber++;
              
              // Redraw header on new page
              doc.font("Helvetica-Bold").fontSize(9);
              doc.rect(40, y, 520, rowHeight).stroke();
              columns.forEach(col => {
                doc.text(col.name, col.x + 3, y + 6);
                if (col.x > 40) {
                  doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
                }
              });
              y += rowHeight;
              doc.font("Helvetica").fontSize(8);
            }

            const dateStr = new Date(s.date).toLocaleDateString();
            const productName = s.productName || "N/A";
            const customer = s.customer || "N/A";
            const qty = s.quantitySold || 0;
            const unitPrice = s.unitPrice || 0;
            const total = s.totalRevenue || 0;

            totalQuantity += qty;
            totalRevenue += total;

            // Draw row
            doc.rect(40, y, 520, rowHeight).stroke();
            
            // Date
            doc.text(dateStr, columns[0].x + 3, y + 6);
            
            // Product name with ellipsis
            doc.text(productName, columns[1].x + 3, y + 6, { 
              width: columns[1].width - 6,
              ellipsis: true 
            });
            
            // SKU
            doc.text(s.sku || "", columns[2].x + 3, y + 6);
            
            // Customer with ellipsis
            doc.text(customer, columns[3].x + 3, y + 6, { 
              width: columns[3].width - 6,
              ellipsis: true 
            });
            
            // Quantity
            doc.text(String(qty), columns[4].x + 3, y + 6, { width: columns[4].width - 6, align: 'right' });
            
            // Unit Price
            doc.text(`RM ${unitPrice.toFixed(2)}`, columns[5].x + 3, y + 6, { width: columns[5].width - 6, align: 'right' });
            
            // Total Revenue
            doc.text(`RM ${total.toFixed(2)}`, columns[6].x + 3, y + 6, { width: columns[6].width - 6, align: 'right' });

            // Draw vertical lines
            columns.forEach((col, i) => {
              if (i > 0) {
                doc.moveTo(col.x, y).lineTo(col.x, y + rowHeight).stroke();
              }
            });

            y += rowHeight;
          });
        }

        // Summary section
        y += 10;
        if (y > pageHeight - 50) {
          doc.addPage();
          y = 40;
        }
        
        doc.moveTo(40, y).lineTo(560, y).stroke();
        y += 15;
        
        doc.font("Helvetica-Bold").fontSize(9);
        doc.text(`Total Quantity Sold: ${totalQuantity} units`, 400, y, { width: 160, align: 'right' });
        y += 15;
        doc.text(`Total Sales Revenue: RM ${totalRevenue.toFixed(2)}`, 400, y, { width: 160, align: 'right' });

        // Add page numbers
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(9).text("Generated by L&B Company Inventory System", 0, doc.page.height - 40, { align: "center" });
          doc.text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 25, { align: "center" });
        }

        doc.end();
      } catch (error) {
        console.error('PDF generation error:', error);
        reject(error);
      }
    });

    // Save the PDF to documents collection
    const savedDoc = await Doc.create({
      name: filename,
      size: pdfBuffer.length,
      date: new Date(),
      data: pdfBuffer,
      contentType: "application/pdf"
    });

    await logActivity(printedBy, `Generated Sales Report PDF: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

    console.log(`✅ Sales PDF sent to browser: ${filename}`);

  } catch (err) {
    console.error("❌ Sales PDF Generation Error:", err);
    res.status(500).json({ message: "Sales PDF generation failed: " + err.message });
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
