package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// TestReal runs against real servers: GOSSH_REAL lists user:password@host:port
// separated by spaces, such as the docker containers of docs/development.md.
func TestReal(t *testing.T) {
	list := os.Getenv("GOSSH_REAL")
	if list == "" {
		t.Skip("GOSSH_REAL not set")
	}
	h := newTestHub(t)
	var ids []string
	for _, s := range strings.Fields(list) {
		cred, hostport, _ := strings.Cut(s, "@")
		user, pw, _ := strings.Cut(cred, ":")
		v, err := parseLine(user + "@" + hostport)
		if err != nil {
			t.Fatal(err)
		}
		inv, err := Servers{h}.Save(ServerInput{Server: v, Password: &pw})
		if err != nil {
			t.Fatal(err)
		}
		id := inv.Servers[len(inv.Servers)-1].ID
		ids = append(ids, id)
		ctx := context.Background()
		_, err = Monitor{h}.Test(ctx, id)
		if hk, ok := err.(*HostKeyError); ok {
			Monitor{h}.TrustHostKey(id, hk.Host)
			_, err = Monitor{h}.Test(ctx, id)
		}
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	err := Bulk{h}.run(context.Background(), ids, "uname -sr; id -un", 8, func(e BulkEvent) error {
		if e.Kind == "output" {
			t.Logf("%s: %q", e.ServerID, e.Data)
		}
		if e.Kind == "done" && (e.Code != 0 || e.Error != "") {
			t.Errorf("%s: code %d %s", e.ServerID, e.Code, e.Error)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	Servers{h}.SetMonitor(ids, true)
	time.Sleep(time.Duration(h.settings.Interval+2) * time.Second)
	for _, st := range (Monitor{h}).Statuses() {
		t.Logf("%s %s info=%+v latest=%+v disks=%+v ifaces=%v err=%q", st.ID, st.State, st.Info, st.Latest, st.Disks, st.Ifaces, st.Error)
		if st.State != StateOnline || !st.Linux || st.Latest == nil || len(st.Disks) == 0 {
			t.Errorf("%s: incomplete status", st.ID)
		}
	}
}
