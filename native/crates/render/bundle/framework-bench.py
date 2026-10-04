#!/usr/bin/env python3
"""Run inside the measurement image: one isolate, Axum channel vs Actix worker."""
import json
import os
import subprocess
import time
import urllib.request


def usage(pid):
    fields = open(f'/proc/{pid}/stat').read().split()
    cpu = (int(fields[13]) + int(fields[14])) / os.sysconf('SC_CLK_TCK') * 1000
    memory = {}
    for line in open(f'/proc/{pid}/status'):
        if line.startswith(('VmRSS:', 'VmHWM:')):
            key, value, _ = line.split()
            memory[key[:-1]] = int(value) / 1024
    return cpu, memory


for run in range(3):
    for page in ('timer', 'week'):
        for mode in (('axum', 'actix') if run % 2 == 0 else ('actix', 'axum')):
            server = subprocess.Popen(['/usr/local/bin/render-host', mode, '/results', '8080'], stdout=subprocess.DEVNULL)
            try:
                url = 'http://127.0.0.1:8080/lumen/' + ('reports?range=this-week' if page == 'week' else 'timer')
                for _ in range(200):
                    try:
                        with urllib.request.urlopen(url) as response:
                            html = response.read()
                        break
                    except OSError:
                        if server.poll() is not None:
                            raise RuntimeError('Host exited')
                        time.sleep(.05)
                else:
                    raise RuntimeError('Host did not start')
                for _ in range(49):
                    with urllib.request.urlopen(url) as response:
                        response.read()
                before = usage(server.pid)[0]
                times = []
                samples = []
                for i in range(500):
                    started = time.monotonic()
                    with urllib.request.urlopen(url) as response:
                        html = response.read()
                    if b"This page didn't load" in html:
                        raise RuntimeError('Rendered error page')
                    times.append((time.monotonic() - started) * 1000)
                    if i % 25 == 0:
                        samples.append(usage(server.pid)[1]['VmRSS'])
                cpu, memory = usage(server.pid)
                time.sleep(2.1)
                idle = usage(server.pid)[1]['VmRSS']
                times.sort()
                print(json.dumps(dict(run=run+1, page=page, mode=mode, count=500, bytes=len(html),
                                     cpu_ms=(cpu-before)/500, p50_ms=times[250], p95_ms=times[475],
                                     loop_rss_mb=memory['VmRSS'], peak_rss_mb=memory['VmHWM'],
                                     idle_rss_mb=idle, rss_samples_mb=samples)), flush=True)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
