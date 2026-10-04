import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3137',OPENROUTER_API_KEY:''},stdio:['ignore','pipe','pipe']});
try {
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('server startup timeout')),5000);
  child.stdout.on('data',chunk=>{if(String(chunk).includes('running')){clearTimeout(timer);resolve();}});
  child.once('error',reject); child.once('exit',code=>{clearTimeout(timer);reject(new Error(`server exited ${code}`));});
 });
 const root=await fetch('http://127.0.0.1:3137'); assert.equal(root.status,200);
 const lib=await fetch('http://127.0.0.1:3137/lib/course-engine.js'); assert.ok(lib.headers.get('content-type').includes('javascript'));
 const tracker=await fetch('http://127.0.0.1:3137/lib/activity-tracker.js'); assert.equal(tracker.status,200); assert.ok((await tracker.text()).includes('processLocationSample'));
 const request={targetDistanceM:800,difficulty:'beginner',focus:'navigation',controlCount:3};
 const post=body=>fetch('http://127.0.0.1:3137/api/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const generate=body=>fetch('http://127.0.0.1:3137/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const missingKey=await post({request,course:{safe_for_real_use:true}}); assert.equal(missingKey.status,503); assert.ok((await missingKey.json()).message.includes('OPENROUTER_API_KEY'));
 const missingGenerationKey=await generate({request}); assert.equal(missingGenerationKey.status,503); assert.ok((await missingGenerationKey.json()).message.includes('OPENROUTER_API_KEY'));
 const bad=await post({request:{...request,controlCount:999},course:{safe_for_real_use:true}}); assert.equal(bad.status,400);
 const env=await fetch('http://127.0.0.1:3137/.env'); assert.equal(env.status,404);
 console.log('Passed: local HTTP assets, invalid input, explicit missing-key failure, private env not served.');
} finally { child.kill(); }
