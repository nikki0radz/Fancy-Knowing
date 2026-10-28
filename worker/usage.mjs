// Usage metadata only. Prompts, replies, API keys and message contents are never logged here.
export async function recordAIUsage(env,{data=null,model,endpoint,status,requestId}){
 if(!env.DB)return;
 const u=data?.usage,input=u?.input_tokens??u?.prompt_tokens??(endpoint==='embeddings'?u?.total_tokens:null),output=u?.output_tokens??u?.completion_tokens??(endpoint==='embeddings'&&input!==null?0:null),cached=u?.input_tokens_details?.cached_tokens??u?.prompt_tokens_details?.cached_tokens??null;
 const measured=data?.tool_usage?.web_search?.num_requests;
 const observed=data?.output?.filter(item=>item.type==='web_search_call'&&(!item.action||item.action.type==='search')).length;
 const search=Number.isInteger(measured)?measured:observed??null;
 const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 try{await env.DB.prepare('INSERT INTO ai_usage(id,user_id,feature,operation_id,model,endpoint,status,input_tokens,output_tokens,cached_tokens,search_calls,search_measured,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(requestId||crypto.randomUUID(),env.AI_USAGE_USER_ID||null,env.AI_USAGE_ACTION||'other',env.AI_USAGE_OPERATION||null,model||'unknown',endpoint,status,integer(input),integer(output),integer(cached),integer(search),Number.isInteger(measured)?1:0,Date.now()).run()}catch{console.error('AI usage metadata could not be recorded')}
}
