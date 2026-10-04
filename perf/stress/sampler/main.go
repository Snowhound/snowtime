// The load benchmark's sampler (task 078, perf/README.md). Once a second it reads the app's,
// Caddy's, and its own cgroup v2 counters, the host's CPU and memory, and the database's size,
// and keeps the last four hours. Caddy serves it behind basic auth:
//
//	GET /_bench/samples?since=<unix seconds>  samples after that time, as JSON
//	GET /_bench/log?offset=<bytes>            the benchmark's requests from Caddy's access log
//	GET /_bench/log?offset=end                the log's size, to read only later requests
//
// With APP_URL set, each sample also has the app's JS heap from /api/bench/heap, and how long
// the app took to answer: a stalled app shows as a slow or missing answer.
//
// It runs in the host's PID and cgroup namespaces and finds each container's cgroup through
// /proc/<pid>/cgroup, so it needs no Docker socket, which would give root on the host.
package main

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const keep = 4 * 60 * 60

// Processes by their command name (comm, at most 15 characters).
var watched = map[string]string{"snowtime": "app", "caddy": "caddy"}

type Container struct {
	CPUUsec       int64 `json:"cpuUsec"`
	UserUsec      int64 `json:"userUsec"`
	SystemUsec    int64 `json:"systemUsec"`
	Throttled     int64 `json:"throttled"`
	ThrottledUsec int64 `json:"throttledUsec"`
	Memory        int64 `json:"memory"`
	MemoryPeak    int64 `json:"memoryPeak"`
	Anon          int64 `json:"anon"`
	File          int64 `json:"file"`
	ReadBytes     int64 `json:"readBytes"`
	WriteBytes    int64 `json:"writeBytes"`
	OOMKills      int64 `json:"oomKills"`
	// Pressure stall totals in microseconds: some, and for memory and IO also full.
	CPUSome    int64 `json:"cpuSome"`
	MemorySome int64 `json:"memorySome"`
	MemoryFull int64 `json:"memoryFull"`
	IOSome     int64 `json:"ioSome"`
	IOFull     int64 `json:"ioFull"`
	// The main process's resident memory, from /proc/<pid>/status.
	RSS int64 `json:"rss"`
}

type Sample struct {
	Time float64 `json:"t"`
	// The host's CPU time in clock ticks since boot, from /proc/stat.
	CPU          map[string]int64      `json:"cpu"`
	MemTotal     int64                 `json:"memTotal"`
	MemAvailable int64                 `json:"memAvailable"`
	DiskUsed     int64                 `json:"diskUsed"`
	DiskTotal    int64                 `json:"diskTotal"`
	Files        map[string]int64      `json:"files"`
	Containers   map[string]*Container `json:"containers"`
	// The sampler's own time spent reading, in microseconds.
	ReadUsec int64 `json:"readUsec"`
	Heap     *Heap `json:"heap,omitempty"`
}

// The app's process.memoryUsage(), in bytes, and how long it took to answer. An answer that
// took longer than the timeout has only AnswerMs.
type Heap struct {
	RSS          int64 `json:"rss"`
	HeapTotal    int64 `json:"heapTotal"`
	HeapUsed     int64 `json:"heapUsed"`
	External     int64 `json:"external"`
	ArrayBuffers int64 `json:"arrayBuffers"`
	AnswerMs     int64 `json:"answerMs"`
}

var (
	mu      sync.Mutex
	samples []Sample
	// Container name to its cgroup folder and main process.
	groups  = map[string]group{}
	dataDir = env("DATA_DIR", "/data")
	logFile = env("ACCESS_LOG", "/var/log/caddy/access.log")
	appURL  = os.Getenv("APP_URL")
	client  = &http.Client{Timeout: heapTimeout}
)

const heapTimeout = 500 * time.Millisecond

type group struct {
	path string
	pid  int
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	go func() {
		next := time.Now().Truncate(time.Second)
		for i := 0; ; i++ {
			// Processes restart, so the cgroups are looked up again every 10 seconds.
			if i%10 == 0 {
				findGroups()
			}
			next = next.Add(time.Second)
			time.Sleep(time.Until(next))
			sample := read()
			mu.Lock()
			samples = append(samples, sample)
			if len(samples) > keep {
				samples = append([]Sample(nil), samples[len(samples)-keep:]...)
			}
			mu.Unlock()
		}
	}()
	http.HandleFunc("/_bench/samples", serveSamples)
	http.HandleFunc("/_bench/log", serveLog)
	log.Fatal(http.ListenAndServe(env("LISTEN", ":9100"), nil))
}

func findGroups() {
	found := map[string]group{"sampler": {cgroupOf(os.Getpid()), os.Getpid()}}
	entries, _ := os.ReadDir("/proc")
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		comm, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "comm"))
		if err != nil {
			continue
		}
		name, ok := watched[strings.TrimSpace(string(comm))]
		if !ok {
			continue
		}
		// The container's first process, which has the lowest PID, is its main one.
		if current, seen := found[name]; seen && current.pid < pid {
			continue
		}
		found[name] = group{cgroupOf(pid), pid}
	}
	mu.Lock()
	groups = found
	mu.Unlock()
}

func cgroupOf(pid int) string {
	text, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(text), "\n") {
		if path, ok := strings.CutPrefix(line, "0::"); ok {
			return filepath.Join("/sys/fs/cgroup", path)
		}
	}
	return ""
}

func read() Sample {
	started := time.Now()
	var self syscall.Rusage
	syscall.Getrusage(syscall.RUSAGE_SELF, &self)
	sample := Sample{
		Time:       float64(started.UnixMilli()) / 1000,
		CPU:        hostCPU(),
		Files:      map[string]int64{},
		Containers: map[string]*Container{},
	}
	meminfo := keyed("/proc/meminfo")
	sample.MemTotal = meminfo["MemTotal"] * 1024
	sample.MemAvailable = meminfo["MemAvailable"] * 1024
	var disk syscall.Statfs_t
	if syscall.Statfs(dataDir, &disk) == nil {
		sample.DiskTotal = int64(disk.Blocks) * disk.Bsize
		sample.DiskUsed = int64(disk.Blocks-disk.Bfree) * disk.Bsize
	}
	for _, name := range []string{"snowtime.db", "snowtime.db-wal", "snowtime.db-journal"} {
		if info, err := os.Stat(filepath.Join(dataDir, name)); err == nil {
			sample.Files[name] = info.Size()
		}
	}
	mu.Lock()
	current := groups
	mu.Unlock()
	for name, g := range current {
		if g.path != "" {
			sample.Containers[name] = container(g)
		}
	}
	if appURL != "" {
		sample.Heap = heap()
	}
	var after syscall.Rusage
	syscall.Getrusage(syscall.RUSAGE_SELF, &after)
	sample.ReadUsec = usec(after.Utime) + usec(after.Stime) - usec(self.Utime) - usec(self.Stime)
	return sample
}

func heap() *Heap {
	started := time.Now()
	h := &Heap{}
	response, err := client.Get(appURL + "/api/bench/heap")
	if err == nil {
		json.NewDecoder(response.Body).Decode(h)
		response.Body.Close()
	}
	h.AnswerMs = time.Since(started).Milliseconds()
	return h
}

func usec(t syscall.Timeval) int64 { return t.Sec*1_000_000 + int64(t.Usec) }

func container(g group) *Container {
	cpu := keyed(filepath.Join(g.path, "cpu.stat"))
	memory := keyed(filepath.Join(g.path, "memory.stat"))
	events := keyed(filepath.Join(g.path, "memory.events"))
	c := &Container{
		CPUUsec:       cpu["usage_usec"],
		UserUsec:      cpu["user_usec"],
		SystemUsec:    cpu["system_usec"],
		Throttled:     cpu["nr_throttled"],
		ThrottledUsec: cpu["throttled_usec"],
		Memory:        number(filepath.Join(g.path, "memory.current")),
		MemoryPeak:    number(filepath.Join(g.path, "memory.peak")),
		Anon:          memory["anon"],
		File:          memory["file"],
		OOMKills:      events["oom_kill"],
		RSS:           keyed(filepath.Join("/proc", strconv.Itoa(g.pid), "status"))["VmRSS"] * 1024,
	}
	c.ReadBytes, c.WriteBytes = ioBytes(filepath.Join(g.path, "io.stat"))
	c.CPUSome, _ = pressure(filepath.Join(g.path, "cpu.pressure"))
	c.MemorySome, c.MemoryFull = pressure(filepath.Join(g.path, "memory.pressure"))
	c.IOSome, c.IOFull = pressure(filepath.Join(g.path, "io.pressure"))
	return c
}

// Lines of "key value" or "key: value kB", as cgroup and /proc files have them.
func keyed(path string) map[string]int64 {
	values := map[string]int64{}
	text, err := os.ReadFile(path)
	if err != nil {
		return values
	}
	for _, line := range strings.Split(string(text), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if n, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
			values[strings.TrimSuffix(fields[0], ":")] = n
		}
	}
	return values
}

func number(path string) int64 {
	text, _ := os.ReadFile(path)
	n, _ := strconv.ParseInt(strings.TrimSpace(string(text)), 10, 64)
	return n
}

func hostCPU() map[string]int64 {
	text, _ := os.ReadFile("/proc/stat")
	line, _, _ := strings.Cut(string(text), "\n")
	fields := strings.Fields(line)
	names := []string{"user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"}
	values := map[string]int64{}
	for i, name := range names {
		if i+1 < len(fields) {
			values[name], _ = strconv.ParseInt(fields[i+1], 10, 64)
		}
	}
	return values
}

// Read and written bytes over every device, from lines like "8:0 rbytes=1 wbytes=2 ...".
func ioBytes(path string) (read, written int64) {
	text, _ := os.ReadFile(path)
	for _, field := range strings.Fields(string(text)) {
		key, value, _ := strings.Cut(field, "=")
		n, _ := strconv.ParseInt(value, 10, 64)
		switch key {
		case "rbytes":
			read += n
		case "wbytes":
			written += n
		}
	}
	return
}

// The "total=" of the some and full lines of a pressure file.
func pressure(path string) (some, full int64) {
	text, _ := os.ReadFile(path)
	for _, line := range strings.Split(string(text), "\n") {
		_, total, ok := strings.Cut(line, "total=")
		if !ok {
			continue
		}
		n, _ := strconv.ParseInt(strings.TrimSpace(total), 10, 64)
		if strings.HasPrefix(line, "some") {
			some = n
		} else {
			full = n
		}
	}
	return
}

func serveSamples(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseFloat(r.URL.Query().Get("since"), 64)
	mu.Lock()
	var result []Sample
	for _, s := range samples {
		if s.Time > since {
			result = append(result, s)
		}
	}
	mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// One request the load generator sent, as Caddy logged it. Kind and step come from the
// X-Bench-Kind and X-Bench-Step headers that the generator adds.
type Request struct {
	Time     float64 `json:"t"`
	Kind     string  `json:"kind"`
	Step     string  `json:"step"`
	Status   int     `json:"status"`
	Duration float64 `json:"duration"`
	Size     int64   `json:"size"`
}

type logLine struct {
	Time    float64 `json:"ts"`
	Request struct {
		Headers map[string][]string `json:"headers"`
	} `json:"request"`
	Duration float64 `json:"duration"`
	Size     int64   `json:"size"`
	Status   int     `json:"status"`
}

// Whole lines from offset on, at most 64 MB at a time; the response says where to go on and
// whether more is there.
func serveLog(w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	file, err := os.Open(logFile)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer file.Close()
	if r.URL.Query().Get("offset") == "end" {
		info, err := file.Stat()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"offset": info.Size(), "more": false, "requests": []Request{}})
		return
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	reader := bufio.NewReaderSize(io.LimitReader(file, 64<<20), 1<<20)
	requests := []Request{}
	start := offset
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			break
		}
		offset += int64(len(line))
		var entry logLine
		if json.Unmarshal(line, &entry) != nil {
			continue
		}
		kind := entry.Request.Headers["X-Bench-Kind"]
		if len(kind) == 0 {
			continue
		}
		step := entry.Request.Headers["X-Bench-Step"]
		request := Request{entry.Time, kind[0], "", entry.Status, entry.Duration, entry.Size}
		if len(step) > 0 {
			request.Step = step[0]
		}
		requests = append(requests, request)
	}
	w.Header().Set("Content-Type", "application/json")
	// A full read leaves more for the next request.
	more := offset-start > 60<<20
	json.NewEncoder(w).Encode(map[string]any{"offset": offset, "more": more, "requests": requests})
}
