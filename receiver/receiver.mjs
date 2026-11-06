// SPDX-License-Identifier: GPL-3.0-or-later
// Local capture only. Schema and event mapping: DMUSER15/SC-Motion-Haptic-Bridge.
import fs from 'node:fs';
import path from 'node:path';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { decodeMessage, GrpcFrames } from './protobuf.mjs';
import { encodeMessage, frame } from './wire.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(root,'motion-schema.json')));
const pkg = '.dbox.proto.v1.';
function option(name, fallback) { const i=process.argv.indexOf('--'+name); return i<0?fallback:process.argv[i+1]; }
const port = Number(option('port','61666')), udpPort=Number(option('udp-port','56061'));
const duration = Number(option('duration','1800'));
const certDir=path.resolve(option('cert-dir',path.join(root,'runtime','cert')));
const outDir=path.resolve(option('out',path.join(root,'runtime','captures')));
if (![port,udpPort].every(n=>Number.isInteger(n)&&n>0&&n<65536)||!Number.isFinite(duration)||duration<=0) throw Error('Invalid port/duration');
fs.mkdirSync(outDir,{recursive:true});
const runId=crypto.randomUUID(), started=new Date().toISOString(), stamp=started.replace(/[:.]/g,'-');
const captureFile=path.join(outDir,stamp+'.jsonl'), statusFile=path.join(outDir,'latest-status.json');
const noRecord=process.argv.includes('--no-record');
const capture=noRecord ? new Writable({write(chunk,enc,done){done();}}) : fs.createWriteStream(captureFile,{flags:'wx',encoding:'utf8'});
const udp=dgram.createSocket('udp4');
const status={run_id:runId,started,capture_file:noRecord?null:captureFile,listen:'127.0.0.1:'+port,udp:'127.0.0.1:'+udpPort,
  identifications:0,streams:0,requests:0,events:0,vehicle_frames:0,valid_acceleration_frames:0,udp_errors:0,decode_errors:0,counts:{},ranges:{},last_event_at:null,stopped:false};
let seq=0, stopping=false, timer, durationTimer;
const sessions=new Set();
const names=['Global','EnterVehicleConfig','LeaveVehicle','VehicleFrame','Vibration','Weapon','ExplosiveOrdnance','VehicleImpact','VehicleExplosionImpact','Decoupled','PlayerRole','Turret','Actor','Recoil','Heartbeat','ForceReaction','Footstep','AudioHaptic','GroundVehicle','Throw'];
function writeStatus() { const tmp=statusFile+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(status,null,2)); fs.renameSync(tmp,statusFile); }
function record(obj) { if(noRecord)return;
  if (!capture.write(JSON.stringify(obj)+'\n') && capture.writableLength>16*1024*1024) throw Error('Capture disk cannot keep up');
}
function value(f) {
  const k=Object.keys(f)[0]; if (!k) return null; const v=f[k];
  if (k.endsWith('XYZ')) return [v.x,v.y,v.z];
  if (k.startsWith('dataQuad')) return [v.frontLeft,v.frontRight,v.backLeft,v.backRight];
  return v;
}
function vector(v) { return Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x)); }
function addRange(key,values) {
  const r=status.ranges[key]??={min:[...values],max:[...values]};
  for(let i=0;i<3;i++){r.min[i]=Math.min(r.min[i],values[i]);r.max[i]=Math.max(r.max[i],values[i]);}
}
function post(info,defs,streamId) {
  if (!info) return;
  const key=info.eventKey, def=defs.get(key), meanings=def?.fieldDef.map(f=>f.meaning)??[];
  for (const data of info.eventData) {
    const values=data.eventField.map(value), mappingValid=Boolean(def)&&meanings.length===values.length;
    const packet={schema_version:1,source:'star-citizen-dbox',session_id:runId,stream_id:streamId,seq:++seq,
      received_at:new Date().toISOString(),receive_monotonic_ms:Number(process.hrtime.bigint()/1000n)/1000,
      event_key:key,event_name:names[key]??'Unknown',meanings,values,mapping_valid:mappingValid};
    if (key===3) {
      status.vehicle_frames++;
      const get=n=>values[meanings.indexOf(n)];
      const a=get(40), w=get(35), v=get(9);
      packet.axes_convention='body: x right, y forward, z up; mapping from upstream, verify in flight';
      if (mappingValid&&vector(a)) {
        packet.acceleration_m_s2={x:a[0],y:a[1],z:a[2]};
        packet.acceleration_includes_gravity_and_drag=true;
        status.valid_acceleration_frames++; addRange('acceleration_m_s2',a);
      }
      if (mappingValid&&vector(w)) {packet.angular_velocity_rad_s={x:w[0],y:w[1],z:w[2]};addRange('angular_velocity_rad_s',w);}
      if (mappingValid&&vector(v)) {packet.velocity_m_s={x:v[0],y:v[1],z:v[2]};addRange('velocity_m_s',v);}
    }
    status.events++; status.counts[key]=(status.counts[key]??0)+1;status.last_event_at=packet.received_at;
    record(packet);
    const bytes=Buffer.from(JSON.stringify(packet));
    if (bytes.length>65000) throw Error('UDP record too large');
    udp.send(bytes,udpPort,'127.0.0.1',e=>{if(e)status.udp_errors++;});
  }
}
const server=http2.createSecureServer({key:fs.readFileSync(path.join(certDir,'lm.key')),cert:fs.readFileSync(path.join(certDir,'lm.crt')),
  minVersion:'TLSv1.2',allowHTTP1:false,maxSessionMemory:16,settings:{maxConcurrentStreams:8,maxHeaderListSize:16384}});
server.on('session',s=>{sessions.add(s);s.on('close',()=>sessions.delete(s));s.on('error',()=>{});});
server.on('tlsClientError',e=>{status.last_tls_error=e.code??e.message;writeStatus();});
server.on('stream',(s,h)=>{
  const identification=h[':path']==='/dbox.proto.v1.LiveMotion/GetIdentification';
  const live=h[':path']==='/dbox.proto.v1.LiveMotion/LiveMotionStream';
  const streamId=crypto.randomUUID(), defs=new Map(); let grpcStatus='0',grpcError='';
  s.on('error',()=>{});
  s.respond({':status':200,'content-type':'application/grpc','grpc-encoding':'identity'},{waitForTrailers:true});
  s.on('wantTrailers',()=>s.sendTrailers({'grpc-status':grpcStatus,...(grpcError?{'grpc-message':encodeURIComponent(grpcError)}:{})}));
  if(h[':method']!=='POST'||(!identification&&!live)){grpcStatus='12';s.end();return;}
  if(live){status.streams++;console.log('Game motion stream opened',streamId);}
  const frames=new GrpcFrames(bytes=>{
    status.requests++;
    if(identification){
      decodeMessage(bytes,pkg+'IdentificationRequest',schema); status.identifications++;
      const response={server_id:'anton-sc-capture',server_name:'Local SC Telemetry Capture',server_version:'6.12.0',supported_client_types:[2],single_client_mode:false,current_client_count:0};
      s.write(frame(encodeMessage(response,pkg+'IdentificationResponse',schema)));return;
    }
    const req=decodeMessage(bytes,pkg+'LiveMotionRequest',schema);
    const kind=schema.messages[pkg+'LiveMotionRequest'].find(f=>f.oneof_index!==null&&Object.hasOwn(req,f.name))?.name;
    if(!kind)throw Error('Unknown request type');
    if(kind==='register_event'){
      const d=req.register_event.eventDefinition;
      if(!d||d.fieldCount!==d.fieldDef.length)throw Error('Event definition length mismatch');
      defs.set(d.eventKey,d);
      record({record_type:'event_definition',stream_id:streamId,received_at:new Date().toISOString(),event_key:d.eventKey,event_meaning:d.eventMeaning,fields:d.fieldDef});
    }
    if(kind.startsWith('post_event'))post(req[kind].eventInfo,defs,streamId);
    const response={request_id:req.request_id,timestamp:Date.now().toString(),result_code:0};
    if(kind==='heartbeat')response.heartbeat_response={server_timestamp:Date.now().toString(),client_timestamp:req.heartbeat.client_timestamp,connected_clients:1};
    else if(kind.startsWith('post_events'))response.post_events_reply={};
    else if(!kind.startsWith('post_event'))response.reply={};
    s.write(frame(encodeMessage(response,pkg+'LiveMotionResponse',schema)));
    if(s.writableLength>4*1024*1024)throw Error('Client is not reading responses');
  });
  s.on('data',chunk=>{try{frames.push(chunk);}catch(e){status.decode_errors++;grpcStatus='3';grpcError=e.message;s.end();}});
  s.on('end',()=>{try{frames.finish();}catch(e){status.decode_errors++;grpcStatus='3';grpcError=e.message;}s.end();});
});
async function stop(reason) {
  if(stopping)return;stopping=true;clearInterval(timer);clearTimeout(durationTimer);
  status.stopped=true;status.stopped_at=new Date().toISOString();status.stop_reason=reason;writeStatus();
  for(const s of sessions)s.destroy();server.close();udp.close();
  capture.end(()=>{console.log(JSON.stringify(status,null,2));process.exit(reason.startsWith('error')?1:0);});
}
capture.on('error',e=>stop('error: '+e.message));udp.on('error',e=>{status.udp_errors++;status.last_udp_error=e.message;});
server.on('error',e=>stop('error: '+e.message));
udp.bind(0,'127.0.0.1');
server.listen(port,'127.0.0.1',()=>{
  record({record_type:'capture_start',source:'live-connector-or-test-client',session_id:runId,started,mapping_source:schema.source});writeStatus();
  console.log('READY TLS 127.0.0.1:'+port+' -> UDP 127.0.0.1:'+udpPort+'; '+captureFile);
  timer=setInterval(()=>{writeStatus();console.log('events='+status.events+' XYZ='+status.valid_acceleration_frames+' errors='+status.decode_errors);},5000);
  durationTimer=setTimeout(()=>stop('duration elapsed'),duration*1000);
});
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
