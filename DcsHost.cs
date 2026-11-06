// SPDX-License-Identifier: GPL-3.0-or-later
// Owns the DCS-compatible loopback TCP endpoint; never reads or injects into a game.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class DcsHost {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static int Option(string[] args,string key,int fallback){int i=Array.IndexOf(args,key);return i<0?fallback:int.Parse(args[i+1]);}
    static string TextOption(string[] args,string key,string fallback){int i=Array.IndexOf(args,key);return i<0?fallback:args[i+1];}
    static void Send(TcpClient client,string frame){byte[] b=Encoding.ASCII.GetBytes(frame);client.GetStream().Write(b,0,b.Length);}
    static void Close(ref TcpClient client){if(client==null)return;try{Send(client,"export_stop,true;");}catch(Exception){}client.Close();client=null;}
    static int Main(string[] args) {
        string status=TextOption(args,"--status",Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"runtime","moza-status.json"));
        int port=Option(args,"--port",3476),udpPort=Option(args,"--udp-port",56063),parentId=Option(args,"--parent",0);
        TcpListener listener=null;UdpClient udp=null;TcpClient client=null;Process parent=null;
        long received=0,sent=0;string error="",lastFrame=null;double lastFrameAt=-10000,lastSave=-10000,lastSent=-10000;
        var clock=Stopwatch.StartNew();bool active=false,stopped=false;int clients=0;
        Action save=delegate {
            Directory.CreateDirectory(Path.GetDirectoryName(status));string temp=status+".tmp";
            File.WriteAllText(temp,Json.Serialize(new{pid=Process.GetCurrentProcess().Id,port=port,udp_port=udpPort,active=active,connected=client!=null,clients=clients,received=received,sent=sent,stopped=stopped,error=error,updated_at=DateTime.UtcNow.ToString("o")}));
            if(File.Exists(status))File.Replace(temp,status,null);else File.Move(temp,status);
        };
        try {
            if(port<1||port>65535||udpPort<1||udpPort>65535||port==udpPort)throw new ArgumentException("Invalid ports");
            bool test=Array.IndexOf(args,"--test")>=0;
            if(!test){
                if(Process.GetCurrentProcess().ProcessName!="DCS")throw new Exception("MOZA host must be named DCS.exe");
                if(Process.GetProcessesByName("DCS").Length!=1)throw new Exception("Another DCS or Elite bridge is running");
            }
            if(parentId>0)parent=Process.GetProcessById(parentId);
            listener=new TcpListener(IPAddress.Loopback,port);listener.ExclusiveAddressUse=true;listener.Start(2);
            udp=new UdpClient(AddressFamily.InterNetwork);udp.ExclusiveAddressUse=true;udp.Client.Bind(new IPEndPoint(IPAddress.Loopback,udpPort));
            udp.Client.ReceiveTimeout=20;save();
            using(var stop=new EventWaitHandle(false,EventResetMode.ManualReset,"Local\\CHA.SC.MOZA.stop."+Process.GetCurrentProcess().Id)) {
                while(!stop.WaitOne(0)&&(parent==null||!parent.HasExited)) {
                    double now=clock.Elapsed.TotalMilliseconds;
                    if(udp.Available>0) {
                        var peer=new IPEndPoint(IPAddress.Loopback,0);byte[] bytes=udp.Receive(ref peer);
                        try {
                            var packet=Json.Deserialize<Packet>(Encoding.UTF8.GetString(bytes));
                            if(packet==null||packet.frame==null||packet.frame.Length>16000)continue;
                            double utcMs=(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;
                            if(packet.active&&(packet.valid_until_ms<=utcMs||packet.valid_until_ms>utcMs+500)){active=false;lastFrame=null;Close(ref client);continue;}
                            if(packet.active&&!packet.frame.StartsWith("aircraft_name,",StringComparison.Ordinal))continue;
                            received++;active=packet.active;lastFrame=packet.frame;lastFrameAt=now+Math.Min(350,packet.valid_until_ms-utcMs)-350;
                            if(!active){Close(ref client);lastFrame=null;}
                            else if(client!=null){try{Send(client,lastFrame);sent++;lastSent=now;}catch(IOException){Close(ref client);}catch(SocketException){Close(ref client);}}
                        }catch(ArgumentException){}catch(InvalidOperationException){}
                    } else Thread.Sleep(2);
                    now=clock.Elapsed.TotalMilliseconds;
                    if(now-lastFrameAt>350){active=false;lastFrame=null;Close(ref client);}
                    if(listener.Pending()) {
                        var candidate=listener.AcceptTcpClient();candidate.NoDelay=true;candidate.SendTimeout=100;
                        if(client!=null||!active){candidate.Close();}
                        else {client=candidate;clients++;try{Send(client,lastFrame);sent++;lastSent=now;}catch(IOException){Close(ref client);}}
                    }
                    // Repeat only a still-fresh source frame; never sustain stale game forces.
                    if(client!=null&&active&&now-lastSent>100){try{Send(client,lastFrame);sent++;lastSent=now;}catch(IOException){Close(ref client);}}
                    if(now-lastSave>=250){save();lastSave=now;}
                }
            }
        }catch(Exception e){error=e.Message;}
        finally{Close(ref client);if(listener!=null)listener.Stop();if(udp!=null)udp.Close();if(parent!=null)parent.Dispose();active=false;stopped=true;try{save();}catch(Exception){}}
        return error.Length==0?0:1;
    }
    public sealed class Packet {public bool active{get;set;}public string frame{get;set;}public double valid_until_ms{get;set;}}
}
