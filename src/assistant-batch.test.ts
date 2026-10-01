// @ts-nocheck -- integration runner
import assert from 'node:assert/strict';
import { startHarness } from './test/harness';
import { assistantService, handleToolUse } from './modules/assistant/service';
import { getDb } from './db/connection';
import { llmChatStream } from './modules/assistant/llm';
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
let timeout;
try {
 AbortSignal.timeout = ms => { timeout = ms; return originalTimeout(ms); };
 globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
 for await (const e of llmChatStream({RORO_API_KEY:'fixture'}, {system:'test',messages:[],tools:[],timeout_ms:60000})) {}
 assert.equal(timeout,60000,'active stream must not be cut at 20 seconds');
 console.log('PASS full streaming deadline');
} finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
const event = n => ({title:`Batch agenda ${n}`,starts_at:'2026-10-10T08:00:00+07:00',ends_at:'2026-10-10T09:00:00+07:00',location:'Kampus'});
const tool = (n,name='create_internal_event') => ({type:'tool_use',id:`batch-${n}`,name,input:event(n),stop_reason:'tool_use'});
const h = await startHarness({vars:{RORO_MOCK_STREAM:JSON.stringify([[tool(1),tool(2),tool(3)],[tool(4,'create_event'),tool(5,'create_event')]])}});
const root='/api/v1/admin/assistant';
const parse = res => res.body.split('\n\n').filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5))).find(x=>x.type==='done');
try {
 for (const [message,table,count] of [['Buat tiga agenda internal','internal_events',3],['Buat dua event mahasiswa','events',2]]) {
  const done=parse(await h.req(root+'/chat/stream',{token:'tok-a-admin',method:'POST',json:{message}}));
  const cards=[{id:done.message_id,proposal_json:done.proposal},...done.additional_proposals];
  assert.equal(cards.length,count);
  const rows=await h.sql('SELECT * FROM ai_messages WHERE conversation_id=? AND proposal_status=?',done.conversation_id,'pending');
  assert.equal(rows.length,count,'all drafts persisted');
  assert.equal((await h.sql(`SELECT * FROM ${table} WHERE title LIKE 'Batch agenda %'`)).length,0,'no writes before confirmation');
  const ids=[];
  for (const card of cards) {
   const json={conversation_id:done.conversation_id,message_id:card.id};
   assert.equal((await h.req(root+'/confirm',{token:'tok-b-admin',method:'POST',json})).status,404);
   const result=await h.req(root+'/confirm',{token:'tok-a-admin',method:'POST',json});
   assert.equal(result.status,200,JSON.stringify(result.body));
   ids.push(result.body.data.resource_id);
   const retry=await h.req(root+'/confirm',{token:'tok-a-admin',method:'POST',json});
   assert.equal(retry.body.data.resource_id,result.body.data.resource_id);
   await assert.rejects(() => assistantService.confirm(getDb(h.d1), {userId:'u-a-admin',divisionId:'01990001-0000-7000-8000-000000000002',permissions:[],recordAudit:async()=>{}}, {}, json), e => e.statusCode===403, 'revoked permission must deny even executed retries');
  }
  assert.equal(new Set(ids).size,count);
  const created=await h.sql(`SELECT * FROM ${table} WHERE title LIKE 'Batch agenda %'`);
  assert.equal(created.length,count);
  assert.ok(created.every(x=>x.status==='draft'));
  console.log(`PASS ${count} ${table}: persisted, scoped, individually confirmed, idempotent, draft only`);
 }
 const actor={userId:'u-a-admin',permissions:['events.create.all'],recordAudit:async()=>{}};
 const publicDraft=await handleToolUse(actor,{db:getDb(h.d1)}, {id:'mixed-public',name:'create_event',input:event('public')}, [], 'Buat seminar mahasiswa dan rapat pengurus');
 assert.equal(publicDraft?.tool,'create_event');
 const internalAsPublic=await handleToolUse(actor,{db:getDb(h.d1)}, {id:'mixed-internal',name:'create_event',input:{...event('wrong'),title:'Rapat pengurus'}}, [], 'Buat seminar mahasiswa dan rapat pengurus');
 assert.equal(internalAsPublic,null);
 console.log('PASS mixed request allows public event but refuses public meeting draft');
} finally { await h.dispose(); }
