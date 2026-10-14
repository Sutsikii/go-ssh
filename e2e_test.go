package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// testServer is an SSH server in the process: exec requests answer the
// statistics script or "ran: <command>", shells echo what they get.
func testServer(t *testing.T) (host string, port int) {
	t.Helper()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(priv)
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pw []byte) (*ssh.Permissions, error) {
			if c.User() == "ops" && string(pw) == "pw" {
				return nil, nil
			}
			return nil, errors.New("denied")
		},
	}
	cfg.AddHostKey(signer)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			nc, err := ln.Accept()
			if err != nil {
				return
			}
			go serveConn(nc, cfg)
		}
	}()
	addr := ln.Addr().(*net.TCPAddr)
	return "127.0.0.1", addr.Port
}

func serveConn(nc net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, err := ssh.NewServerConn(nc, cfg)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nch := range chans {
		if nch.ChannelType() == "direct-tcpip" {
			go forward(nch)
			continue
		}
		ch, reqs, err := nch.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer ch.Close()
			for r := range reqs {
				switch r.Type {
				case "pty-req", "env", "window-change":
					r.Reply(true, nil)
				case "exec":
					r.Reply(true, nil)
					cmd := string(r.Payload[4:])
					code := 0
					switch {
					case strings.Contains(cmd, "@@stat"):
						io.WriteString(ch, "@@host\ntest-box\n@@os\nTestOS 1\n"+statsOut1)
					case cmd == "fail":
						io.WriteString(ch.Stderr(), "boom\n")
						code = 3
					default:
						io.WriteString(ch, "ran: "+cmd+"\n")
					}
					ch.SendRequest("exit-status", false, binary.BigEndian.AppendUint32(nil, uint32(code)))
					return
				case "shell":
					r.Reply(true, nil)
					io.WriteString(ch, "$ ")
					buf := make([]byte, 1024)
					for {
						n, err := ch.Read(buf)
						if n > 0 {
							if string(buf[:n]) == "exit\r" {
								ch.SendRequest("exit-status", false, binary.BigEndian.AppendUint32(nil, 7))
								return
							}
							ch.Write(buf[:n])
						}
						if err != nil {
							return
						}
					}
				default:
					r.Reply(false, nil)
				}
			}
		}()
	}
}

// forward serves a ProxyJump's connection.
func forward(nch ssh.NewChannel) {
	var to struct {
		Host     string
		Port     uint32
		FromHost string
		FromPort uint32
	}
	if err := ssh.Unmarshal(nch.ExtraData(), &to); err != nil {
		nch.Reject(ssh.ConnectionFailed, err.Error())
		return
	}
	nc, err := net.Dial("tcp", net.JoinHostPort(to.Host, strconv.Itoa(int(to.Port))))
	if err != nil {
		nch.Reject(ssh.ConnectionFailed, err.Error())
		return
	}
	ch, reqs, err := nch.Accept()
	if err != nil {
		nc.Close()
		return
	}
	go ssh.DiscardRequests(reqs)
	go func() { io.Copy(nc, ch); nc.Close() }()
	io.Copy(ch, nc)
	ch.Close()
}

func TestEndToEnd(t *testing.T) {
	host, port := testServer(t)
	h := newTestHub(t)
	pw := "pw"
	inv, err := Servers{h}.Save(ServerInput{Server: Server{Name: "box", Host: host, Port: port, User: "ops", KeyPath: ""}, Password: &pw})
	if err != nil {
		t.Fatal(err)
	}
	id := inv.Servers[0].ID
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Unknown host key, then trusted.
	_, err = Monitor{h}.Test(ctx, id)
	var hk *HostKeyError
	if !errors.As(err, &hk) || hk.Changed || !strings.HasPrefix(hk.Fingerprint, "SHA256:") {
		t.Fatalf("first connection: %v", err)
	}
	if !strings.HasPrefix(err.Error(), "hostkey:{") {
		t.Errorf("error text %q", err)
	}
	if err := (Monitor{h}).TrustHostKey(id, hk.Host); err != nil {
		t.Fatal(err)
	}
	if _, err := (Monitor{h}).Test(ctx, id); err != nil {
		t.Fatalf("after trusting: %v", err)
	}
	if kh := (Monitor{h}).KnownHosts(); len(kh) != 1 || !strings.Contains(kh[0].Hosts, strconv.Itoa(port)) {
		t.Errorf("known hosts %+v", kh)
	}

	// A second server on the same address, through the first.
	inv, _ = Servers{h}.Save(ServerInput{Server: Server{Name: "inner", Host: host, Port: port, User: "ops", JumpID: id}, Password: &pw})
	inner := inv.Servers[1].ID
	if _, err := (Monitor{h}).Test(ctx, inner); err != nil { // its key is known by host:port already
		t.Fatalf("through jump: %v", err)
	}

	// Commands on both.
	var mu sync.Mutex
	got := map[string]string{}
	codes := map[string]int{}
	err = Bulk{h}.run(ctx, []string{id, inner}, "uptime", 4, func(e BulkEvent) error {
		mu.Lock()
		defer mu.Unlock()
		switch e.Kind {
		case "output":
			got[e.ServerID] += e.Data
		case "done":
			codes[e.ServerID] = e.Code
			if e.Error != "" {
				t.Errorf("%s: %s", e.ServerID, e.Error)
			}
		}
		return nil
	})
	if err != nil || got[id] != "ran: uptime\n" || got[inner] != "ran: uptime\n" || len(codes) != 2 {
		t.Errorf("bulk: %v %q %v", err, got, codes)
	}
	Bulk{h}.run(ctx, []string{id}, "fail", 1, func(e BulkEvent) error {
		if e.Kind == "done" && e.Code != 3 {
			t.Errorf("exit code %d", e.Code)
		}
		if e.Kind == "output" && e.Data != "boom\n" {
			t.Errorf("stderr %q", e.Data)
		}
		return nil
	})

	// A terminal.
	tid, err := Terminals{h}.Open(ctx, id, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	var outMu sync.Mutex
	done := make(chan int)
	go func() {
		code, _ := Terminals{h}.stream(ctx, tid, func(b []byte) error {
			outMu.Lock()
			out.Write(b)
			outMu.Unlock()
			return nil
		})
		done <- code
	}()
	Terminals{h}.Resize(tid, 100, 30)
	Terminals{h}.Write(tid, "hello")
	time.Sleep(200 * time.Millisecond)
	Terminals{h}.Write(tid, "exit\r")
	select {
	case code := <-done:
		if code != 7 {
			t.Errorf("exit code %d", code)
		}
	case <-ctx.Done():
		t.Fatal("terminal did not end")
	}
	if s := out.String(); s != "$ hello" {
		t.Errorf("terminal printed %q", s)
	}

	// Statistics.
	Servers{h}.SetMonitor([]string{id}, true)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, st := range (Monitor{h}).Statuses() {
			if st.ID == id && st.State == StateOnline && st.Info != nil {
				if st.Info.Hostname != "test-box" || len(st.Disks) != 2 || st.Latest == nil {
					t.Errorf("status %+v", st)
				}
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Errorf("never online: %+v", (Monitor{h}).Statuses())
}

func TestWrongPassword(t *testing.T) {
	host, port := testServer(t)
	h := newTestHub(t)
	pw := "nope"
	inv, _ := Servers{h}.Save(ServerInput{Server: Server{Host: host, Port: port, User: "ops"}, Password: &pw})
	id := inv.Servers[0].ID
	ctx := context.Background()
	_, err := (Monitor{h}).Test(ctx, id)
	var hk *HostKeyError
	if errors.As(err, &hk) {
		(Monitor{h}).TrustHostKey(id, hk.Host)
		_, err = (Monitor{h}).Test(ctx, id)
	}
	if err == nil || !strings.Contains(err.Error(), "authentification refusée") {
		t.Errorf("err = %v", err)
	}
}
