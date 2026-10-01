// @ts-nocheck -- Node integration runner
import assert from 'node:assert/strict';
import { startHarness, DIVISIONS } from './test/harness';
import { getDb } from './db/connection';
import { formService } from './modules/forms/form.service';
const fixtureFields=Array.from({length:12},(_,i)=>({label:`Confirm field ${i}`,type:'short_text',required:true,active:true}));
const h=await startHarness({vars:{RORO_MOCK_STREAM:JSON.stringify([[{type:'tool_use',id:'form-12',name:'create_form',input:{title:'Roro 12 field regression',fields:fixtureFields},stop_reason:'tool_use'}]])}});
try {
 const db=getDb(h.d1);const constrained=Object.create(db);
 constrained.batch=queries=>{for(const query of queries)assert.ok(query.toSQL().params.length<=100,'production D1 binding limit');return db.batch(queries);};
 const meta={divisionId:DIVISIONS.a.id,userId:'u-a-admin'};
 const fields=n=>Array.from({length:n},(_,i)=>({label:`Field ${i}`,type:'short_text',required:true,active:true,sort_order:i}));
 for(const n of [12,100]) {
  const form=await formService.create(constrained,{title:`Atomic form ${n}`,fields:fields(n)},meta);
  assert.equal(form.fields.length,n);
  await formService.replaceFields(constrained,form.id,fields(100));
  assert.equal((await formService.get(db,form.id)).fields.length,100);
  console.log(`PASS create ${n} fields and replace 100 within production D1 limit`);
 }
 await h.sql("CREATE TRIGGER fail_field BEFORE INSERT ON form_fields WHEN NEW.label='FAIL_FIELD' BEGIN SELECT RAISE(ABORT,'fixture field insert failure'); END");
 await assert.rejects(()=>formService.create(constrained,{title:'Rollback parent',fields:[...fields(9),{label:'FAIL_FIELD',type:'short_text',required:true,active:true}]},meta));
 assert.equal((await h.sql("SELECT id FROM forms WHERE title='Rollback parent'")).length,0,'parent must rollback with fields');
 const existing=await formService.create(constrained,{title:'Keep fields',fields:fields(2)},meta);
 await assert.rejects(()=>formService.replaceFields(constrained,existing.id,[...fields(9),{label:'FAIL_FIELD',type:'short_text',required:true,active:true}]));
 assert.equal((await formService.get(db,existing.id)).fields.length,2,'replace rollback preserves old fields');
 console.log('PASS create and replace roll back atomically on later-chunk failure');
 for(const token of ['tok-auth-unavailable','tok-auth-network']) {
  const response=await h.req('/api/v1/admin/assistant/usage',{token});
  assert.equal(response.status,503);
 }
 assert.equal((await h.req('/api/v1/admin/assistant/usage',{token:'invalid-session'})).status,401);
 console.log('PASS auth outage returns 503; invalid session remains 401');
 const stream=await h.req('/api/v1/admin/assistant/chat/stream',{token:'tok-a-admin',method:'POST',json:{message:'Buat form dengan 12 pertanyaan'}});
 const done=stream.body.split('\n\n').filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))).find(x=>x.type==='done');
 const json={conversation_id:done.conversation_id,message_id:done.message_id};
 const confirmed=await h.req('/api/v1/admin/assistant/confirm',{token:'tok-a-admin',method:'POST',json});
 assert.equal(confirmed.status,200);
 const retry=await h.req('/api/v1/admin/assistant/confirm',{token:'tok-a-admin',method:'POST',json});
 assert.equal(retry.body.data.resource_id,confirmed.body.data.resource_id);
 const form=await formService.get(db,confirmed.body.data.resource_id);
 assert.equal(form.fields.length,12);
 assert.equal((await h.sql("SELECT id FROM forms WHERE title='Roro 12 field regression'")).length,1);
 console.log('PASS Roro 12-field confirmation and retry create exactly one complete form');
} finally {await h.dispose();}
