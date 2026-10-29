import {quizJobsApi} from './jobs.mjs';
import {deliverPushOutbox} from './push.mjs';
// Each durable alarm advances one checkpoint. No browser connection is needed.
export class QuizPreparationWorker {
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 async fetch(request){
  const {id}=await request.json();if(!/^[a-f0-9-]{36}$/.test(id||''))return new Response('Invalid job',{status:400});
  await this.ctx.storage.put('jobId',id);if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+100);
  return new Response('Scheduled');
 }
 async alarm(){
  const id=await this.ctx.storage.get('jobId');if(!id)return;
  const row=await this.env.DB.prepare('SELECT * FROM quiz_jobs WHERE id=?').bind(id).first();
  if(!row||row.status!=='preparing'){await this.ctx.storage.deleteAlarm();await this.ctx.storage.deleteAll();return}
  const user=await this.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(row.user_id).first();if(!user){await this.ctx.storage.deleteAlarm();await this.ctx.storage.deleteAll();return}
  const state=JSON.parse(row.state);if(state.retryAt>Date.now()){await this.ctx.storage.setAlarm(state.retryAt);return}
  const env={...this.env,QUIZ_JOB_RUNNER:true,AI_REQUEST_TIMEOUT:180000};
  // A new alarm is saved before advancing: an interrupted call can recover its lock.
  await this.ctx.storage.setAlarm(Date.now()+310000);
  await quizJobsApi(new Request('https://quiz.internal/api/quiz-jobs/'+id+'/advance',{method:'POST'}),env,user,async()=>({}));
  const next=await this.env.DB.prepare('SELECT status,state FROM quiz_jobs WHERE id=?').bind(id).first();
  if(next?.status==='preparing')await this.ctx.storage.setAlarm(Math.max(Date.now()+100,JSON.parse(next.state).retryAt||0));
  else{await deliverPushOutbox(this.env);await this.ctx.storage.deleteAlarm();await this.ctx.storage.deleteAll()}
 }
}
