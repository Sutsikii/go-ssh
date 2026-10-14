package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestHub(t *testing.T) *Hub {
	t.Helper()
	h, err := NewHub(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestParseLine(t *testing.T) {
	for in, want := range map[string]Server{
		"root@10.0.0.1:2222 web 1": {User: "root", Host: "10.0.0.1", Port: 2222, Name: "web 1"},
		"db.example.com":           {Host: "db.example.com", Port: 22, Name: "db.example.com"},
		"admin@[::1]:22":           {User: "admin", Host: "::1", Port: 22, Name: "::1"},
	} {
		v, err := parseLine(in)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if v.User != want.User || v.Host != want.Host || v.Port != want.Port || v.Name != want.Name {
			t.Errorf("%q = %+v", in, v)
		}
	}
	if _, err := parseLine("root@host:abc"); err == nil {
		t.Error("bad port accepted")
	}
}

func TestStoreRoundTrip(t *testing.T) {
	h := newTestHub(t)
	s := Servers{h}
	pw := "s3cret"
	inv, err := s.Save(ServerInput{Server: Server{Host: "10.0.0.1", User: "root", Group: "Prod", Tags: []string{"web", " web ", ""}}, Password: &pw})
	if err != nil {
		t.Fatal(err)
	}
	v := inv.Servers[0]
	if v.Port != 22 || v.Name != "10.0.0.1" || !v.HasPassword || len(v.Tags) != 1 || inv.Groups[0] != "Prod" {
		t.Errorf("saved %+v groups %v", v, inv.Groups)
	}
	raw, _ := os.ReadFile(filepath.Join(h.dir, "servers.json"))
	if strings.Contains(string(raw), pw) && platformEncrypts {
		t.Error("password saved in clear")
	}

	r, _ := s.AddMany("root@10.0.0.1\nadmin@10.0.0.2:2222 db\n# comment\nbad@host:x", "Prod")
	if r.Added != 1 || r.Skipped != 1 || len(r.Errors) != 1 {
		t.Errorf("AddMany = %+v", r)
	}

	h2, err := NewHub(h.dir)
	if err != nil {
		t.Fatal(err)
	}
	_, sec, ok := h2.store.Get(v.ID)
	if !ok || string(sec.Password) != pw {
		t.Errorf("password after reload = %q", sec.Password)
	}
	inv, _ = Servers{h2}.RenameGroup("Prod", "Production")
	for _, v := range inv.Servers {
		if v.Group != "Production" {
			t.Errorf("group = %q", v.Group)
		}
	}
	inv, _ = Servers{h2}.Delete([]string{v.ID})
	if len(inv.Servers) != 1 {
		t.Errorf("after delete: %d servers", len(inv.Servers))
	}
}

func TestSSHConfig(t *testing.T) {
	cfg := `Host *
  User nobody
Host bastion
  HostName 1.2.3.4
  User ops
Host web1 web2
  HostName %h.internal
  Port 2222
  IdentityFile ~/.ssh/id_web
  ProxyJump bastion
Host *.example.com !foo
  User x
`
	path := filepath.Join(t.TempDir(), "config")
	os.WriteFile(path, []byte(cfg), 0o644)
	h := newTestHub(t)
	r, err := Servers{h}.importSSHConfig(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if r.Added != 3 {
		t.Fatalf("added %d: %+v", r.Added, r)
	}
	byName := map[string]Server{}
	for _, v := range r.Inventory.Servers {
		byName[v.Name] = v
	}
	if b := byName["bastion"]; b.Host != "1.2.3.4" || b.User != "ops" || b.Port != 22 {
		t.Errorf("bastion = %+v", b)
	}
	if w := byName["web2"]; w.Host != "web2.internal" || w.Port != 2222 || w.KeyPath != "~/.ssh/id_web" || w.JumpID != byName["bastion"].ID {
		t.Errorf("web2 = %+v", w)
	}
}

func TestLineWriter(t *testing.T) {
	var got []string
	w := &lineWriter{flush: func(b []byte) { got = append(got, string(b)) }}
	w.Write([]byte("a\nb"))
	w.Write([]byte("c\n"))
	w.Close()
	if strings.Join(got, "") != "a\nbc\n" {
		t.Errorf("got %q", got)
	}
}
