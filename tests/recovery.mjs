// SPDX-License-Identifier: GPL-3.0-or-later
// Separate ephemeral ports. No SimHub, Cockpit, or real game processes are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import dgram from 'node:dgram';import http2 from 'node:http2';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {fileURLToPath} from 'node:url';
import {encodeMessage,frame} from '../receiver/wire.mjs';import {lockFile} from './file-lock.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),dir=path.join(root,'tests','runtime','recovery-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const processes=[],sockets=[];let unlock,client;
async function udp(){const s=dgram.createSocket('udp4');sockets.push(s);s.bind(0,'127.0.0.1');await once(s,'listening');return s;}
async function tcpPort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function child(args){const p=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.output='';p.stdout.on('data',b=>p.output+=b);p.stderr.on('data',b=>p.output+=b);p.done=once(p,'exit');processes.push(p);return p;}
async function until(fn,label,timeout=7000){const start=Date.now();while(!fn()){assert(Date.now()-start<timeout,label+'\n'+processes.map(p=>p.output).join('\n'));await delay(20);}}
function read(file){try{return JSON.parse(fs.readFileSync(file));}catch{return null;}}
try {
  const sim=await udp(),moza=await udp(),inputSocket=await udp(),input=inputSocket.address().port;inputSocket.close();sockets.splice(sockets.indexOf(inputSocket),1);
  const status=path.join(dir,'status.json'), packets=[];sim.on('message',b=>packets.push(b));
  const bridge=child([path.join(root,'bridge.mjs'),'--duration','0','--input-port',String(input),'--output-port',String(sim.address().port),'--moza-udp-port',String(moza.address().port),'--status-dir',dir]);
  await until(()=>bridge.output.includes('LIVE JSON'),'bridge ready');
  unlock=await lockFile(status);
  const sender=await udp();let seq=0;
  const send=async()=>{
    const e={source:'star-citizen-dbox',schema_version:1,mapping_valid:true,session_id:'test',stream_id:'flight',event_key:3,seq:++seq,meanings:[],values:[],acceleration_m_s2:{x:1,y:2,z:3},velocity_m_s:{x:0,y:100,z:0},angular_velocity_rad_s:{x:0,y:0,z:0}};
    await new Promise((r,j)=>sender.send(Buffer.from(JSON.stringify(e)),input,'127.0.0.1',e=>e?j(e):r()));
  };
  await send();await delay(1300);await send();
  await until(()=>packets.length===2,'UDP continues while status file is locked');
  assert.equal(bridge.exitCode,null);assert.match(bridge.output,/Status write deferred/);assert.equal(packets[1].readFloatLE(63),3);
  await unlock();unlock=null;
  await until(()=>read(status)?.vehicle_frames===2,'status recovers after unlock');
  assert(read(status).status_write_errors>0);assert.equal(read(status).last_status_error,null);
  await delay(1200);assert.equal(bridge.exitCode,null,'idle is not an exit condition');await send();await until(()=>packets.length===3,'return from idle without restart');

  const port=await tcpPort(),out=path.join(dir,'receiver'),captured=[],receiverUdp=await udp();receiverUdp.on('message',b=>captured.push(JSON.parse(b)));
  const receiver=child([path.join(root,'receiver','receiver.mjs'),'--duration','0','--no-record','--port',String(port),'--udp-port',String(receiverUdp.address().port),'--out',out,'--cert-dir',path.join(root,'receiver','runtime','cert')]);
  await until(()=>receiver.output.includes('READY'),'receiver ready');
  const receiverStatus=path.join(out,'latest-status.json');unlock=await lockFile(receiverStatus);
  const schema=JSON.parse(fs.readFileSync(path.join(root,'receiver','motion-schema.json'))),pkg='.dbox.proto.v1.';
  const cert=fs.readFileSync(path.join(root,'receiver','runtime','cert','lm.crt'));let request=0;
  const encode=v=>frame(encodeMessage({request_id:String(++request),timestamp:'1',...v},pkg+'LiveMotionRequest',schema));
  async function connect(){client=http2.connect('https://127.0.0.1:'+port,{ca:cert,servername:'LiveMotionComm',rejectUnauthorized:true});client.on('error',()=>{});await once(client,'connect');}
  async function flight(){
    const s=client.request({':method':'POST',':path':'/dbox.proto.v1.LiveMotion/LiveMotionStream','content-type':'application/grpc','te':'trailers'});s.on('data',()=>{});
    s.write(encode({register_event:{eventDefinition:{eventKey:3,eventMeaning:3,fieldCount:1,fieldDef:[{type:7,meaning:40,offset:0}]}}}));
    s.end(encode({post_event:{eventInfo:{eventKey:3,eventData:[{eventField:[{dataFloat32XYZ:{x:1,y:2,z:3}}]}]}}}));await once(s,'end');
  }
  await connect();await flight();client.destroy();client=null;
  await delay(1200);await connect();await flight();
  // Abrupt connection loss with an incomplete frame must not kill the listener.
  const interrupted=client.request({':method':'POST',':path':'/dbox.proto.v1.LiveMotion/LiveMotionStream','content-type':'application/grpc'});interrupted.on('error',()=>{});interrupted.on('data',()=>{});interrupted.write(Buffer.from([0,0]));await delay(30);client.destroy();client=null;
  await delay(100);await connect();await flight();client.destroy();client=null;
  await until(()=>captured.length===3,'new TLS connections deliver fresh data');
  assert.equal(new Set(captured.map(e=>e.stream_id)).size,3);assert(captured.every(e=>e.acceleration_m_s2.z===3));
  await until(()=>receiver.output.includes('Status write deferred'),'receiver survives locked status timer');assert.equal(receiver.exitCode,null);
  await unlock();unlock=null;
  await until(()=>read(receiverStatus)?.vehicle_frames===3,'receiver status recovers');assert(read(receiverStatus).status_write_errors>0);
  assert.equal(receiver.exitCode,null);assert(!fs.readdirSync(out).some(f=>f.endsWith('.jsonl')));
  console.log('PASS: real Windows status locks do not stop UDP/TLS; status recovers; duration 0 stays alive; idle, clean reconnect and aborted stream reconnect work.');
} finally {
  client?.destroy();if(unlock)await unlock();
  for(const p of processes){if(p.exitCode===null)p.kill();await p.done;}
  for(const s of sockets)s.close();
}
