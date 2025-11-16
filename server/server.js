// server/server.js
// Online Inventory & Documents System – FINAL VERSION (PDF Invoice Style)

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

// =============== MIDDLEWARE ===============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============== MONGODB CONNECT ===============
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI missing in environment!");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => { console.error("❌ Mongo error:", err); process.exit(1); });

const { Schema } = mongoose;

// =============== MODELS ===============
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
  date: { type: Date, default: Date.now }
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// =============== LOG ACTIVITY (SAFE) ===============
const DUPLICATE_WINDOW_MS = 30 * 1000;

async function logActivity(user, action) {
  try {
    const safeUser = (user || "Unknown") + "";
    const safeAction = (action || "") + "";
    const now = Date.now();

    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    if (last) {
      const lastTime = new Date(last.time).getTime();
      if (
        last.user === safeUser &&
        last.action === safeAction &&
        now - lastTime <= DUPLICATE_WINDOW_MS
      ) {
        return;
      }
    }
    await ActivityLog.create({ user: safeUser, action: safeAction, time: new Date() });
  } catch (err) {
    console.error("logActivity error:", err);
  }
}

// =============== HEALTH CHECK ===============
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "API is running",
    time: new Date().toISOString()
  });
});

// ======================================================
//                     AUTH SYSTEM
// ======================================================
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ success: false, message: "Invalid security code" });

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing fields" });

  try {
    if (await User.findOne({ username }))
      return res.status(409).json({ success: false, message: "Username exists" });

    await User.create({ username, password });
    await logActivity("System", `New user registered: ${username}`);

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ success: false, message: "Missing fields" });

  try {
    const user = await User.findOne({ username, password }).lean();
    if (!user)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    await logActivity(username, "Logged in");
    res.json({ success: true, user: username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.put("/api/account/password", async (req, res) => {
  const { username, newPassword, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: "Invalid Admin Security Code" });

  try {
    const user = await User.findOne({ username });
    if (!user)
      return res.status(404).json({ message: "User not found" });

    user.password = newPassword;
    await user.save();
    await logActivity(username, "Changed password");

    res.json({ success: true, message: "Password updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/account", async (req, res) => {
  const { username, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: "Invalid Admin Security Code" });

  try {
    const deleted = await User.deleteOne({ username });
    if (!deleted.deletedCount)
      return res.status(404).json({ message: "User not found" });

    await logActivity("System", `Deleted user: ${username}`);
    res.json({ success: true, message: "Account deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
// ======================================================
//                 INVENTORY CRUD
// ======================================================
app.get("/api/inventory", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const normalized = items.map(i => ({ ...i, id: i._id.toString() }));
    return res.json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/inventory", async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    await logActivity(req.headers["x-username"], `Added product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.status(201).json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.put("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: "Item not found" });
    await logActivity(req.headers["x-username"], `Updated product: ${item.name}`);
    const normalized = { ...item.toObject(), id: item._id.toString() };
    return res.json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/inventory/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    await logActivity(req.headers["x-username"], `Deleted product: ${item.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ======================================================
//          INVENTORY PDF - INVOICE STYLE (1 PAGE)
// ======================================================
// Replace your existing /api/inventory/report/pdf with this improved version
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();
    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}.pdf`;

    // A4 landscape single page
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // Page metrics
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = doc.page.margins.left; // 30
    const usableW = pageW - margin * 2;

    // HEADER (compact invoice style)
    const headerTop = margin;
    doc.font("Helvetica-Bold").fontSize(18).text("L&B Company", margin, headerTop);
    doc.font("Helvetica").fontSize(9)
      .text("Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka", margin, headerTop + 22)
      .text("Phone: 01133127622", margin, headerTop + 36)
      .text("Email: lbcompany@gmail.com", margin, headerTop + 50);

    const rightX = pageW - margin - 260;
    doc.font("Helvetica-Bold").fontSize(16).text("INVENTORY REPORT", rightX, headerTop);
    doc.font("Helvetica").fontSize(9)
      .text(`Report No: REP-${Date.now()}`, rightX, headerTop + 24)
      .text(`Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, rightX, headerTop + 38)
      .text("Status: Completed", rightX, headerTop + 52);

    // Table area
    const tableTopY = headerTop + 78;              // compact header
    const tableBottomY = pageH - margin - 110;     // room for totals + footer
    const tableLeftX = margin;
    const tableWidth = usableW;
    const tableHeight = tableBottomY - tableTopY;

    // Explicit pixel column widths (sum must be <= tableWidth)
    // tweak these values if you want slightly wider name or category
    const colPixels = {
      sku: 0.12,   // % of tableWidth
      name: 0.32,
      category: 0.16,
      qty: 0.07,
      unitCost: 0.08,
      unitPrice: 0.08,
      value: 0.09,
      revenue: 0.08
    };

    // compute pixel values and x positions precisely (no rounding gaps)
    const keys = Object.keys(colPixels);
    let x = tableLeftX;
    const cols = [];
    let consumed = 0;
    keys.forEach((k, idx) => {
      const w = Math.round(colPixels[k] * tableWidth);
      consumed += w;
      cols.push({ key: k, x, w, label:
        k === 'sku' ? 'SKU' :
        k === 'name' ? 'Name' :
        k === 'category' ? 'Category' :
        k === 'qty' ? 'Qty' :
        k === 'unitCost' ? 'Unit Cost' :
        k === 'unitPrice' ? 'Unit Price' :
        k === 'value' ? 'Total Inventory Value' : 'Total Potential Revenue'
      });
      x += w;
    });
    // if rounding left a gap, extend last column
    if (consumed < tableWidth) {
      cols[cols.length - 1].w += (tableWidth - consumed);
    }

    // draw outer border
    doc.lineWidth(0.9);
    doc.strokeColor('black');
    doc.rect(tableLeftX, tableTopY, tableWidth, tableHeight).stroke();

    // draw vertical separators exactly at col boundaries
    for (let i = 1; i < cols.length; i++) {
      const vx = cols[i].x;
      doc.moveTo(vx, tableTopY).lineTo(vx, tableTopY + tableHeight).stroke();
    }

    // header row
    const headerRowH = 18;
    doc.font("Helvetica-Bold").fontSize(10);
    cols.forEach(c => {
      doc.text(c.label, c.x + 4, tableTopY + 4, { width: c.w - 8, align: "left", ellipsis: true });
    });
    // header underline
    const headerBottomY = tableTopY + headerRowH;
    doc.moveTo(tableLeftX, headerBottomY).lineTo(tableLeftX + tableWidth, headerBottomY).stroke();

    // rows: calculate row height & font scaling to always fit on single page
    const baseFont = 9.2;
    const baseRowH = 14;
    const minFont = 8;
    let fontSize = baseFont;
    let rowH = baseRowH;

    const availableRowsArea = tableTopY + tableHeight - (headerBottomY + 6) - 6; // leave 6px padding
    let maxRows = Math.floor(availableRowsArea / rowH);

    if (items.length > maxRows) {
      const scale = maxRows / items.length;
      fontSize = Math.max(minFont, Math.floor(baseFont * scale * 10) / 10);
      rowH = Math.max(11, Math.floor(baseRowH * (fontSize / baseFont)));
      maxRows = Math.floor(availableRowsArea / rowH);
      // further reduce if needed but preserve readability
      while (items.length > maxRows && rowH > 10) {
        rowH = Math.max(10, Math.floor(rowH * 0.95));
        maxRows = Math.floor(availableRowsArea / rowH);
      }
    }

    const renderCount = Math.min(items.length, Math.max(0, maxRows));
    let rowsY = headerBottomY + 4;
    doc.font("Helvetica").fontSize(fontSize);

    // Draw each row and draw a horizontal separator after it so grid lines exist
    let totalInventoryValue = 0;
    let totalPotentialRevenue = 0;
    let subtotalQty = 0;

    for (let i = 0; i < renderCount; i++) {
      const it = items[i];
      const qty = Number(it.quantity || 0);
      const uc = Number(it.unitCost || 0);
      const up = Number(it.unitPrice || 0);
      const invVal = qty * uc;
      const rev = qty * up;
      totalInventoryValue += invVal;
      totalPotentialRevenue += rev;
      subtotalQty += qty;

      // zebra background
      if (i % 2 === 1) {
        doc.save();
        doc.fillOpacity(0.12);
        doc.rect(tableLeftX + 1, rowsY - 2, tableWidth - 2, rowH).fill('#f2f2f2');
        doc.restore();
      }

      // render each cell; numeric columns right-aligned
      cols.forEach(c => {
        let text = "";
        if (c.key === "sku") text = it.sku || "";
        if (c.key === "name") text = it.name || "";
        if (c.key === "category") text = it.category || "";
        if (c.key === "qty") text = String(qty);
        if (c.key === "unitCost") text = `RM ${uc.toFixed(2)}`;
        if (c.key === "unitPrice") text = `RM ${up.toFixed(2)}`;
        if (c.key === "value") text = `RM ${invVal.toFixed(2)}`;
        if (c.key === "revenue") text = `RM ${rev.toFixed(2)}`;

        const align = ["qty","unitCost","unitPrice","value","revenue"].includes(c.key) ? "right" : "left";
        doc.text(text, c.x + 6, rowsY, { width: c.w - 12, align, ellipsis: true });
      });

      // draw horizontal separator line after the row (creates grid)
      const lineY = rowsY + rowH - 4;
      doc.moveTo(tableLeftX, lineY).lineTo(tableLeftX + tableWidth, lineY).stroke();

      rowsY += rowH;
    }

    // If omitted rows, print note left side
    const omitted = items.length - renderCount;
    if (omitted > 0) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("red");
      doc.text(`Note: ${omitted} item(s) omitted to keep single-page layout.`, tableLeftX + 6, rowsY + 6);
      doc.fillColor("black");
    }

    // Totals box bottom-right (invoice style)
    const totalsBoxW = 320;
    const totalsX = tableLeftX + tableWidth - totalsBoxW - 8;
    const totalsY = tableBottomY - 70; // fit above footer

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Subtotal (Quantity): ${subtotalQty} units`, totalsX, totalsY, { width: totalsBoxW, align: "right" });
    doc.text(`Total Inventory Value: RM ${totalInventoryValue.toFixed(2)}`, totalsX, totalsY + 18, { width: totalsBoxW, align: "right" });
    doc.text(`Total Potential Revenue: RM ${totalPotentialRevenue.toFixed(2)}`, totalsX, totalsY + 36, { width: totalsBoxW, align: "right" });

    if (omitted > 0) {
      doc.font("Helvetica").fontSize(8).fillColor("red");
      doc.text(`* ${omitted} items not printed`, totalsX, totalsY + 54, { width: totalsBoxW, align: "right" });
      doc.fillColor("black");
    }

    // Footer (moved up)
    const footerY = pageH - margin - 40;
    doc.font("Helvetica").fontSize(9).text("Thank you.", margin, footerY, { align: "center", width: usableW });
    doc.text("Generated by L&B Inventory System", margin, footerY + 12, { align: "center", width: usableW });

    doc.end();
  } catch (err) {
    console.error("PDF generate error", err);
    return res.status(500).json({ message: "PDF generation failed" });
  }
});

// ======================================================
//                     XLSX REPORT (unchanged)
// ======================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filenameBase = `Inventory_Report_${new Date().toISOString().slice(0,10)}`;
    const filename = `${filenameBase}.xlsx`;

    const dateOnly = new Date().toISOString().slice(0,10);

    const ws_data = [
      ["L&B Company - Inventory Report"],
      ["Date:", dateOnly],
      [],
      ["SKU","Name","Category","Quantity","Unit Cost","Unit Price","Total Inventory Value","Total Potential Revenue"]
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

    await Doc.create({ name: filename, size: wb_out.length, date: new Date() });
    await logActivity(req.headers["x-username"], `Generated XLSX report: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(wb_out);

  } catch (err) {
    console.error("xlsx report error", err);
    return res.status(500).json({ message: "Report generation failed" });
  }
});


// ======================================================
//                      DOCUMENTS CRUD
// ======================================================
app.get("/api/documents", async (req, res) => {
  try {
    const docs = await Doc.find({}).sort({ date: -1 }).lean();
    const normalized = docs.map(d => ({ ...d, id: d._id.toString() }));
    return res.json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/documents", async (req, res) => {
  try {
    const docItem = await Doc.create({ ...req.body, date: new Date() });
    await logActivity(req.headers["x-username"], `Uploaded document metadata: ${docItem.name}`);
    const normalized = { ...docItem.toObject(), id: docItem._id.toString() };
    return res.status(201).json(normalized);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/documents/:id", async (req, res) => {
  try {
    const docItem = await Doc.findByIdAndDelete(req.params.id);
    if (!docItem) return res.status(404).json({ message: "Document not found" });

    await logActivity(req.headers["x-username"], `Deleted document metadata: ${docItem.name}`);
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// redirect requests for actual PDFs
app.get("/api/documents/download/:filename", async (req, res) => {
  const filename = req.params.filename || "";
  if (filename.startsWith("Inventory_Report")) {
    return res.redirect("/api/inventory/report");
  }
  return res.status(404).json({ message: "File not found." });
});


// ======================================================
//                           LOGS
// ======================================================
app.get("/api/logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find({}).sort({ time: -1 }).limit(500).lean();
    const formatted = logs.map(l => ({
      user: l.user,
      action: l.action,
      time: new Date(l.time).toISOString()
    }));
    return res.json(formatted);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});


// ======================================================
//                        FRONTEND SERVE
// ======================================================
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "API route not found" });
  }
  return res.sendFile(path.join(__dirname, "../public/index.html"));
});


// ======================================================
//                DEFAULT ADMIN + SERVER START
// ======================================================
async function ensureDefaultAdminAndStartupLog() {
  try {
    const count = await User.countDocuments().exec();
    if (count === 0) {
      await User.create({ username: "admin", password: "password" });
      await logActivity("System", "Default admin user created.");
      console.log("Default admin created");
    }

    await logActivity("System", `Server running on port ${PORT}`);
  } catch (err) {
    console.error("Startup error:", err);
  }
}

(async () => {
  await ensureDefaultAdminAndStartupLog();
  app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
  });
})();

