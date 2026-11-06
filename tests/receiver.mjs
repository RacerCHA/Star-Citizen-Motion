// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic local test; never launches the game or sends to SimHub / hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {encodeMessage,frame} from '../receiver/wire.mjs';
import {decodeMessage,GrpcFrames} from '../receiver/protobuf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../receiver'), pkg='.dbox.proto.v1.';
const schema=JSON.parse(fs.readFileSync(path.join(root,'motion-schema.json')));
const out=path.join(root,'runtime','synthetic-test-'+Date.now());
const noRecord=process.argv.includes('--no-record');
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=listener.address().port;await new Promise(r=>listener.close(r));
const udp=dgram.createSocket('udp4');udp.bind(0,'127.0.0.1');await once(udp,'listening');
const packets=[];udp.on('message',b=>packets.push(JSON.parse(b)));
const child=spawn(process.execPath,[path.join(root,'receiver.mjs'),'--port',String(port),'--udp-port',String(udp.address().port),'--duration','5','--out',out,...(noRecord?['--no-record']:[])],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const exited=once(child,'exit');let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
async function waitFor(fn,timeout=3000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw Error('Timed out: '+stderr+' '+stdout);await new Promise(r=>setTimeout(r,20));}}
let client;
try {
 await waitFor(()=>stdout.includes('READY'));
 const cert=fs.readFileSync(path.join(root,'runtime','cert','lm.crt'));
 client=http2.connect('https://127.0.0.1:'+port,{ca:cert,servername:'LiveMotionComm',rejectUnauthorized:true});
 await once(client,'connect');assert(client.socket.authorized);
 const id=client.request({':method':'POST',':path':'/dbox.proto.v1.LiveMotion/GetIdentification','content-type':'application/grpc','te':'trailers'});
 const ids=[];const idFrames=new GrpcFrames(b=>ids.push(decodeMessage(b,pkg+'IdentificationResponse',schema)));
 id.on('data',b=>idFrames.push(b));
 id.end(frame(encodeMessage({client_info:{client_id:'SYNTHETIC_TEST',client_type:2},client_version:'test'},pkg+'IdentificationRequest',schema)));
 await once(id,'end');assert.deepEqual(ids[0].supported_client_types,[2]);
 const s=client.request({':method':'POST',':path':'/dbox.proto.v1.LiveMotion/LiveMotionStream','content-type':'application/grpc','te':'trailers'});
 const replies=[];let trailers;const pf=new GrpcFrames(b=>replies.push(decodeMessage(b,pkg+'LiveMotionResponse',schema)));
 s.on('data',b=>pf.push(b));s.on('trailers',h=>trailers=h);
 let n=0;
 function encoded(v){return frame(encodeMessage({request_id:String(++n),timestamp:'1',...v},pkg+'LiveMotionRequest',schema));}
 const first=encoded({register_event:{eventDefinition:{eventKey:3,eventMeaning:3,fieldCount:3,fieldDef:[{type:7,meaning:40,offset:0},{type:7,meaning:35,offset:12},{type:7,meaning:9,offset:24}]}}});
 // Fragment the gRPC prefix and body; coalesce the remaining messages.
 s.write(first.subarray(0,2));s.write(first.subarray(2,11));s.write(first.subarray(11));
 const requests=[];
 for(let i=0;i<12;i++) requests.push(encoded({post_event:{eventInfo:{eventKey:3,eventData:[{eventField:[
   {dataFloat32XYZ:{x:i-6,y:-i,z:9.81}},{dataFloat32XYZ:{x:0,y:0.25,z:-0.5}},{dataFloat32XYZ:{x:0,y:30,z:1}}
 ]}],size:'36',count:'1'}}}));
 requests.push(encoded({heartbeat:{client_timestamp:'123456'}}));
 s.end(Buffer.concat(requests));await once(s,'end');
 assert.equal(trailers['grpc-status'],'0');assert.equal(replies.length,14);
 assert.equal(replies.at(-1).heartbeat_response.client_timestamp,'123456');
 await waitFor(()=>packets.length===12);
 assert.equal(packets[0].acceleration_m_s2.x,-6);assert.equal(packets[11].acceleration_m_s2.x,5);
 assert.equal(packets[11].acceleration_m_s2.y,-11);assert(Math.abs(packets[0].acceleration_m_s2.z-9.81)<0.00001);
 assert.deepEqual(packets[0].angular_velocity_rad_s,{x:0,y:0.25,z:-0.5});
 // Registration belongs to its stream, not a global dictionary.
 const s2=client.request({':method':'POST',':path':'/dbox.proto.v1.LiveMotion/LiveMotionStream','content-type':'application/grpc'});
 s2.on('data',()=>{});s2.end(encoded({post_event:{eventInfo:{eventKey:3,eventData:[{eventField:[{dataFloat32XYZ:{x:999,y:999,z:999}}]}]}}}));
 await once(s2,'end');await waitFor(()=>packets.length===13);
 assert.equal(packets.at(-1).mapping_valid,false);assert(!Object.hasOwn(packets.at(-1),'acceleration_m_s2'));
 // Omitted initialization fields are discarded and cannot enter capture logs.
 const secret=Buffer.from('SYNTHETIC_CREDENTIAL_CANARY');
 const unknown=Buffer.concat([Buffer.from([10,secret.length]),secret]);
 assert.deepEqual(decodeMessage(unknown,pkg+'InitializeParam',schema),{appVersion:0});
 client.close();client=null;
 const [code]=await exited;assert.equal(code,0,stderr);
 const status=JSON.parse(fs.readFileSync(path.join(out,'latest-status.json')));
 assert.equal(status.valid_acceleration_frames,12);assert.equal(status.events,13);assert.equal(status.decode_errors,0);assert.equal(status.udp_errors,0);
 if(noRecord){assert.equal(status.capture_file,null);assert(!fs.readdirSync(out).some(n=>n.endsWith('.jsonl')));}else{const capture=fs.readFileSync(status.capture_file,'utf8');assert(!capture.includes('SYNTHETIC_CREDENTIAL_CANARY'));}
 const report={test_type:'SYNTHETIC_ONLY',pass:true,checks:['verified TLS certificate and hostname','gRPC identification','fragmented and coalesced messages','event registration and XYZ mapping','12 signed acceleration vectors received over UDP','heartbeat response','stream isolation','unused credential fields discarded'],status};
 fs.writeFileSync(path.join(out,'test-result.json'),JSON.stringify(report,null,2));
 console.log('PASS: synthetic TLS -> gRPC -> XYZ -> UDP. 13 datagrams, 12 mapped vectors, 0 errors. No game data captured.');
} finally {client?.destroy();if(child.exitCode===null)child.kill();udp.close();}
