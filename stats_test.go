package main

import (
	"strings"
	"testing"
)

const statsOut1 = `@@stat
cpu  1000 0 500 8000 100 0 0 0 0 0
@@mem
MemTotal:        8000000 kB
MemFree:         1000000 kB
MemAvailable:    3000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
@@load
0.75 0.83 0.91 1/234 5678
@@uptime
3567890.12 123.4
@@net
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999 10 0 0 0 0 0 0 999999 10 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 10 0 0 0 0 0 0
@@diskio
   8       0 sda 100 0 2000 0 50 0 4000 0 0 0 0
   8       1 sda1 100 0 2000 0 50 0 4000 0 0 0 0
@@df
Filesystem     Type     1024-blocks     Used Available Capacity Mounted on
/dev/sda1      ext4        25000000 12500000  12500000      50% /
tmpfs          tmpfs        1000000        0   1000000       0% /run
/dev/sdb1      xfs        200000000 164000000 36000000     82% /var/lib/postgresql
`

func TestStats(t *testing.T) {
	c1 := parseCounters(statsOut1)
	if !c1.ok {
		t.Fatal("not ok")
	}
	out2 := strings.NewReplacer(
		"cpu  1000 0 500 8000 100", "cpu  1600 0 700 9100 200",
		"eth0: 1000", "eth0: 11000",
		"sda 100 0 2000 0 50 0 4000", "sda 100 0 4048 0 50 0 6048",
	).Replace(statsOut1)
	c2 := parseCounters(out2)
	s := sample(&c1, c2, 0, 2)
	// deltas: user 600, system 200, idle 1100, iowait 100 → 2000
	if s.CPU != 40 || s.User != 30 || s.System != 10 || s.IOWait != 5 {
		t.Errorf("cpu = %v/%v/%v/%v", s.CPU, s.User, s.System, s.IOWait)
	}
	if s.MemTotal != 8000000*1024 || s.MemUsed != 5000000*1024 || s.SwapUsed != 500000*1024 {
		t.Errorf("mem = %d/%d swap %d", s.MemUsed, s.MemTotal, s.SwapUsed)
	}
	if s.Rx != 5000 || s.Tx != 0 {
		t.Errorf("net = %v %v", s.Rx, s.Tx)
	}
	if s.Read != 2048*512/2 || s.Write != 2048*512/2 {
		t.Errorf("disk io = %v %v", s.Read, s.Write)
	}
	if s.Load1 != 0.75 || s.Load15 != 0.91 {
		t.Errorf("load = %v", s)
	}
	if len(c2.disks) != 2 || c2.disks[1].Mount != "/var/lib/postgresql" || c2.disks[0].Used != 12500000*1024 {
		t.Errorf("disks = %+v", c2.disks)
	}
	if len(c2.interfaces) != 1 || c2.interfaces[0] != "eth0" {
		t.Errorf("interfaces = %v", c2.interfaces)
	}
}

func TestStatsNotLinux(t *testing.T) {
	c := parseCounters("@@stat\nhead: /proc/stat: No such file\n@@df\nFilesystem 512-blocks\n")
	if c.ok {
		t.Error("ok without /proc")
	}
}

func TestDFUntyped(t *testing.T) {
	d := parseDF([]string{
		"Filesystem           1024-blocks    Used Available Capacity Mounted on",
		"/dev/root               100        40        60  40% /",
		"tmpfs                   10         0         10   0% /dev/shm",
	})
	if len(d) != 1 || d[0].Total != 100*1024 {
		t.Errorf("disks = %+v", d)
	}
}

func TestInfo(t *testing.T) {
	i := parseInfo("@@host\nweb-prod-1\n@@os\nUbuntu 24.04.1 LTS\n@@kernel\n6.8.0-45-generic\n@@arch\nx86_64\n@@cpu\n  AMD EPYC   7543\n@@ncpu\n4\n@@ip\n10.0.1.12 172.17.0.1 \n")
	if i.Hostname != "web-prod-1" || i.OS != "Ubuntu 24.04.1 LTS" || i.CPU != "AMD EPYC 7543" || i.CPUs != 4 || len(i.IPs) != 2 {
		t.Errorf("%+v", i)
	}
}
