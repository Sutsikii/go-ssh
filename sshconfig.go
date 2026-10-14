package main

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// hostEntry is a Host block of an OpenSSH configuration.
type hostEntry struct {
	Alias, HostName, User, IdentityFile, ProxyJump string
	Port                                           int
}

// parseSSHConfig reads the Host blocks of an OpenSSH configuration whose
// patterns name one host: wildcards and negations are left out. Values of
// "Host *" blocks are not applied.
func parseSSHConfig(r io.Reader) []hostEntry {
	var out []hostEntry
	var cur []int // indexes of the current block's entries
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, _ := strings.Cut(line, " ")
		if k, v, ok := strings.Cut(line, "="); ok && !strings.Contains(k, " ") {
			key, val = k, v
		}
		key = strings.ToLower(strings.TrimSpace(key))
		val = strings.Trim(strings.TrimSpace(val), `"`)
		switch key {
		case "host":
			cur = nil
			for _, alias := range strings.Fields(val) {
				if strings.ContainsAny(alias, "*?!") {
					continue
				}
				out = append(out, hostEntry{Alias: alias})
				cur = append(cur, len(out)-1)
			}
			continue
		case "match":
			cur = nil
			continue
		}
		for _, i := range cur {
			e := &out[i]
			switch key {
			case "hostname":
				e.HostName = val
			case "user":
				e.User = val
			case "port":
				e.Port, _ = strconv.Atoi(val)
			case "identityfile":
				if e.IdentityFile == "" {
					e.IdentityFile = val
				}
			case "proxyjump":
				if j, _, _ := strings.Cut(val, ","); j != "none" {
					e.ProxyJump = j
				}
			}
		}
	}
	return out
}

// ImportSSHConfig adds the hosts of ~/.ssh/config that are not in the
// inventory yet, into group.
func (h Servers) ImportSSHConfig(group string) (AddResult, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return AddResult{}, err
	}
	return h.importSSHConfig(filepath.Join(home, ".ssh", "config"), group)
}

func (h Servers) importSSHConfig(path, group string) (AddResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return AddResult{Inventory: h.List(), Errors: []string{}}, err
	}
	defer f.Close()
	entries := parseSSHConfig(f)
	var vs []Server
	for _, e := range entries {
		host := e.HostName
		if host == "" {
			host = e.Alias
		}
		host = strings.ReplaceAll(host, "%h", e.Alias)
		vs = append(vs, Server{Name: e.Alias, Host: host, Port: e.Port, User: e.User, KeyPath: e.IdentityFile, Group: strings.TrimSpace(group), Monitor: true})
	}
	r := h.addAll(vs)

	// ProxyJump names another host of the file.
	s := h.store
	s.mu.Lock()
	var jumped []string
	byName := map[string]string{}
	for _, v := range s.data.Servers {
		byName[v.Name] = v.ID
	}
	for _, e := range entries {
		if e.ProxyJump == "" {
			continue
		}
		jump := byName[e.ProxyJump]
		if _, after, ok := strings.Cut(e.ProxyJump, "@"); ok && jump == "" {
			jump = byName[after]
		}
		for i := range s.data.Servers {
			if v := &s.data.Servers[i]; v.Name == e.Alias && v.JumpID == "" && jump != "" && jump != v.ID {
				v.JumpID = jump
				jumped = append(jumped, v.ID)
			}
		}
	}
	s.save()
	r.Inventory = s.snapshot()
	s.mu.Unlock()
	s.changed(true, jumped...)
	return r, nil
}
