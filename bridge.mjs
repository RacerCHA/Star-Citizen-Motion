// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {SimHubEncoder} from './simhub-packet.mjs';
import {MozaEncoder} from './moza-packet.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const option=(n,d)=>{const i=process.argv.indexOf('--'+n);return i<0?d:process.argv[i+1];};
const replay=option('replay',null),duration=Number(option('duration','86400'));
const inputPort=Number(option('input-port','56061')),outputPort=Number(option('output-port','56062'));
const mozaPort=Number(option('moza-udp-port','56063')),controlFile=option('control-file',null);
if(![inputPort,outputPort,mozaPort].every(p=>Number.isInteger(p)&&p>0&&p<65536)||new Set([inputPort,outputPort,mozaPort]).size!==3)throw Error('Invalid ports');
if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid duration');
const def=JSON.parse(fs.readFileSync(path.join(root,'StarCitizen.simdef'),'utf8'));
const encoder=new SimHubEncoder(def,{replay:!!replay}),sender=dgram.createSocket('udp4');
const moza=new MozaEncoder({shipSpeedScale:Number(option('moza-ship-speed','650')),dcsSpeedScale:Number(option('moza-dcs-speed','231.5'))});
let controls={simhub:true,moza:false},mozaSent=0,mozaLastSent=-Infinity;
function readControls(){
  if(!controlFile)return;
  const previous=controls;
  try{const c=JSON.parse(fs.readFileSync(controlFile,'utf8'));controls={simhub:c.simhub===true,moza:c.moza===true};}
  catch{controls={simhub:false,moza:false};}
  if(previous.simhub&&!controls.simhub&&encoder.lastFrame)sender.send(encoder.encode(encoder.lastFrame,false),outputPort,'127.0.0.1');
}
readControls();
const statusDir=path.resolve(option('status-dir',path.join(root,'runtime')));fs.mkdirSync(statusDir,{recursive:true});
const statusPath=path.join(statusDir,'status.json');
const status={pid:process.pid,started:new Date().toISOString(),mode:replay?'recorded-flight':'live',
  input:replay||'127.0.0.1:'+inputPort,output:'127.0.0.1:'+outputPort,received:0,sent:0,vehicle_frames:0,errors:0,
  filters:'none',last_at:null,last_acceleration_m_s2:null,stopped:false};
let receiver,timer,deadline,stopping=false;
function sendMoza(now=performance.now()){
  if(!controls.moza)return;
  const packet=moza.snapshot(now);
  packet.valid_until_ms=packet.active?Date.now()+Math.max(0,Math.min(moza.frameAt,moza.roleAt)+moza.staleMs-now):0;
  status.moza={enabled:true,active:packet.active,sent:mozaSent,raw_speed_m_s:packet.raw_speed_m_s??null,adapted_tas:packet.adapted_tas??null,weapon_events:moza.weaponEvents,ordnance_events:moza.ordnanceEvents};
  sender.send(Buffer.from(JSON.stringify({active:packet.active,frame:packet.frame,valid_until_ms:packet.valid_until_ms})),mozaPort,'127.0.0.1',error=>{if(error){status.errors++;status.last_error=error.message;}else mozaSent++;});
  mozaLastSent=now;
}
function save(){const temp=statusPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(status,null,2));fs.renameSync(temp,statusPath);}
function ingest(e){
  status.received++;
  const now=performance.now();
  if(moza.ingest(e,now))sendMoza(now);
  const bytes=encoder.ingest(e);
  if(!bytes)return;
  if(e.event_key===3){status.vehicle_frames++;status.last_acceleration_m_s2=e.acceleration_m_s2;}
  status.last_at=new Date().toISOString();status.ship=encoder.ship;status.session_active=encoder.active;
  if(controls.simhub)sender.send(bytes,outputPort,'127.0.0.1',error=>{if(error){status.errors++;status.last_error=error.message;}else status.sent++;});
}
function stop(reason){if(stopping)return;stopping=true;clearInterval(timer);clearInterval(controlTimer);clearTimeout(deadline);receiver?.close();
 status.stopped=true;status.stop_reason=reason;status.stopped_at=new Date().toISOString();save();sender.close();console.log(reason);}
sender.on('error',e=>{status.errors++;status.last_error=e.message;save();});sender.bind(0,'127.0.0.1');
timer=setInterval(save,1000);deadline=setTimeout(()=>stop('duration elapsed'),duration*1000);
const controlTimer=setInterval(()=>{readControls();status.outputs={...controls};if(controls.moza&&performance.now()-mozaLastSent>=100)sendMoza();},50);
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
save();
if(replay){
  console.log('REPLAY recorded flight -> SimHub; protocol IsReplay=1; no filters');
  const lines=readline.createInterface({input:fs.createReadStream(path.resolve(replay)),crlfDelay:Infinity});
  let base=null,wall=performance.now();
  for await(const line of lines){
    if(stopping)break;
    if(!line)continue;
    const e=JSON.parse(line);
    if(e.source!=='star-citizen-dbox'||!Number.isFinite(e.receive_monotonic_ms))continue;
    base??=e.receive_monotonic_ms;
    const wait=e.receive_monotonic_ms-base-(performance.now()-wall);
    if(wait>1)await delay(wait);
    if(!stopping)ingest(e);
  }
  await delay(100);stop('replay complete');
}else{
  receiver=dgram.createSocket('udp4');
  receiver.on('message',data=>{try{ingest(JSON.parse(data.toString('utf8')));}catch(e){status.errors++;status.last_error=e.message;}});
  receiver.on('error',e=>{status.errors++;status.last_error=e.message;stop('input socket error');});
  receiver.bind(inputPort,'127.0.0.1',()=>console.log('LIVE JSON UDP '+inputPort+' -> SimHub binary UDP '+outputPort+'; no filters'));
}
