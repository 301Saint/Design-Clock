import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Optional, non-invasive idle detection. On Windows it asks the OS a single
 * question every 5 seconds: "how long since the last keyboard/mouse input?"
 * (GetLastInputInfo). Nothing about *what* was typed or where the mouse went is
 * read or stored.
 */
const PS_SCRIPT = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DCIdle {
  [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
  public static uint Seconds() { var l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000; }
}
'@
while ($true) { [Console]::Out.WriteLine([DCIdle]::Seconds()); [Console]::Out.Flush(); Start-Sleep -Seconds 5 }
`;

export type IdleEpisode = { startAt: number; endAt: number | null };

export class IdleMonitor {
  private proc: ChildProcess | null = null;
  idleSec = 0;
  episode: IdleEpisode | null = null;
  thresholdSec = 600;
  supported = process.platform === 'win32';

  start() {
    if (this.proc || !this.supported) return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let buf = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const n = Number(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
        if (Number.isFinite(n)) this.sample(n);
      }
    });
    proc.on('exit', () => { if (this.proc === proc) this.proc = null; });
    this.proc = proc;
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
    this.episode = null;
  }

  private sample(idleSec: number) {
    const now = Date.now();
    this.idleSec = idleSec;
    if (idleSec >= this.thresholdSec) {
      if (!this.episode || this.episode.endAt !== null) {
        this.episode = { startAt: now - idleSec * 1000, endAt: null };
      }
    } else if (this.episode && this.episode.endAt === null) {
      this.episode.endAt = now - idleSec * 1000;
    }
  }

  /** Idle seconds that overlap [from, to]. Open episodes count up to the last input. */
  overlap(from: number, to: number): number {
    const ep = this.episode;
    if (!ep) return 0;
    const end = ep.endAt ?? Date.now();
    const s = Math.max(from, ep.startAt);
    const e = Math.min(to, end);
    return e > s ? Math.floor((e - s) / 1000) : 0;
  }

  clear() { this.episode = null; }
}
