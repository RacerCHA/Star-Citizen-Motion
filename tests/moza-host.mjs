// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated ephemeral loopback ports and a non-DCS process name: never feeds Cockpit.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import dgram from 'node:dgram';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=path.join(root,'tests','runtime','moza-'+Date.now());fs.mkdirSync(dir,{recursive:true});
const exe=path.join(dir,'SCMozaHostTest.exe');fs.copyFileSync(path.join(root,'DCS World','bin','DCS.exe'),exe);
async function freeTcp(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function freeUdp(){const s=dgram.createSocket('udp4');s.bind(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;s.close();return p;}
const port=await freeTcp(),udpPort=await freeUdp(),status=path.join(dir,'status.json');
const host=spawn(exe,['--test','--parent',String(process.pid),'--port',String(port),'--udp-port',String(udpPort),'--status',status],{windowsHide:true});
const udp=dgram.createSocket('udp4');let client;
const send=(active,expires=Date.now()+300)=>new Promise((resolve,reject)=>udp.send(Buffer.from(JSON.stringify({active,valid_until_ms:expires,frame:active?'aircraft_name,A-10C_2;acc_x,2;acc_y,3;acc_z,4;cannon_shells,100;':'export_stop,true;'})),udpPort,'127.0.0.1',e=>e?reject(e):resolve()));
async function until(test,label){for(let i=0;i<100;i++){if(test())return;await delay(20);}throw Error('Timed out: '+label);}
try{
 await until(()=>fs.existsSync(status),'host startup');assert.equal(JSON.parse(fs.readFileSync(status)).error,'');
 await send(true);await delay(40);
 client=net.connect(port,'127.0.0.1');let wire='';client.on('data',b=>wire+=b.toString());await once(client,'connect');
 await until(()=>wire.includes('cannon_shells,100;'),'complete frame');
 await until(()=>wire.includes('export_stop,true;'),'source timeout');await until(()=>client.destroyed,'timeout closes connection');
 await send(true,Date.now()-1);await delay(300);assert.equal(JSON.parse(fs.readFileSync(status)).active,false,'expired UDP cannot revive forces');
 await send(true);await delay(20);client=net.connect(port,'127.0.0.1');let wire2='';client.on('data',b=>wire2+=b.toString());await once(client,'connect');
 await until(()=>wire2.includes('aircraft_name,'),'reconnect');await send(false);await until(()=>wire2.includes('export_stop,true;'),'explicit stop');
 console.log('PASS: DCS TCP host framing, reconnect, explicit stop, stale source and expired UDP rejection.');
}finally{client?.destroy();udp.close();host.kill();await once(host,'exit').catch(()=>{});}
