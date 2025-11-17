// server/server.js  
// Online Inventory & Documents Management System — Full Combined Version  
// Includes: multer upload, XLSX/PDF binary saving, fixed downloads

const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

// ---- NEW: multer for file uploads ----
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECURITY_CODE = process.env.SECRET_SECURITY_CODE || "1234";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- MongoDB connect ----
if (!MONGODB_URI) {
  console.error("MONGODB_URI missing.");
  process.exit(1);
}

mongoose.set("strictQuery", false);
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
.catch(err => { console.error(err); process.exit(1); });

const { Schema } = mongoose;

// ---- Schemas: now all documents have "data" + "contentType" ----
const UserSchema = new Schema({
  username: String,
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

const InventorySchema = new Schema({
  sku: String,
  name: String,
  category: String,
  quantity: Number,
  unitCost: Number,
  unitPrice: Number,
  createdAt: { type: Date, default: Date.now }
});
const Inventory = mongoose.model("Inventory", InventorySchema);

// ---- DOCUMENTS now store the file buffer ----
const DocumentSchema = new Schema({
  name: String,
  size: Number,
  date: Date,
  data: Buffer,
  contentType: String
});
const Doc = mongoose.model("Doc", DocumentSchema);

const LogSchema = new Schema({
  user: String,
  action: String,
  time: Date
});
const ActivityLog = mongoose.model("ActivityLog", LogSchema);

// --- Log dedupe ---
const DUPLICATE_WINDOW_MS = 30000;
async function logActivity(user, action) {
  try {
    const last = await ActivityLog.findOne({}).sort({ time: -1 }).lean();
    const now = Date.now();

    if (last &&
      last.user === user &&
      last.action === action &&
      now - new Date(last.time).getTime() <= DUPLICATE_WINDOW_MS) return;

    await ActivityLog.create({ user, action, time: new Date() });
  } catch (err) { console.error(err); }
}

// ---- Auth ----
app.post("/api/register", async (req, res) => {
  const { username, password, securityCode } = req.body;

  if (securityCode !== SECURITY_CODE)
    return res.status(403).json({ message: "Invalid security code" });

  const exists = await User.findOne({ username });
  if (exists) return res.status(409).json({ message: "Username exists" });

  await User.create({ username, password });
  await logActivity("System", `Registered user: ${username}`);
  res.json({ success: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  await logActivity(username, "Logged in");
  res.json({ success: true, user: username });
});

// ---- Inventory CRUD ----
app.get("/api/inventory", async (req, res) => {
  const items = await Inventory.find({}).lean();
  res.json(items.map(i => ({ ...i, id: i._id })));
});

app.post("/api/inventory", async (req, res) => {
  const item = await Inventory.create(req.body);
  await logActivity(req.headers["x-username"], `Added: ${item.name}`);
  res.json({ ...item.toObject(), id: item._id });
});

app.put("/api/inventory/:id", async (req, res) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!item) return res.status(404).json({ message: "Not found" });
  await logActivity(req.headers["x-username"], `Updated: ${item.name}`);
  res.json({ ...item.toObject(), id: item._id });
});

app.delete("/api/inventory/:id", async (req, res) => {
  const item = await Inventory.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ message: "Not found" });
  await logActivity(req.headers["x-username"], `Deleted: ${item.name}`);
  res.status(204).send();
});
// ========================================================================
//                      PDF REPORT (stores binary into DB)
// ========================================================================
app.get("/api/inventory/report/pdf", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const now = new Date();

    // Malaysia time
    const printDate = new Date(now).toLocaleString("en-US", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "2-digit", second: "2-digit",
      hour12: true
    });

    const filename = `Inventory_Report_${now.toISOString().slice(0,10)}_${Date.now()}.pdf`;
    const printedBy = req.headers["x-username"] || "System";

    // collect PDF chunks
    let chunks = [];
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });
    doc.on("data", c => chunks.push(c));

    doc.on("end", async () => {
      const buffer = Buffer.concat(chunks);
      await Doc.create({
        name: filename,
        size: buffer.length,
        date: new Date(),
        data: buffer,
        contentType: "application/pdf"
      });
      await logActivity(printedBy, `Generated Inventory PDF: ${filename}`);
    });

    // stream to client
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    doc.pipe(res);

    // HEADER
    doc.fontSize(22).text("L&B Company", 40, 40);
    doc.fontSize(10);
    doc.text("INVENTORY REPORT", 620, 40);
    doc.text(`Print Date: ${printDate}`, 620, 65);
    doc.text(`Printed By: ${printedBy}`, 620, 80);

    doc.moveTo(40, 120).lineTo(800, 120).stroke();

    // TABLE
    const rowH = 18;
    const col = { sku:40,name:100,cat:260,qty:340,cost:400,price:480,val:560,rev:650 };
    const w = { sku:60,name:160,cat:80,qty:60,cost:80,price:80,val:90,rev:100 };

    let y = 140;
    function header() {
      doc.font("Helvetica-Bold");
      Object.keys(col).forEach(k => doc.rect(col[k],y,w[k],rowH).stroke());
      doc.text("SKU",col.sku+3,y+4);
      doc.text("Product",col.name+3,y+4);
      doc.text("Category",col.cat+3,y+4);
      doc.text("Qty",col.qty+3,y+4);
      doc.text("Unit Cost",col.cost+3,y+4);
      doc.text("Unit Price",col.price+3,y+4);
      doc.text("Value",col.val+3,y+4);
      doc.text("Revenue",col.rev+3,y+4);
      doc.font("Helvetica");
      y += rowH;
    }
    header();

    let subtotal=0,totalVal=0,totalRev=0, count=0;
    for (const it of items) {
      if (count===10) {
        doc.addPage({ size:"A4", layout:"landscape", margin:40 });
        y=40; count=0; header();
      }
      const qty=it.quantity||0;
      const cost=it.unitCost||0;
      const price=it.unitPrice||0;
      const val=qty*cost, rev=qty*price;
      subtotal+=qty; totalVal+=val; totalRev+=rev;

      Object.keys(col).forEach(k => doc.rect(col[k],y,w[k],rowH).stroke());
      doc.text(it.sku||"",col.sku+3,y+4);
      doc.text(it.name||"",col.name+3,y+4);
      doc.text(it.category||"",col.cat+3,y+4);
      doc.text(String(qty),col.qty+3,y+4);
      doc.text(`RM ${cost.toFixed(2)}`,col.cost+3,y+4);
      doc.text(`RM ${price.toFixed(2)}`,col.price+3,y+4);
      doc.text(`RM ${val.toFixed(2)}`,col.val+3,y+4);
      doc.text(`RM ${rev.toFixed(2)}`,col.rev+3,y+4);

      y+=rowH; count++;
    }

    // TOTAL BOX
    const last = doc.bufferedPageRange().count-1;
    doc.switchToPage(last);
    let tY = y+20; if(tY>480) tY=480;
    doc.rect(560,tY,200,60).stroke();
    doc.font("Helvetica-Bold");
    doc.text(`Subtotal: ${subtotal} units`, 570,tY+8);
    doc.text(`Value: RM ${totalVal.toFixed(2)}`,570,tY+26);
    doc.text(`Revenue: RM ${totalRev.toFixed(2)}`,570,tY+44);

    // FOOTERS
    const pages = doc.bufferedPageRange();
    for(let i=0;i<pages.count;i++){
      doc.switchToPage(i);
      doc.fontSize(9).text("Generated by L&B Company System",0,doc.page.height-40,{align:"center"});
      doc.text(`Page ${i+1} of ${pages.count}`,0,doc.page.height-25,{align:"center"});
    }
    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ message:"PDF gen fail" });
  }
});

// ========================================================================
//                    XLSX REPORT (store binary into DB)
// ========================================================================
app.get("/api/inventory/report", async (req, res) => {
  try {
    const items = await Inventory.find({}).lean();
    const filename = `Inventory_Report_${new Date().toISOString().slice(0,10)}_${Date.now()}.xlsx`;

    const rows = [
      ["L&B Company - Inventory Report"],
      ["Date:", new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kuala_Lumpur"})],
      [],
      ["SKU","Name","Category","Qty","Unit Cost","Unit Price","Value","Revenue"]
    ];

    let totalVal=0,totalRev=0;
    items.forEach(it=>{
      const qty=it.quantity||0;
      const uc=it.unitCost||0;
      const up=it.unitPrice||0;
      const v=qty*uc, r=qty*up;
      totalVal+=v; totalRev+=r;
      rows.push([it.sku,it.name,it.category,qty,uc.toFixed(2),up.toFixed(2),v.toFixed(2),r.toFixed(2)]);
    });

    rows.push([]);
    rows.push(["","","","Totals","","",totalVal.toFixed(2),totalRev.toFixed(2)]);

    const ws=xlsx.utils.aoa_to_sheet(rows);
    const wb=xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb,ws,"Report");
    const buf=xlsx.write(wb,{type:"buffer",bookType:"xlsx"});

    await Doc.create({
      name: filename,
      size: buf.length,
      date: new Date(),
      data: buf,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    await logActivity(req.headers["x-username"],`Generated XLSX: ${filename}`);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message:"XLSX gen fail" });
  }
});
// ========================================================================
//              DOCUMENT UPLOAD (multer memory storage)
// ========================================================================
app.post("/api/documents", upload.single('file'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message:"Upload requires field: file" });

    const name = req.body.name || req.file.originalname;
    const buffer = req.file.buffer;
    const type = req.file.mimetype;

    const docu = await Doc.create({
      name,
      size: buffer.length,
      date: new Date(),
      data: buffer,
      contentType: type
    });

    await logActivity(req.headers["x-username"],`Uploaded: ${name}`);

    res.status(201).json({ ...docu.toObject(), id: docu._id });

  } catch (err) {
    console.error("Upload err:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ========================================================================
//                    DOCUMENT DOWNLOAD (serves binary)
// ========================================================================
app.get("/api/documents/download/:filename", async (req, res) => {
  try {
    const fname = req.params.filename;
    const docu = await Doc.findOne({ name: fname });

    if (!docu) return res.status(404).json({ message:"Not found" });
    if (!docu.data) return res.status(404).json({ message:"File has no data" });

    res.setHeader("Content-Disposition",`attachment; filename="${docu.name}"`);
    res.setHeader("Content-Type", docu.contentType || "application/octet-stream");

    res.send(docu.data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message:"Download error" });
  }
});

// ========================================================================
//                           DOCUMENT LIST
// ========================================================================
app.get("/api/documents", async (req, res) => {
  const docs = await Doc.find({}).sort({date:-1}).lean();
  res.json(docs.map(d => ({...d, id:d._id, sizeBytes:d.size||0 })));
});

// ========================================================================
//                           DOCUMENT DELETE
// ========================================================================
app.delete("/api/documents/:id", async (req,res)=>{
  const docu = await Doc.findByIdAndDelete(req.params.id);
  if (!docu) return res.status(404).json({ message:"Not found" });
  await logActivity(req.headers["x-username"],`Deleted: ${docu.name}`);
  res.status(204).send();
});

// ========================================================================
//                            ACTIVITY LOGS
// ========================================================================
app.get("/api/logs", async (req, res) => {
  const logs = await ActivityLog.find({}).sort({ time:-1 }).lean();
  res.json(logs.map(l => ({
    user:l.user,
    action:l.action,
    time:l.time? new Date(l.time).toISOString() : null
  })));
});

// ========================================================================
//                            FRONTEND + START
// ========================================================================
app.use(express.static(path.join(__dirname,"../public")));

app.get("*",(req,res)=>{
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ message:"API route not found" });
  res.sendFile(path.join(__dirname,"../public/index.html"));
});

async function bootstrap() {
  const n = await User.countDocuments();
  if (!n) await User.create({username:"admin",password:"password"});
  await logActivity("System","Server started");
}

bootstrap().then(()=>{
  app.listen(PORT,()=>console.log("Server running on",PORT));
});
