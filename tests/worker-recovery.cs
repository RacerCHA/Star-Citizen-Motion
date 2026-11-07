// SPDX-License-Identifier: GPL-3.0-or-later
using System;using System.Diagnostics;using System.IO;using System.Threading;
static class WorkerRecoveryTest {
    static void Check(bool b,string message){if(!b)throw new Exception(message);}
    static Process Child(){return Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--child"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});}
    static int Main(string[] args){
        if(args.Length>0&&args[0]=="--child"){Thread.Sleep(Timeout.Infinite);return 0;}
        int launches=0;bool fail=false;
        using(var worker=new OwnedWorker("bridge",()=>{launches++;if(fail)throw new IOException("test launch failure");return Child();},Console.WriteLine))
        using(var receiver=new OwnedWorker("receiver",Child,Console.WriteLine)){
            worker.Start();receiver.Start();int healthyPid=receiver.Process.Id;DateTime t=DateTime.UtcNow;
            worker.Poll(t.AddHours(1));Check(launches==1,"idle must not restart a live process");
            worker.Process.Kill();worker.Process.WaitForExit();worker.Poll(t.AddHours(1));
            DateTime retry=worker.RetryAt;Check(worker.Error.Contains("exit"),"exit diagnosis missing");
            worker.Poll(retry.AddMilliseconds(-1));Check(launches==1,"backoff ignored");
            worker.Poll(retry);Check(launches==2&&worker.Restarts==1&&worker.Error=="","worker did not recover");
            Check(receiver.Process.Id==healthyPid&&!receiver.Process.HasExited,"healthy receiver was restarted");
            worker.Process.Kill();worker.Process.WaitForExit();worker.Poll(retry.AddSeconds(1));fail=true;
            for(int i=0;i<10;i++){DateTime due=worker.RetryAt;worker.Poll(due);Check((worker.RetryAt-due).TotalSeconds<=30,"backoff exceeded bound");Check(worker.Error.Contains("test launch failure"),"launch error lost");}
            fail=false;worker.Poll(worker.RetryAt);Check(worker.Restarts==2,"launch recovery failed");
            worker.Dispose();worker.Poll(DateTime.UtcNow.AddDays(1));Check(worker.Process==null,"manual stop restarted worker");
        }
        string file=Path.Combine(Path.GetTempPath(),"sc-status-test-"+Guid.NewGuid()+".json");
        try{Check(RuntimeFiles.TryWriteSnapshot(file,"{\"n\":1}"),"initial snapshot");using(var held=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)){Check(!RuntimeFiles.TryWriteSnapshot(file,"{\"n\":2}"),"locked replacement must be deferred");Check(RuntimeFiles.ReadText(file)=="{\"n\":1}","old snapshot must stay complete");}Check(RuntimeFiles.TryWriteSnapshot(file,"{\"n\":3}"),"snapshot did not recover");Check(RuntimeFiles.ReadText(file)=="{\"n\":3}","fresh snapshot missing");}finally{File.Delete(file);}
        Console.WriteLine("PASS: owned worker restarts, bounded backoff, healthy receiver preserved, manual stop cancels retries, locked status recovery.");return 0;
    }
}
