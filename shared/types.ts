export type Dirty = 'none' | 'body' | 'prop' | 'both'
export interface NoteMeta { id:string; group_id:string|null; title:string; summary:string; thumbnail:string|null; version:number; prop_version:number; star:number; top:number; skin_color:string|null; invalid:number; create_time:number; update_time:number; body?:string; body_version?:number; dirty?:Dirty }
export interface Group { group_id:string; name:string; ord:number; color:string|null; invalid:number; update_time:number }
export interface DerivedFields { title:string; summary:string; thumbnail:string|null }
export interface PullResponse { notes: Omit<NoteMeta,'body'|'body_version'|'dirty'>[]; groups:Group[]; server_time:number; next_cursor:string|null }
export interface Body { note_id:string; content:string; version:number }
export interface Env { DB:any; IMAGES:any; ASSETS?:any; ACCESS_TOKEN:string }
