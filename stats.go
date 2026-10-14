package main

import (
	"bufio"
	"regexp"
	"strconv"
	"strings"
)

// The statistics come from one shell command per poll, which reads /proc
// and df: nothing to install on the servers. Sections start with "@@name".

const infoScript = `export LC_ALL=C
echo @@host; hostname 2>/dev/null || uname -n
echo @@os; if [ -r /etc/os-release ]; then . /etc/os-release; echo "$PRETTY_NAME"; else uname -s; fi
echo @@kernel; uname -r
echo @@arch; uname -m
echo @@cpu; grep -m1 -E 'model name|Hardware|Model' /proc/cpuinfo 2>/dev/null | cut -d: -f2-
echo @@ncpu; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
echo @@ip; hostname -I 2>/dev/null
`

const statsScript = `export LC_ALL=C
echo @@stat; head -1 /proc/stat
echo @@mem; cat /proc/meminfo
echo @@load; cat /proc/loadavg
echo @@uptime; cat /proc/uptime
echo @@net; cat /proc/net/dev
echo @@diskio; cat /proc/diskstats
echo @@df; df -PTk 2>/dev/null || df -Pk
`

// SysInfo describes a server's system, read once per connection.
type SysInfo struct {
	Hostname string   `json:"hostname"`
	OS       string   `json:"os"`
	Kernel   string   `json:"kernel"`
	Arch     string   `json:"arch"`
	CPU      string   `json:"cpu"`
	CPUs     int      `json:"cpus"`
	IPs      []string `json:"ips"`
}

// Sample is one poll's statistics. Rates are per second since the
// previous poll.
type Sample struct {
	T         int64   `json:"t"` // Unix milliseconds
	CPU       float64 `json:"cpu"`
	User      float64 `json:"user"`
	System    float64 `json:"system"`
	IOWait    float64 `json:"iowait"`
	MemUsed   uint64  `json:"memUsed"`
	MemTotal  uint64  `json:"memTotal"`
	SwapUsed  uint64  `json:"swapUsed"`
	SwapTotal uint64  `json:"swapTotal"`
	Load1     float64 `json:"load1"`
	Load5     float64 `json:"load5"`
	Load15    float64 `json:"load15"`
	Rx        float64 `json:"rx"`    // bytes/s
	Tx        float64 `json:"tx"`    // bytes/s
	Read      float64 `json:"read"`  // bytes/s
	Write     float64 `json:"write"` // bytes/s
}

// Disk is a mounted file system.
type Disk struct {
	Mount string `json:"mount"`
	FS    string `json:"fs"`
	Used  uint64 `json:"used"`  // bytes
	Total uint64 `json:"total"` // bytes
}

// counters are the cumulative values rates are computed from.
type counters struct {
	cpu          [8]uint64 // user nice system idle iowait irq softirq steal
	rx, tx       uint64
	read, write  uint64 // bytes
	interfaces   []string
	ok, hasCPU   bool
	uptime       float64
	disks        []Disk
	mem          map[string]uint64 // kB
	load1, load5 float64
	load15       float64
}

func sections(out string) map[string][]string {
	m := map[string][]string{}
	cur := ""
	sc := bufio.NewScanner(strings.NewReader(out))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if name, ok := strings.CutPrefix(line, "@@"); ok {
			cur = strings.TrimSpace(name)
			m[cur] = []string{}
			continue
		}
		if cur != "" {
			m[cur] = append(m[cur], line)
		}
	}
	return m
}

func first(lines []string) string {
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}

func parseInfo(out string) SysInfo {
	s := sections(out)
	info := SysInfo{
		Hostname: first(s["host"]),
		OS:       strings.Trim(first(s["os"]), `"`),
		Kernel:   first(s["kernel"]),
		Arch:     first(s["arch"]),
		CPU:      strings.Join(strings.Fields(first(s["cpu"])), " "),
		IPs:      strings.Fields(first(s["ip"])),
	}
	info.CPUs, _ = strconv.Atoi(first(s["ncpu"]))
	if info.IPs == nil {
		info.IPs = []string{}
	}
	return info
}

var wholeDisk = regexp.MustCompile(`^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$`)

var pseudoFS = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "overlay": true, "squashfs": true, "efivarfs": true,
	"proc": true, "sysfs": true, "devfs": true, "ramfs": true, "nsfs": true, "none": true,
	"udev": true, "shm": true, "cgroup": true, "cgroup2": true, "autofs": true,
}

func parseCounters(out string) counters {
	s := sections(out)
	var c counters

	if f := strings.Fields(first(s["stat"])); len(f) > 4 && f[0] == "cpu" {
		for i := 0; i < 8 && i+1 < len(f); i++ {
			c.cpu[i], _ = strconv.ParseUint(f[i+1], 10, 64)
		}
		c.hasCPU = true
		c.ok = true
	}

	c.mem = map[string]uint64{}
	for _, l := range s["mem"] {
		k, v, ok := strings.Cut(l, ":")
		if !ok {
			continue
		}
		f := strings.Fields(v)
		if len(f) > 0 {
			c.mem[k], _ = strconv.ParseUint(f[0], 10, 64)
		}
	}

	if f := strings.Fields(first(s["load"])); len(f) >= 3 {
		c.load1, _ = strconv.ParseFloat(f[0], 64)
		c.load5, _ = strconv.ParseFloat(f[1], 64)
		c.load15, _ = strconv.ParseFloat(f[2], 64)
	}
	if f := strings.Fields(first(s["uptime"])); len(f) > 0 {
		c.uptime, _ = strconv.ParseFloat(f[0], 64)
	}

	for _, l := range s["net"] {
		name, rest, ok := strings.Cut(l, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "lo" || strings.Contains(name, "|") {
			continue
		}
		f := strings.Fields(rest)
		if len(f) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(f[0], 10, 64)
		tx, _ := strconv.ParseUint(f[8], 10, 64)
		c.rx += rx
		c.tx += tx
		c.interfaces = append(c.interfaces, name)
	}

	for _, l := range s["diskio"] {
		f := strings.Fields(l)
		if len(f) < 10 || !wholeDisk.MatchString(f[2]) {
			continue
		}
		r, _ := strconv.ParseUint(f[5], 10, 64)
		w, _ := strconv.ParseUint(f[9], 10, 64)
		c.read += r * 512
		c.write += w * 512
	}

	c.disks = parseDF(s["df"])
	return c
}

// parseDF reads df -PTk (or df -Pk, without the type column).
func parseDF(lines []string) []Disk {
	disks := []Disk{}
	if len(lines) == 0 {
		return disks
	}
	typed := strings.Contains(lines[0], "Type")
	seen := map[string]bool{}
	for _, l := range lines[1:] {
		f := strings.Fields(l)
		dev, fs := "", ""
		var blocks, used string
		var mount string
		switch {
		case typed && len(f) >= 7:
			dev, fs, blocks, used, mount = f[0], f[1], f[2], f[3], strings.Join(f[6:], " ")
		case !typed && len(f) >= 6:
			dev, blocks, used, mount = f[0], f[1], f[2], strings.Join(f[5:], " ")
		default:
			continue
		}
		if pseudoFS[fs] || pseudoFS[dev] || strings.HasPrefix(fs, "fuse.") ||
			strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/run") ||
			strings.HasPrefix(mount, "/dev") || strings.HasPrefix(mount, "/sys") || strings.HasPrefix(mount, "/proc") {
			continue
		}
		total, _ := strconv.ParseUint(blocks, 10, 64)
		u, _ := strconv.ParseUint(used, 10, 64)
		if total == 0 || seen[dev+mount] {
			continue
		}
		seen[dev+mount] = true
		disks = append(disks, Disk{Mount: mount, FS: fs, Used: u * 1024, Total: total * 1024})
	}
	return disks
}

// sample computes the statistics of cur since prev, dt seconds earlier.
// Without prev, rates and CPU use are 0.
func sample(prev *counters, cur counters, t int64, dt float64) Sample {
	s := Sample{
		T:         t,
		MemTotal:  cur.mem["MemTotal"] * 1024,
		SwapTotal: cur.mem["SwapTotal"] * 1024,
		Load1:     cur.load1,
		Load5:     cur.load5,
		Load15:    cur.load15,
	}
	avail, ok := cur.mem["MemAvailable"]
	if !ok { // kernels before 3.14
		avail = cur.mem["MemFree"] + cur.mem["Buffers"] + cur.mem["Cached"]
	}
	if s.MemTotal >= avail*1024 {
		s.MemUsed = s.MemTotal - avail*1024
	}
	if free := cur.mem["SwapFree"] * 1024; s.SwapTotal >= free {
		s.SwapUsed = s.SwapTotal - free
	}
	if prev == nil || dt <= 0 {
		return s
	}
	var d [8]float64
	var total float64
	for i := range d {
		if cur.cpu[i] >= prev.cpu[i] {
			d[i] = float64(cur.cpu[i] - prev.cpu[i])
		}
		total += d[i]
	}
	if total > 0 && cur.hasCPU {
		pct := func(v float64) float64 { return round1(100 * v / total) }
		s.User = pct(d[0] + d[1])
		s.System = pct(d[2] + d[5] + d[6])
		s.IOWait = pct(d[4])
		s.CPU = pct(total - d[3] - d[4])
	}
	rate := func(a, b uint64) float64 {
		if b < a {
			return 0
		}
		return float64(b-a) / dt
	}
	s.Rx, s.Tx = rate(prev.rx, cur.rx), rate(prev.tx, cur.tx)
	s.Read, s.Write = rate(prev.read, cur.read), rate(prev.write, cur.write)
	return s
}

func round1(v float64) float64 { return float64(int(v*10+0.5)) / 10 }
