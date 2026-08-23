import {describe,expect,it} from 'vitest';import {createApp} from '../../worker/index';
describe('worker',()=>{it('health is public',async()=>{const app=createApp();const r=await app.request('/api/health',{}, {ACCESS_TOKEN:'x'} as any);expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true})})})
