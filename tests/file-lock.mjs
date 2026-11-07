// SPDX-License-Identifier: GPL-3.0-or-later
// Real Windows reader which denies replacement, like File.ReadAllText did.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
export async function lockFile(file) {
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$f=[IO.File]::Open($env:SC_TEST_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[Console]::WriteLine('LOCKED');[Console]::In.ReadLine()|Out-Null}finally{$f.Dispose()}"],
    {windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SC_TEST_LOCK_FILE:file}});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const done=once(child,'exit');
  try {
    for(let i=0;i<200;i++){if(output.includes('LOCKED'))return async()=>{child.stdin.end('\n');await done;};if(child.exitCode!==null)break;await delay(20);}
    throw Error('Could not lock test file: '+output);
  }catch(e){child.kill();await done;throw e;}
}
