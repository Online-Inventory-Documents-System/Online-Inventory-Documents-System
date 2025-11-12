// run with: node migrate-json-to-mongo.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const MONGODB_URI = process.env.MONGODB_URI;
if(!MONGODB_URI) { console.error('Set MONGODB_URI'); process.exit(1); }
mongoose.connect(MONGODB_URI).then(()=> main()).catch(err=>{console.error(err); process.exit(1)});

const User = mongoose.model('User', new mongoose.Schema({ username:String, password:String }));
const Inventory = mongoose.model('Inventory', new mongoose.Schema({}, { strict:false }));
const Doc = mongoose.model('Doc', new mongoose.Schema({}, { strict:false }));

async function main(){
  try{
    const uPath = path.join(__dirname,'users.json');
    if(fs.existsSync(uPath)){ const users = JSON.parse(fs.readFileSync(uPath,'utf8')); await User.insertMany(users); console.log('Imported users'); }
    const iPath = path.join(__dirname,'inventory.json');
    if(fs.existsSync(iPath)){ const inv = JSON.parse(fs.readFileSync(iPath,'utf8')); await Inventory.insertMany(inv); console.log('Imported inventory'); }
    const dPath = path.join(__dirname,'documents.json');
    if(fs.existsSync(dPath)){ const docs = JSON.parse(fs.readFileSync(dPath,'utf8')); await Doc.insertMany(docs); console.log('Imported docs'); }
  } catch(e){
    console.error(e);
  } finally {
    mongoose.disconnect();
  }
}
