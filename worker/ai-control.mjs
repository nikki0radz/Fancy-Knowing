import {fail} from './core.mjs';

export function aiPaused(env){return env.AI_PAUSED===true||env.AI_PAUSED==='true'}
export function requireAI(env){
 if(aiPaused(env)){
  const error=new Error('AI features are paused while Fancy Knowing is on hold.');
  error.status=503;error.quizRetryable=false;throw error;
 }
 if(!env.OPENAI_API_KEY)fail('The AI key has not been added to Cloudflare yet.',503);
}
