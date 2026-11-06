// SPDX-License-Identifier: GPL-3.0-or-later
// Offline only: no network sockets, no hardware output. Private capture is not distributed.
import fs from 'node:fs';import readline from 'node:readline';import assert from 'node:assert/strict';
import {MozaEncoder,G} from '../moza-packet.mjs';
if(!process.argv[2])throw Error('Usage: node tests/flight-audit.mjs <capture.jsonl>');
const encoder=new MozaEncoder(),counts={};let frames=0,active=0,weapon=0,matchedWeapon=0,maxG=0;
for await(const line of readline.createInterface({input:fs.createReadStream(process.argv[2]),crlfDelay:Infinity})){
 if(!line)continue;const e=JSON.parse(line);if(e.source!=='star-citizen-dbox'||!e.mapping_valid)continue;
 const now=e.receive_monotonic_ms;counts[e.event_key]=(counts[e.event_key]||0)+1;
 encoder.ingest(e,now);const s=encoder.snapshot(now);
 if(e.event_key===5){weapon++;if(s.active)matchedWeapon++;}
 if(e.event_key===3){frames++;if(s.active){active++;assert.equal(s.values.acc_x,e.acceleration_m_s2.y/G);assert.equal(s.values.acc_y,e.acceleration_m_s2.z/G);assert.equal(s.values.acc_z,e.acceleration_m_s2.x/G);maxG=Math.max(maxG,Math.abs(s.values.acc_x),Math.abs(s.values.acc_y),Math.abs(s.values.acc_z));}}
}
assert.ok(active>0,'recording must include active pilot frames');
console.log(JSON.stringify({frames,active,weapon,matchedWeapon,max_abs_g:maxG,event_counts:counts,output:'offline calculations only'},null,2));
