export function backoffDelay(retry:number):number { return Math.min(1000*2**Math.max(0,retry),600000) }
export function isRetriableStatus(status:number):boolean { return status===408||status===429||status>=500 }
