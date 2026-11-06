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
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        string root=AppDomain.CurrentDomain.BaseDirectory;
        foreach(string command in new[]{"stop","exit","moza-on","moza-off","simhub-on","simhub-off"})if(Array.IndexOf(args,"--"+command)>=0){
            try{using(var signal=EventWaitHandle.OpenExisting("Local\\CHA.SC."+command))signal.Set();return 0;}catch(WaitHandleCannotBeOpenedException){return 1;}
        }
        if(Array.IndexOf(args,"--check")>=0){try{TrayContext.Check(root);return 0;}catch(Exception e){Directory.CreateDirectory(Path.Combine(root,"runtime"));File.WriteAllText(Path.Combine(root,"runtime","preflight-error.txt"),e.ToString());return 1;}}
        bool created;
        using(var singleton=new Mutex(true,"Local\\CHA.StarCitizen.SimHub.Telemetry",out created)){
            if(!created){try{using(var signal=EventWaitHandle.OpenExisting("Local\\CHA.SC.show"))signal.Set();}catch(WaitHandleCannotBeOpenedException){}return 0;}
            try{Application.Run(new TrayContext(root,Array.IndexOf(args,"--show")>=0,Array.IndexOf(args,"--no-autostart")<0));}
            catch(Exception e){MessageBox.Show(e.Message,"Star Citizen Motion",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
        }
        return 0;
    }
}
sealed class TrayContext : ApplicationContext {
    readonly string root,run;readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly NotifyIcon tray;readonly System.Windows.Forms.Timer timer;readonly Form window;
    readonly Label stateLabel,detailLabel,mozaLabel;readonly Button simButton,mozaButton;
    readonly ToolStripMenuItem simItem,mozaItem,stateItem;
    readonly List<Process> workers=new List<Process>();readonly object logLock=new object();
    readonly Dictionary<string,EventWaitHandle> signals=new Dictionary<string,EventWaitHandle>();
    Dictionary<string,object> settings;Process mozaHost;
    bool running,simEnabled,mozaEnabled,exiting;string lastError="",mozaError="";
    DateTime started,mozaStarted,previousSample=DateTime.UtcNow;long previousFrames;double rate;
    static string P(string root,string p){return Path.GetFullPath(Path.IsPathRooted(p)?p:Path.Combine(root,p));}
    static string Q(string s){return "\""+s+"\"";}
    static Dictionary<string,object> Settings(string root){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"settings.json")));}
    string Setting(string key,string fallback){object v;return settings.TryGetValue(key,out v)?Convert.ToString(v,System.Globalization.CultureInfo.InvariantCulture):fallback;}
    public static void Check(string root){
        var s=Settings(root);string cert=P(root,Convert.ToString(s["CertificateDirectory"]));
        foreach(string f in new[]{P(root,Convert.ToString(s["NodePath"])),Path.Combine(root,"bridge.mjs"),Path.Combine(root,"moza-packet.mjs"),Path.Combine(root,"receiver","receiver.mjs"),Path.Combine(root,"StarCitizen.simdef"),Path.Combine(cert,"lm.crt"),Path.Combine(cert,"lm.key")})
            if(!File.Exists(f))throw new FileNotFoundException("Не найден файл: "+f);
    }
    Button MakeButton(string text,int x,int y,int width,EventHandler click){var b=new Button{Text=text,Location=new Point(x,y),Size=new Size(width,38),ForeColor=Color.White,BackColor=Color.FromArgb(35,63,100),FlatStyle=FlatStyle.Flat};b.Click+=click;return b;}
    public TrayContext(string directory,bool show,bool autoStart){
        root=directory;run=Path.Combine(root,"runtime");Directory.CreateDirectory(run);settings=Settings(root);
        foreach(string key in new[]{"show","stop","exit","moza-on","moza-off","simhub-on","simhub-off"})signals[key]=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\CHA.SC."+key);
        var menu=new ContextMenuStrip();stateItem=new ToolStripMenuItem("Подготовка…"){Enabled=false};menu.Items.Add(stateItem);
        menu.Items.Add("Показать статус",null,(s,e)=>ShowWindow());menu.Items.Add(new ToolStripSeparator());
        simItem=new ToolStripMenuItem("Включить SimHub",null,(s,e)=>SetSim(!simEnabled));mozaItem=new ToolStripMenuItem("Включить MOZA",null,(s,e)=>SetMoza(!mozaEnabled));
        menu.Items.Add(simItem);menu.Items.Add(mozaItem);menu.Items.Add("Остановить всё",null,(s,e)=>Stop());
        menu.Items.Add("Открыть SimHub",null,(s,e)=>OpenApp("SimHubPath","C:\\Program Files (x86)\\SimHub\\SimHubWPF.exe"));
        menu.Items.Add("Открыть MOZA Cockpit",null,(s,e)=>OpenApp("MozaCockpitPath","C:\\Program Files (x86)\\MOZA Cockpit\\bin\\MOZA Cockpit.exe"));
        menu.Items.Add("Папка пресета MOZA",null,(s,e)=>OpenFolder(Path.Combine(root,"presets")));
        menu.Items.Add("Открыть папку приложения",null,(s,e)=>OpenFolder(root));menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Выход",null,(s,e)=>ExitThread());
        tray=new NotifyIcon{Icon=new Icon(Path.Combine(root,"StarCitizenTelemetry.ico")),Text="Star Citizen Motion",ContextMenuStrip=menu,Visible=true};tray.DoubleClick+=(s,e)=>ShowWindow();
        window=new Form{Text="Star Citizen Motion 0.2 — SimHub / MOZA",ClientSize=new Size(620,458),FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,StartPosition=FormStartPosition.CenterScreen,Icon=tray.Icon,BackColor=Color.FromArgb(19,27,43),ForeColor=Color.White,Font=new Font("Segoe UI",10)};
        var title=new Label{Text="STAR CITIZEN MOTION",Location=new Point(24,19),Size=new Size(570,32),Font=new Font("Segoe UI",18,FontStyle.Bold)};
        stateLabel=new Label{Text="Подготовка…",Location=new Point(26,65),Size=new Size(570,27),Font=new Font("Segoe UI",12,FontStyle.Bold),ForeColor=Color.FromArgb(86,180,255)};
        detailLabel=new Label{Location=new Point(26,101),Size=new Size(570,116)};
        simButton=MakeButton("Включить SimHub",26,226,275,(s,e)=>SetSim(!simEnabled));mozaButton=MakeButton("Включить MOZA",319,226,275,(s,e)=>SetMoza(!mozaEnabled));
        mozaLabel=new Label{Location=new Point(26,280),Size=new Size(568,75),ForeColor=Color.FromArgb(170,202,232)};
        var hint=new Label{Text="MOZA: профиль Star Citizen — AB9 • DCS / A-10C II\r\nSimHub получает исходные ускорения без фильтров.",Location=new Point(26,356),Size=new Size(568,43)};
        window.Controls.AddRange(new Control[]{title,stateLabel,detailLabel,simButton,mozaButton,mozaLabel,hint,MakeButton("Остановить всё",26,407,175,(s,e)=>Stop()),MakeButton("MOZA Cockpit",215,407,180,(s,e)=>OpenApp("MozaCockpitPath","C:\\Program Files (x86)\\MOZA Cockpit\\bin\\MOZA Cockpit.exe")),MakeButton("Свернуть в трей",409,407,185,(s,e)=>window.Hide())});
        window.FormClosing+=(s,e)=>{if(!exiting){e.Cancel=true;window.Hide();}};
        timer=new System.Windows.Forms.Timer{Interval=500};timer.Tick+=(s,e)=>Tick();timer.Start();
        if(autoStart)SetSim(true);else Refresh();if(show)ShowWindow();
    }
    void ShowWindow(){window.Show();window.WindowState=FormWindowState.Normal;window.Activate();}
    void Log(string s){lock(logLock)File.AppendAllText(Path.Combine(run,"app.log"),DateTime.UtcNow.ToString("o")+" "+s+Environment.NewLine);}
    void WriteControl(){string f=Path.Combine(run,"control.json"),temp=f+".tmp";File.WriteAllText(temp,json.Serialize(new{simhub=simEnabled,moza=mozaEnabled}));if(File.Exists(f))File.Replace(temp,f,null);else File.Move(temp,f);}
    Process Worker(string exe,string args,string name){
        var p=new Process{StartInfo=new ProcessStartInfo(exe,args){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true}};
        p.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Log(name+": "+e.Data);};p.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Log(name+": "+e.Data);};p.Start();p.BeginOutputReadLine();p.BeginErrorReadLine();return p;
    }
    bool StartCore(){
        if(running)return true;
        try{
            settings=Settings(root);Check(root);
            var tcp=new TcpListener(IPAddress.Loopback,61666);try{tcp.Start();}finally{tcp.Stop();}
            using(var udp=new Socket(AddressFamily.InterNetwork,SocketType.Dgram,ProtocolType.Udp)){udp.ExclusiveAddressUse=true;udp.Bind(new IPEndPoint(IPAddress.Loopback,56061));}
            WriteControl();lastError="";previousFrames=0;rate=0;started=previousSample=DateTime.UtcNow;
            workers.Add(Worker(P(root,Setting("NodePath","")),Q(Path.Combine(root,"bridge.mjs"))+" --duration 86400 --control-file "+Q(Path.Combine(run,"control.json"))+" --moza-udp-port "+Setting("MozaUdpPort","56063")+" --moza-ship-speed "+Setting("MozaShipSpeedScale","650")+" --moza-dcs-speed "+Setting("MozaDcsSpeedScale","231.5"),"bridge"));
            workers.Add(Worker(P(root,Setting("NodePath","")),Q(Path.Combine(root,"receiver","receiver.mjs"))+" --duration 86400 --no-record --cert-dir "+Q(P(root,Setting("CertificateDirectory","runtime\\cert")))+" --out "+Q(Path.Combine(run,"receiver")),"receiver"));
            running=true;Log("Shared capture started; no full stream recording.");return true;
        }catch(Exception e){lastError=e.Message;StopWorkers();running=false;simEnabled=mozaEnabled=false;WriteControl();Log(lastError);return false;}
    }
    void SetSim(bool enabled){simEnabled=enabled;if(enabled&&!StartCore())simEnabled=false;WriteControl();Refresh();}
    void SetMoza(bool enabled){
        if(!enabled){StopMoza();Refresh();return;}if(mozaEnabled)return;
        try{
            if(!StartCore()){Refresh();return;}
            if(Process.GetProcessesByName("DCS").Length>0)throw new Exception("Закрой мост Elite или настоящий DCS, затем включи MOZA здесь.");
            string exe=Path.Combine(root,"DCS World","bin","DCS.exe");if(!File.Exists(exe))throw new FileNotFoundException("Сначала выполни Build.cmd: отсутствует DCS.exe");
            int port=int.Parse(Setting("MozaTcpPort","3476"));var probe=new TcpListener(IPAddress.Loopback,port);try{probe.Start();}finally{probe.Stop();}
            mozaError="";mozaStarted=DateTime.UtcNow;
            mozaHost=Worker(exe,"--parent "+Process.GetCurrentProcess().Id+" --port "+port+" --udp-port "+Setting("MozaUdpPort","56063")+" --status "+Q(Path.Combine(run,"moza-status.json")),"DCS host");
            mozaEnabled=true;WriteControl();Log("MOZA output enabled.");
        }catch(Exception e){mozaError=e.Message;StopMoza();Log(mozaError);}Refresh();
    }
    void StopMoza(){
        mozaEnabled=false;WriteControl();
        if(mozaHost!=null){try{if(!mozaHost.HasExited){try{using(var signal=EventWaitHandle.OpenExisting("Local\\CHA.SC.MOZA.stop."+mozaHost.Id))signal.Set();}catch(WaitHandleCannotBeOpenedException){}if(!mozaHost.WaitForExit(800)){mozaHost.Kill();mozaHost.WaitForExit(500);}}}catch(Exception e){Log(e.Message);}mozaHost.Dispose();mozaHost=null;}
    }
    void StopWorkers(){foreach(var p in workers){try{if(!p.HasExited){p.Kill();p.WaitForExit(1200);}}catch(Exception e){Log(e.Message);}p.Dispose();}workers.Clear();}
    void Stop(){simEnabled=false;StopMoza();StopWorkers();running=false;rate=0;WriteControl();Log("All outputs stopped.");Refresh();}
    void OpenFolder(string path){try{Process.Start(new ProcessStartInfo(path){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message);}}
    void OpenApp(string key,string fallback){try{Process.Start(new ProcessStartInfo(P(root,Setting(key,fallback))){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message);}}
    void Tick(){
        if(signals["exit"].WaitOne(0)){ExitThread();return;}if(signals["show"].WaitOne(0))ShowWindow();if(signals["stop"].WaitOne(0))Stop();
        if(signals["simhub-on"].WaitOne(0))SetSim(true);if(signals["simhub-off"].WaitOne(0))SetSim(false);
        if(signals["moza-on"].WaitOne(0))SetMoza(true);if(signals["moza-off"].WaitOne(0))SetMoza(false);Refresh();
    }
    Dictionary<string,object> Read(string file){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(run,file)));}
    void Refresh(){
        if(running){bool failed=false;foreach(var p in workers)if(p.HasExited)failed=true;if(failed){lastError="Приёмник завершился. См. runtime\\app.log";simEnabled=false;StopMoza();StopWorkers();running=false;}}
        if(mozaHost!=null&&mozaHost.HasExited){mozaError="DCS-мост завершился. См. runtime\\moza-status.json";try{var m=Read("moza-status.json");if(m.ContainsKey("error"))mozaError=Convert.ToString(m["error"]);}catch{}StopMoza();}
        string state=running?"Ожидание телеметрии игры":"Приём остановлен",ship="—",values="—",mozaState="MOZA выключена";long frames=0,sent=0,errors=0,mozaSent=0;bool receiving=false,connected=false;
        if(lastError.Length>0)state="Ошибка приёма";
        if(running)try{
            var d=Read("status.json");if(DateTime.Parse(Convert.ToString(d["started"])).ToUniversalTime()>=started.AddSeconds(-1)){
                frames=Convert.ToInt64(d["vehicle_frames"]);sent=Convert.ToInt64(d["sent"]);errors=Convert.ToInt64(d["errors"]);
                if(d.ContainsKey("ship"))ship=Convert.ToString(d["ship"]);
                double dt=(DateTime.UtcNow-previousSample).TotalSeconds;if(dt>=.8){rate=Math.Max(0,(frames-previousFrames)/dt);previousFrames=frames;previousSample=DateTime.UtcNow;}
                receiving=d["last_at"]!=null&&(DateTime.UtcNow-DateTime.Parse(Convert.ToString(d["last_at"])).ToUniversalTime()).TotalSeconds<2.5;
                if(receiving)state=Convert.ToBoolean(d["session_active"])?"Телеметрия корабля поступает":"Поток: вне корабля";
                if(d["last_acceleration_m_s2"]!=null){var a=(Dictionary<string,object>)d["last_acceleration_m_s2"];values=String.Format("X {0:F2}    Y {1:F2}    Z {2:F2} м/с²",Convert.ToDouble(a["x"]),Convert.ToDouble(a["y"]),Convert.ToDouble(a["z"]));}
            }
        }catch{}
        if(mozaEnabled){mozaState="MOZA: ожидание пилота / Cockpit";try{var m=Read("moza-status.json");if(DateTime.Parse(Convert.ToString(m["updated_at"])).ToUniversalTime()>=mozaStarted.AddSeconds(-1)){connected=Convert.ToBoolean(m["connected"]);mozaSent=Convert.ToInt64(m["sent"]);mozaState=connected?"MOZA подключена • кадров TCP: "+mozaSent:Convert.ToBoolean(m["active"])?"MOZA: поток готов, ожидание Cockpit":"MOZA: ожидание пилота / свежих данных";}}catch{}}
        if(mozaError.Length>0)mozaState="MOZA: "+mozaError;
        stateLabel.Text=state;stateItem.Text=state;tray.Text="SC | SimHub "+(simEnabled?"ON":"OFF")+" | MOZA "+(mozaEnabled?"ON":"OFF");
        detailLabel.Text=lastError.Length>0?lastError:String.Format("Корабль: {0}\r\nПоток: {1:F0} Гц   •   кадров: {2:N0}\r\n{3}\r\nSimHub: {4:N0} пакетов   •   ошибок: {5}",ship,rate,frames,values,sent,errors);
        simButton.Text=simItem.Text=simEnabled?"SimHub: ВКЛ — выключить":"SimHub: ВЫКЛ — включить";
        mozaButton.Text=mozaItem.Text=mozaEnabled?"MOZA: ВКЛ — выключить":"MOZA: ВЫКЛ — включить";
        mozaLabel.Text=mozaState+"\r\nTCP "+Setting("MozaTcpPort","3476")+" • DCS.exe запускается и закрывается этой кнопкой.\r\nВыключение выхода сохраняет подключение игры.";
        try{File.WriteAllText(Path.Combine(run,"app-status.json"),json.Serialize(new{pid=Process.GetCurrentProcess().Id,running=running,simhub_enabled=simEnabled,moza_enabled=mozaEnabled,moza_connected=connected,receiving=receiving,state=state,sent=sent,rate_hz=rate,errors=errors,last_error=lastError,moza_error=mozaError,updated_at=DateTime.UtcNow.ToString("o")}));}catch(IOException){}
    }
    protected override void ExitThreadCore(){exiting=true;timer.Stop();Stop();tray.Visible=false;tray.Dispose();window.Dispose();timer.Dispose();foreach(var s in signals.Values)s.Dispose();base.ExitThreadCore();}
}
