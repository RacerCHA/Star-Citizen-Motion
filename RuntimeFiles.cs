// SPDX-License-Identifier: GPL-3.0-or-later
using System;
using System.IO;

static class RuntimeFiles {
    // Read a complete atomic snapshot without blocking its writer's replacement.
    public static string ReadText(string path) {
        using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
        using(var reader=new StreamReader(file))return reader.ReadToEnd();
    }
    public static bool TryWriteSnapshot(string path,string text) {
        try {
            string temp=path+"."+System.Diagnostics.Process.GetCurrentProcess().Id+".tmp";
            File.WriteAllText(temp,text);
            if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
            return true;
        }catch(IOException){return false;}catch(UnauthorizedAccessException){return false;}
    }
}
