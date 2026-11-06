// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import dgram from 'node:dgram';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),dir=path.join(root,'tests','runtime','outputs-'+Date.now());fs.mkdirSync(dir,{recursive:true});
async function socket(){const s=dgram.createSocket('udp4');s.bind(0,'127.0.0.1');await once(s,'listening');return s;}
const sim=await socket(),moza=await socket(),probe=await socket(),input=probe.address().port;probe.close();
const control=path.join(dir,'control.json');const set=(simhub,moza)=>fs.writeFileSync(control,JSON.stringify({simhub,moza}));set(true,false);
const bridge=spawn(process.execPath,[path.join(root,'bridge.mjs'),'--input-port',String(input),'--output-port',String(sim.address().port),'--moza-udp-port',String(moza.address().port),'--control-file',control,'--status-dir',dir,'--duration','20'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',sp=[],mp=[];bridge.stdout.on('data',b=>logs+=b);bridge.stderr.on('data',b=>logs+=b);sim.on('message',b=>sp.push(b));moza.on('message',b=>mp.push(JSON.parse(b)));
const send=dgram.createSocket('udp4');let seq=0;
const base={source:'star-citizen-dbox',schema_version:1,session_id:'a',stream_id:'b',mapping_valid:true};
function event(key,meanings=[],values=[]){return {...base,event_key:key,meanings,values,seq:++seq};}
async function push(e){await new Promise((r,j)=>send.send(Buffer.from(JSON.stringify(e)),input,'127.0.0.1',x=>x?j(x):r()));}
async function flight(){await push(event(10,[38],[1]));await push({...event(3,[4,92,38],[1,0,[0,10,0]]),acceleration_m_s2:{x:1,y:2,z:6000},velocity_m_s:{x:0,y:100,z:0},angular_velocity_rad_s:{x:0,y:0,z:0}});}
async function until(test){for(let i=0;i<100;i++){if(test())return;await delay(20);}throw Error('timeout '+logs);}
try{
 await until(()=>logs.includes('LIVE JSON'));await push(event(1,[30],['TEST']));await flight();await until(()=>sp.length>0);
 assert.equal(sp[0].readFloatLE(63),6000);assert.equal(mp.length,0);
 set(true,true);await delay(80);await flight();await until(()=>mp.some(p=>p.active));assert.equal(JSON.parse(fs.readFileSync(control)).simhub,true);
 set(false,true);await delay(120);sp=[];mp=[];await flight();await delay(80);assert.equal(sp.length,0);assert.ok(mp.some(p=>p.active));
 set(true,false);await delay(120);sp=[];mp=[];await flight();await delay(80);assert.equal(mp.length,0);assert.ok(sp.length>0);
 assert.equal(sp.at(-1).readFloatLE(63),6000,'SimHub raw peak unchanged after toggling');
 console.log('PASS: independent live outputs, late MOZA enable, shared receiver continuity, unchanged SimHub payload.');
}finally{send.close();sim.close();moza.close();bridge.kill();await once(bridge,'exit').catch(()=>{});}
