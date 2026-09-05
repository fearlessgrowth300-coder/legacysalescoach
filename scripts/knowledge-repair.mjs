// Run only with authorization to process the selected user's knowledge through
// their configured provider. Existing CLI credentials stay in memory.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const project = 'iyqwrgqyfsfqgqqhlbec';
const cli = process.env.SUPABASE_CLI || 'supabase';
const keys = JSON.parse(execFileSync(cli, ['projects','api-keys','--project-ref',project,'-o','json'], {encoding:'utf8'}));
const key = keys.find(k => k.name === 'service_role')?.api_key;
if (!key) throw new Error('No existing service-role credential available');
const url = `https://${project}.supabase.co`;
const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const owner = process.env.REPAIR_USER_ID;
if (!owner) throw new Error('REPAIR_USER_ID is required; no cross-user repair is allowed');
const mode = process.argv[2] || 'status';
async function invoke(name,body){
  const response=await fetch(`${url}/functions/v1/${name}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(160000)});
  return {http:response.status,...await response.json()};
}
if(mode==='backfill'){
  let complete=false;
  for(let batch=1;batch<=400;batch++){
    const result=await invoke('backfill-embeddings',{user_id:owner,reindex:process.argv.includes('--reindex')});
    console.log(JSON.stringify({batch,...result}));
    if(result.done){complete=true;break;}
    if(!result.success || (!result.updatedBrain&&!result.updatedChunks)) process.exit(2);
  }
  if(!complete) process.exit(3);
} else if(mode==='status') {
  for(const table of ['sales_brain','knowledge_chunks']){
    const total=await db.from(table).select('id',{count:'exact',head:true}).eq('user_id',owner);
    const missing=await db.from(table).select('id',{count:'exact',head:true}).eq('user_id',owner).is('embedding',null);
    if(total.error||missing.error) throw new Error('Could not verify indexing counts');
    console.log(JSON.stringify({table,total:total.count,missing:missing.count}));
  }
} else throw new Error('Use status or backfill');
