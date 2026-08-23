import type {Env,NoteMeta,Group} from '../shared/types'
export const nowMs=()=>Date.now()
export function rowToNote(r:any):NoteMeta{return {id:r.id,group_id:r.group_id,title:r.title,summary:r.summary,thumbnail:r.thumbnail,version:r.version,prop_version:r.prop_version,star:r.star,top:r.top,skin_color:r.skin_color,invalid:r.invalid,create_time:r.create_time,update_time:r.update_time}}
export async function purgeNotes(env:Env,ids:string[]){for(const id of ids){await env.DB.prepare('DELETE FROM image WHERE note_id=?').bind(id).run();await env.DB.prepare('DELETE FROM note_body WHERE note_id=?').bind(id).run();await env.DB.prepare('DELETE FROM note WHERE id=?').bind(id).run()}}
