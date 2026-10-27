import {fail,DAY,localDay} from './core.mjs';
import {budget} from './ai.mjs';
import {json} from './auth.mjs';
export async function friendsApi(request,env,user,body){
 const path=new URL(request.url).pathname,method=request.method;
 if(path==='/api/friends'&&method==='GET'){
  const rows=await env.DB.prepare(`SELECT f.*,u.id,u.friend_username,u.profile,u.avatar FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END WHERE f.user_low=? OR f.user_high=? ORDER BY f.created_at DESC`).bind(user.id,user.id,user.id).all();
  return json({friends:rows.results.map(row=>({id:row.id,username:row.friend_username,name:JSON.parse(row.profile||'{}').name||row.friend_username,avatar:row.avatar||null,status:row.accepted_at?'accepted':row.requested_by===user.id?'outgoing':'incoming'}))});
 }
 if(path==='/api/friends'&&method==='POST'){
  const input=await body(request),username=typeof input.username==='string'?input.username.trim().toLowerCase().replace(/^@/,''):'';
  if(!/^[a-z0-9-]{4,60}$/.test(username))fail('Paste your friend’s username.');
  await budget(env,`friends:${user.id}:${localDay()}`,40,Date.now()+2*DAY);
  const other=await env.DB.prepare('SELECT id FROM users WHERE friend_username=? COLLATE NOCASE OR id IN (SELECT user_id FROM friend_username_aliases WHERE alias=?)').bind(username,username).first();if(!other)fail('No account uses that username. Check it and try again.',404);if(other.id===user.id)fail('That is your username. Ask a friend for theirs.');
  const [low,high]=[user.id,other.id].sort(),now=Date.now();await env.DB.batch([
   env.DB.prepare('INSERT INTO friendships(user_low,user_high,requested_by,created_at) VALUES (?,?,?,?) ON CONFLICT(user_low,user_high) DO NOTHING').bind(low,high,user.id,now),
   env.DB.prepare("INSERT INTO friend_notifications(id,user_id,actor_id,kind,created_at) SELECT ?,?,?,'request',? WHERE EXISTS(SELECT 1 FROM friendships WHERE user_low=? AND user_high=? AND requested_by=? AND accepted_at IS NULL AND created_at=?) ON CONFLICT(user_id,actor_id,kind) DO NOTHING").bind(crypto.randomUUID(),other.id,user.id,now,low,high,user.id,now)
  ]);
  return json({ok:true});
 }
 const match=path.match(/^\/api\/friends\/([a-f0-9-]{36})(?:\/(accept))?$/);
 if(match){
  const [low,high]=[user.id,match[1]].sort();
  if(method==='POST'&&match[2]==='accept'){
   const now=Date.now(),results=await env.DB.batch([
    env.DB.prepare('UPDATE friendships SET accepted_at=COALESCE(accepted_at,?) WHERE user_low=? AND user_high=? AND requested_by<>? RETURNING requested_by').bind(now,low,high,user.id),
    env.DB.prepare("INSERT INTO friend_notifications(id,user_id,actor_id,kind,created_at) SELECT ?,requested_by,?,'accepted',? FROM friendships WHERE user_low=? AND user_high=? AND requested_by<>? AND accepted_at=? ON CONFLICT(user_id,actor_id,kind) DO UPDATE SET created_at=excluded.created_at,read_at=NULL WHERE friend_notifications.created_at<>excluded.created_at").bind(crypto.randomUUID(),user.id,now,low,high,user.id,now),
    env.DB.prepare("UPDATE friend_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND actor_id=? AND kind='request'").bind(now,user.id,match[1])
   ]);if(!results[0].results.length)fail('This friend request is not waiting for you.',404);return json({ok:true});
  }
  if(method==='DELETE'&&!match[2]){await env.DB.batch([env.DB.prepare('DELETE FROM friendships WHERE user_low=? AND user_high=?').bind(low,high),env.DB.prepare("DELETE FROM friend_notifications WHERE ((user_id=? AND actor_id=?) OR (user_id=? AND actor_id=?)) AND kind='request'").bind(user.id,match[1],match[1],user.id)]);return json({ok:true})}
 }
 fail('Not found.',404);
}
