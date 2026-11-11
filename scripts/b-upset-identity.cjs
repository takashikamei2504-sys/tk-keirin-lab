'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),files={},pending=['js/b-upset/engine.cjs','js/b-upset/patterns.cjs'];
while(pending.length){
  const file=pending.pop();
  if(file==='js/b-upset/build.json'||files[file])continue;
  const code=fs.readFileSync(path.join(root,file),'utf8');
  files[file]=crypto.createHash('sha256').update(code).digest('hex');
  for(const match of code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
    let dep=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
    if(!path.extname(dep))dep+='.js';
    pending.push(dep);
  }
}
const hash=crypto.createHash('sha256').update(JSON.stringify(Object.entries(files).sort())).digest('hex');
fs.writeFileSync(path.join(root,'js/b-upset/build.json'),JSON.stringify({version:'B-UPSET-V2.0.0',model_id:'B-UPSET-V2@'+hash.slice(0,16),code_hash:hash,files})+'\n');
console.log(hash.slice(0,16));
