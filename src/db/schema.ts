import Dexie,{type Table} from 'dexie'; import type {NoteMeta,Group} from '../../shared/types'; import type {OutboxTask} from '../../shared/outbox';
export interface LocalNote extends NoteMeta {body:string;body_version:number;dirty:'none'|'body'|'prop'|'both'}
export interface MetaRow {key:string;value:any}
export class SnotesDB extends Dexie {notes!:Table<LocalNote,string>;groups!:Table<Group,string>;outbox!:Table<OutboxTask,number>;meta!:Table<MetaRow,string>; constructor(){super('snotes');this.version(1).stores({notes:'id,update_time,group_id,invalid,star,top',groups:'group_id,update_time,invalid',outbox:'++id,note_id,kind,next_at,failed',meta:'key'})}}
export const db=new SnotesDB()
