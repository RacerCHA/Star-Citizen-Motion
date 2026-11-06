// SPDX-License-Identifier: GPL-3.0-or-later
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Program {
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        string root=AppDomain.CurrentDomain.BaseDirectory;
        foreach(string command in new[]{"--stop","--exit"})if(Array.IndexOf(args,command)>=0){
            try{using(var signal=EventWaitHandle.OpenExisting("Local\\CHA.SC."+command.Substring(2)))signal.Set();return 0;}catch(WaitHandleCannotBeOpenedException){return 0;}
        }
        if(Array.IndexOf(args,"--check")>=0) {
            try { TrayContext.Check(root); return 0; }
            catch(Exception e) { Directory.CreateDirectory(Path.Combine(root,"runtime")); File.WriteAllText(Path.Combine(root,"runtime","preflight-error.txt"),e.ToString()); return 1; }
        }
        bool created;
        using(var singleton=new Mutex(true,"Local\\CHA.StarCitizen.SimHub.Telemetry",out created)) {
            if(!created) { try{using(var signal=EventWaitHandle.OpenExisting("Local\\CHA.SC.show"))signal.Set();}catch(WaitHandleCannotBeOpenedException){} return 0; }
            try { Application.Run(new TrayContext(root,Array.IndexOf(args,"--show")>=0)); }
            catch(Exception e) { MessageBox.Show(e.Message,"Star Citizen Telemetry",MessageBoxButtons.OK,MessageBoxIcon.Error); return 1; }
        }
        return 0;
    }
}

sealed class TrayContext : ApplicationContext {
    readonly string root,run; readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly NotifyIcon tray; readonly System.Windows.Forms.Timer timer;
    readonly ToolStripMenuItem startItem,stopItem,stateItem;
    readonly Form window; readonly Label stateLabel,detailLabel;
    readonly List<Process> workers=new List<Process>(); readonly object logLock=new object();
    readonly EventWaitHandle showSignal=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\CHA.SC.show");
    readonly EventWaitHandle stopSignal=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\CHA.SC.stop");
    readonly EventWaitHandle exitSignal=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\CHA.SC.exit");
    bool running,exiting; string lastError=""; DateTime started;
    long previousSent; DateTime previousSample=DateTime.UtcNow; double rate;
    Dictionary<string,object> settings;

    static string P(string root,string path) { return Path.GetFullPath(Path.IsPathRooted(path)?path:Path.Combine(root,path)); }
    static Dictionary<string,object> Settings(string root) { return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"settings.json"))); }
    public static void Check(string root) {
        var s=Settings(root); string cert=P(root,Convert.ToString(s["CertificateDirectory"]));
        foreach(string file in new[]{P(root,Convert.ToString(s["NodePath"])),Path.Combine(root,"bridge.mjs"),Path.Combine(root,"receiver","receiver.mjs"),Path.Combine(root,"StarCitizen.simdef"),Path.Combine(cert,"lm.crt"),Path.Combine(cert,"lm.key")})
            if(!File.Exists(file)) throw new FileNotFoundException("Не найден файл: "+file);
        Directory.CreateDirectory(Path.Combine(root,"runtime"));
        File.WriteAllText(Path.Combine(root,"runtime","preflight.json"),"{\"ok\":true,\"checked_at\":\""+DateTime.UtcNow.ToString("o")+"\"}");
    }
    public TrayContext(string directory,bool show) {
        root=directory;run=Path.Combine(root,"runtime");Directory.CreateDirectory(run);
        var menu=new ContextMenuStrip(); stateItem=new ToolStripMenuItem("Подготовка…");stateItem.Enabled=false;menu.Items.Add(stateItem);
        menu.Items.Add("Показать статус",null,(s,e)=>ShowWindow()); menu.Items.Add(new ToolStripSeparator());
        startItem=new ToolStripMenuItem("Запустить",null,(s,e)=>Start());stopItem=new ToolStripMenuItem("Остановить",null,(s,e)=>Stop());
        menu.Items.Add(startItem);menu.Items.Add(stopItem);
        menu.Items.Add("Открыть SimHub",null,(s,e)=>OpenSimHub());
        menu.Items.Add("Открыть папку приложения",null,(s,e)=>Process.Start(new ProcessStartInfo(root){UseShellExecute=true}));
        menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Выход",null,(s,e)=>ExitThread());
        tray=new NotifyIcon { Icon=new Icon(Path.Combine(root,"StarCitizenTelemetry.ico")),Text="Star Citizen → SimHub",ContextMenuStrip=menu,Visible=true };
        tray.DoubleClick+=(s,e)=>ShowWindow();
        window=new Form {Text="Star Citizen Telemetry",ClientSize=new Size(550,315),FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,StartPosition=FormStartPosition.CenterScreen,Icon=tray.Icon,BackColor=Color.FromArgb(19,27,43),ForeColor=Color.White,Font=new Font("Segoe UI",10)};
        var title=new Label {Text="STAR CITIZEN  →  SIMHUB",Location=new Point(24,22),Size=new Size(500,32),Font=new Font("Segoe UI",17,FontStyle.Bold)};
        stateLabel=new Label {Text="Подготовка…",Location=new Point(26,73),Size=new Size(500,30),Font=new Font("Segoe UI",12,FontStyle.Bold),ForeColor=Color.FromArgb(86,180,255)};
        detailLabel=new Label {Location=new Point(26,111),Size=new Size(500,140)};
        var stop=new Button {Text="Остановить",Location=new Point(26,265),Size=new Size(145,32),ForeColor=Color.White,BackColor=Color.FromArgb(35,63,100),FlatStyle=FlatStyle.Flat};stop.Click+=(s,e)=>Stop();
        var start=new Button {Text="Запустить",Location=new Point(187,265),Size=new Size(145,32),ForeColor=Color.White,BackColor=Color.FromArgb(35,63,100),FlatStyle=FlatStyle.Flat};start.Click+=(s,e)=>Start();
        var hide=new Button {Text="Свернуть в трей",Location=new Point(348,265),Size=new Size(175,32),ForeColor=Color.White,BackColor=Color.FromArgb(35,63,100),FlatStyle=FlatStyle.Flat};hide.Click+=(s,e)=>window.Hide();
        window.Controls.AddRange(new Control[]{title,stateLabel,detailLabel,stop,start,hide});
        window.FormClosing+=(s,e)=>{if(!exiting){e.Cancel=true;window.Hide();}};
        timer=new System.Windows.Forms.Timer {Interval=1000};timer.Tick+=(s,e)=>{if(exitSignal.WaitOne(0)){ExitThread();return;}if(showSignal.WaitOne(0))ShowWindow();if(stopSignal.WaitOne(0))Stop();Refresh();};timer.Start();
        Start();if(show)ShowWindow();
    }
    void ShowWindow(){window.Show();window.WindowState=FormWindowState.Normal;window.Activate();}
    void Log(string line){lock(logLock)File.AppendAllText(Path.Combine(run,"app.log"),DateTime.UtcNow.ToString("o")+" "+line+Environment.NewLine);}
    void StartWorker(string name,string script,string arguments) {
        var info=new ProcessStartInfo(P(root,Convert.ToString(settings["NodePath"])),"\""+script+"\" "+arguments){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true};
        var p=new Process {StartInfo=info};
        p.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Log(name+": "+e.Data);};p.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Log(name+": "+e.Data);};
        p.Start();workers.Add(p);p.BeginOutputReadLine();p.BeginErrorReadLine();
    }
    void Start(){
        if(running)return;
        try {
            Check(root);settings=Settings(root);
            // Refuse to compete with another capture/recorder; never terminate other processes.
            var tcp=new TcpListener(IPAddress.Loopback,61666);try{tcp.Start();}finally{tcp.Stop();}
            using(var udp=new Socket(AddressFamily.InterNetwork,SocketType.Dgram,ProtocolType.Udp)){udp.ExclusiveAddressUse=true;udp.Bind(new IPEndPoint(IPAddress.Loopback,56061));}
            lastError="";previousSent=0;rate=0;started=DateTime.UtcNow;previousSample=started;
            StartWorker("bridge",Path.Combine(root,"bridge.mjs"),"--duration 86400");
            StartWorker("receiver",Path.Combine(root,"receiver","receiver.mjs"),"--duration 86400 --no-record --cert-dir \""+P(root,Convert.ToString(settings["CertificateDirectory"]))+"\" --out \""+Path.Combine(run,"receiver")+"\"");
            running=true;Log("Live session started. Raw telemetry, no filters.");
        } catch(Exception e){lastError=e.Message;StopWorkers();running=false;Log(lastError);tray.ShowBalloonTip(5000,"Star Citizen Telemetry",lastError,ToolTipIcon.Error);}
        Refresh();
    }
    void StopWorkers(){foreach(var p in workers){try{if(!p.HasExited){p.Kill();p.WaitForExit(1500);}}catch(Exception e){Log(e.Message);}p.Dispose();}workers.Clear();}
    void Stop(){StopWorkers();running=false;rate=0;Log("Live session stopped.");Refresh();}
    void OpenSimHub(){try{var s=Settings(root);Process.Start(new ProcessStartInfo(P(root,Convert.ToString(s["SimHubPath"]))){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message,"SimHub");}}
    void Refresh(){
        if(running)foreach(var p in workers)if(p.HasExited){lastError="Процесс моста завершился. Подробности: runtime\\app.log";StopWorkers();running=false;break;}
        string state=running?"Ожидание телеметрии игры":"Остановлено",ship="—",values="—";long sent=0,errors=0;bool receiving=false;
        if(lastError.Length>0)state="Ошибка запуска";
        if(running)try{
            var data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(run,"status.json")));
            DateTime dataStarted=DateTime.Parse(Convert.ToString(data["started"])).ToUniversalTime();
            if(dataStarted>=started.AddSeconds(-1)){
                sent=Convert.ToInt64(data["sent"]);errors=Convert.ToInt64(data["errors"]);
                if(data.ContainsKey("ship"))ship=Convert.ToString(data["ship"]);
                double delta=(DateTime.UtcNow-previousSample).TotalSeconds;if(delta>=.8){rate=Math.Max(0,(sent-previousSent)/delta);previousSample=DateTime.UtcNow;previousSent=sent;}
                if(data["last_at"]!=null)receiving=(DateTime.UtcNow-DateTime.Parse(Convert.ToString(data["last_at"])).ToUniversalTime()).TotalSeconds<2.5;
                if(receiving)state=Convert.ToBoolean(data["session_active"])?"Живой поток → SimHub":"Поток: вне корабля";
                if(data["last_acceleration_m_s2"]!=null){var a=(Dictionary<string,object>)data["last_acceleration_m_s2"];values=String.Format("X {0:F2}    Y {1:F2}    Z {2:F2} м/с²",Convert.ToDouble(a["x"]),Convert.ToDouble(a["y"]),Convert.ToDouble(a["z"]));}
            }
        }catch(IOException){}catch(ArgumentException){}catch(InvalidCastException){}catch(KeyNotFoundException){}
        stateItem.Text=state;stateLabel.Text=state;tray.Text="SC → SimHub | "+(receiving?rate.ToString("F0")+" Гц":running?"ожидание":"стоп");
        detailLabel.Text=lastError.Length>0?lastError:String.Format("Семейство: Flight  •  без фильтров и ограничений\r\n\r\nКорабль: {0}\r\nОтправлено: {1:N0}   •   {2:F0} Гц   •   ошибок: {3}\r\n{4}\r\nJSON UDP 56061 → SimHub UDP 56062",ship,sent,rate,errors,values);
        startItem.Enabled=!running;stopItem.Enabled=running;
        try {File.WriteAllText(Path.Combine(run,"app-status.json"),json.Serialize(new {pid=Process.GetCurrentProcess().Id,running=running,receiving=receiving,state=state,sent=sent,rate_hz=rate,errors=errors,last_error=lastError,updated_at=DateTime.UtcNow.ToString("o")}));}catch(IOException){}
    }
    protected override void ExitThreadCore(){exiting=true;timer.Stop();Stop();tray.Visible=false;tray.Dispose();window.Dispose();timer.Dispose();showSignal.Dispose();stopSignal.Dispose();exitSignal.Dispose();base.ExitThreadCore();}
}
