export function encodeCursor(update_time:number,id:string):string { return btoa(JSON.stringify([update_time,id])) }
export function decodeCursor(cursor:string):[number,string]|null { try { const v=JSON.parse(atob(cursor)); return Array.isArray(v)&&typeof v[0]==='number'&&typeof v[1]==='string'?[v[0],v[1]]:null } catch{return null} }
