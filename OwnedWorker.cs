// SPDX-License-Identifier: GPL-3.0-or-later
using System;
using System.Diagnostics;

// Only restarts a process owned by this app. Silence from the game is not a failure.
sealed class OwnedWorker : IDisposable {
    readonly Func<Process> launch;readonly Action<string> log;
    public readonly string Name;
    public Process Process {get;private set;}
    public string Error {get;private set;}
    public int Restarts {get;private set;}
    public DateTime RetryAt {get;private set;}
    DateTime started;int failures;bool disposed;
    public OwnedWorker(string name,Func<Process> launch,Action<string> log){Name=name;this.launch=launch;this.log=log;Error="";}
    public void Start(){Start(DateTime.UtcNow);}
    void Start(DateTime now){Process=launch();started=now;Error="";}
    void Failed(DateTime now,string reason){
        failures=Math.Min(failures+1,6);
        RetryAt=now.AddSeconds(Math.Min(30,Math.Pow(2,failures-1)));
        Error=Name+": "+reason;log(Error+"; retry in "+(RetryAt-now).TotalSeconds+" s.");
    }
    public void Poll(DateTime now){
        if(disposed)return;
        if(Process!=null){
            if(!Process.HasExited){if((now-started).TotalSeconds>=30)failures=0;return;}
            int code=Process.ExitCode;Process.Dispose();Process=null;Failed(now,"exit "+code);return;
        }
        if(now<RetryAt)return;
        try{Start(now);Restarts++;log(Name+" restarted ("+Restarts+").");}
        catch(Exception e){Failed(now,e.Message);}
    }
    public void Dispose(){
        disposed=true;
        if(Process!=null){try{if(!Process.HasExited){Process.Kill();Process.WaitForExit(1200);}}catch(Exception e){log(Name+": "+e.Message);}finally{Process.Dispose();Process=null;}}
    }
}
