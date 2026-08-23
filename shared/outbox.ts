export type OutboxKind='create'|'body'|'prop'|'group'
export interface OutboxTask { id?:number; note_id:string; kind:OutboxKind; payload:any; retry:number; next_at:number; failed?:number; seq?:number }
export function mergeOutbox(old:OutboxTask|undefined, incoming:OutboxTask):OutboxTask { if(!old)return incoming; return {...old,...incoming,id:old.id,retry:0,next_at:0,failed:0,seq:(old.seq||0)+1,payload:{...old.payload,...incoming.payload}} }
