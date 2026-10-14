package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Server is an SSH server of the inventory.
type Server struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Host     string    `json:"host"`
	Port     int       `json:"port"`
	User     string    `json:"user"`
	KeyPath  string    `json:"keyPath,omitempty"` // a private key; ~/.ssh's default keys when empty
	JumpID   string    `json:"jumpId,omitempty"`  // the server to go through, like ProxyJump
	Group    string    `json:"group,omitempty"`
	Tags     []string  `json:"tags"`
	Color    string    `json:"color,omitempty"`
	Notes    string    `json:"notes,omitempty"`
	Favorite bool      `json:"favorite,omitempty"`
	Monitor  bool      `json:"monitor"` // collect its statistics
	Created  time.Time `json:"created"`
	LastUsed time.Time `json:"lastUsed,omitzero"`

	HasPassword   bool `json:"hasPassword"`   // filled for the page, never saved
	HasPassphrase bool `json:"hasPassphrase"` // filled for the page, never saved
}

// ServerInput edits a server. A nil secret keeps the stored one, an empty
// one removes it.
type ServerInput struct {
	Server
	Password   *string `json:"password"`
	Passphrase *string `json:"passphrase"`
}

// secrets are a server's credentials, encrypted on disk by protect.
type secrets struct {
	Password   []byte `json:"password,omitempty"`
	Passphrase []byte `json:"passphrase,omitempty"`
}

// Inventory is everything saved in servers.json.
type Inventory struct {
	Servers []Server `json:"servers"`
	Groups  []string `json:"groups"` // in the sidebar's order, including empty ones
}

type inventoryFile struct {
	Inventory
	Secrets map[string]secrets `json:"secrets,omitempty"`
}

// Store keeps the inventory in servers.json.
type Store struct {
	mu      sync.Mutex
	dir     string
	data    Inventory
	secrets map[string]secrets                 // decrypted
	onEdit  func(ids []string, reconnect bool) // servers changed or went away; reconnect when how to reach them changed
}

// OpenStore loads or creates the inventory in dir.
func OpenStore(dir string) (*Store, error) {
	s := &Store{dir: dir, secrets: map[string]secrets{}}
	b, err := os.ReadFile(s.file())
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	var f inventoryFile
	if err == nil {
		err = json.Unmarshal(b, &f)
	}
	if err != nil {
		return nil, fmt.Errorf("servers.json : %w", err)
	}
	s.data = f.Inventory
	for id, sec := range f.Secrets {
		var d secrets
		d.Password, _ = unprotect(sec.Password)
		d.Passphrase, _ = unprotect(sec.Passphrase)
		s.secrets[id] = d
	}
	for i := range s.data.Servers {
		if s.data.Servers[i].Tags == nil {
			s.data.Servers[i].Tags = []string{}
		}
	}
	return s, nil
}

func (s *Store) file() string { return filepath.Join(s.dir, "servers.json") }

// save writes servers.json; the caller holds s.mu.
func (s *Store) save() error {
	f := inventoryFile{Inventory: s.data, Secrets: map[string]secrets{}}
	for id, sec := range s.secrets {
		var e secrets
		var err error
		if e.Password, err = protect(sec.Password); err != nil {
			return err
		}
		if e.Passphrase, err = protect(sec.Passphrase); err != nil {
			return err
		}
		if e.Password != nil || e.Passphrase != nil {
			f.Secrets[id] = e
		}
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.file() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.file())
}

// snapshot returns a copy of the inventory for the page; the caller holds
// s.mu.
func (s *Store) snapshot() Inventory {
	out := Inventory{Servers: slices.Clone(s.data.Servers), Groups: slices.Clone(s.data.Groups)}
	if out.Groups == nil {
		out.Groups = []string{}
	}
	for i := range out.Servers {
		sec := s.secrets[out.Servers[i].ID]
		out.Servers[i].HasPassword = len(sec.Password) > 0
		out.Servers[i].HasPassphrase = len(sec.Passphrase) > 0
		out.Servers[i].Tags = slices.Clone(out.Servers[i].Tags)
	}
	return out
}

// Get returns a server and its credentials.
func (s *Store) Get(id string) (Server, secrets, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.index(id)
	if i < 0 {
		return Server{}, secrets{}, false
	}
	return s.data.Servers[i], s.secrets[id], true
}

// All returns every server.
func (s *Store) All() []Server {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.data.Servers)
}

func (s *Store) index(id string) int {
	return slices.IndexFunc(s.data.Servers, func(v Server) bool { return v.ID == id })
}

func (s *Store) changed(reconnect bool, ids ...string) {
	if s.onEdit != nil && len(ids) > 0 {
		s.onEdit(ids, reconnect)
	}
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// clean checks a server and fills its defaults.
func clean(v Server) (Server, error) {
	v.Name = strings.TrimSpace(v.Name)
	v.Host = strings.TrimSpace(v.Host)
	v.User = strings.TrimSpace(v.User)
	v.Group = strings.TrimSpace(v.Group)
	v.KeyPath = strings.TrimSpace(v.KeyPath)
	if v.Host == "" {
		return v, errors.New("l'adresse du serveur est vide")
	}
	if strings.ContainsAny(v.Host, " /@") {
		return v, fmt.Errorf("adresse invalide : %q", v.Host)
	}
	if v.Port == 0 {
		v.Port = 22
	}
	if v.Port < 1 || v.Port > 65535 {
		return v, fmt.Errorf("port invalide : %d", v.Port)
	}
	if v.Name == "" {
		v.Name = v.Host
	}
	tags := []string{}
	for _, t := range v.Tags {
		if t = strings.TrimSpace(t); t != "" && !slices.Contains(tags, t) {
			tags = append(tags, t)
		}
	}
	v.Tags = tags
	v.HasPassword, v.HasPassphrase = false, false
	return v, nil
}

// addGroup records a group; the caller holds s.mu.
func (s *Store) addGroup(g string) {
	if g != "" && !slices.Contains(s.data.Groups, g) {
		s.data.Groups = append(s.data.Groups, g)
	}
}

func applySecret(dst *[]byte, v *string) {
	if v != nil {
		*dst = []byte(*v)
		if *v == "" {
			*dst = nil
		}
	}
}

// --- Bound methods (service Servers) ----------------------------------------

// Servers is the inventory as the page sees it.
type Servers struct{ *Hub }

// List returns the inventory.
func (h Servers) List() Inventory {
	h.store.mu.Lock()
	defer h.store.mu.Unlock()
	return h.store.snapshot()
}

// Save adds a server, or updates the one with the same ID.
func (h Servers) Save(in ServerInput) (Inventory, error) {
	s := h.store
	v, err := clean(in.Server)
	if err != nil {
		return h.List(), err
	}
	s.mu.Lock()
	if v.JumpID == v.ID && v.ID != "" {
		v.JumpID = ""
	}
	reconnect := in.Password != nil || in.Passphrase != nil
	if i := s.index(v.ID); v.ID != "" && i >= 0 {
		old := s.data.Servers[i]
		v.Created, v.LastUsed = old.Created, old.LastUsed
		reconnect = reconnect || old.Host != v.Host || old.Port != v.Port || old.User != v.User || old.KeyPath != v.KeyPath || old.JumpID != v.JumpID
		s.data.Servers[i] = v
	} else {
		v.ID = newID()
		v.Created = time.Now()
		s.data.Servers = append(s.data.Servers, v)
	}
	sec := s.secrets[v.ID]
	applySecret(&sec.Password, in.Password)
	applySecret(&sec.Passphrase, in.Passphrase)
	s.secrets[v.ID] = sec
	s.addGroup(v.Group)
	err = s.save()
	out := s.snapshot()
	s.mu.Unlock()
	s.changed(reconnect, v.ID)
	return out, err
}

// Delete removes servers.
func (h Servers) Delete(ids []string) (Inventory, error) {
	s := h.store
	s.mu.Lock()
	s.data.Servers = slices.DeleteFunc(s.data.Servers, func(v Server) bool { return slices.Contains(ids, v.ID) })
	for i := range s.data.Servers {
		if slices.Contains(ids, s.data.Servers[i].JumpID) {
			s.data.Servers[i].JumpID = ""
		}
	}
	for _, id := range ids {
		delete(s.secrets, id)
	}
	err := s.save()
	out := s.snapshot()
	s.mu.Unlock()
	s.changed(true, ids...)
	return out, err
}

// Duplicate copies a server, credentials included.
func (h Servers) Duplicate(id string) (Inventory, error) {
	s := h.store
	s.mu.Lock()
	i := s.index(id)
	if i < 0 {
		s.mu.Unlock()
		return h.List(), errors.New("serveur introuvable")
	}
	v := s.data.Servers[i]
	v.ID, v.Name, v.Created, v.LastUsed = newID(), v.Name+" (copie)", time.Now(), time.Time{}
	v.Tags = slices.Clone(v.Tags)
	s.data.Servers = slices.Insert(s.data.Servers, i+1, v)
	s.secrets[v.ID] = s.secrets[id]
	err := s.save()
	out := s.snapshot()
	s.mu.Unlock()
	s.changed(false, v.ID)
	return out, err
}

// SetFavorite stars or unstars a server.
func (h Servers) SetFavorite(id string, on bool) (Inventory, error) {
	return h.edit([]string{id}, func(v *Server) { v.Favorite = on })
}

// SetGroup moves servers to a group, "" for none.
func (h Servers) SetGroup(ids []string, group string) (Inventory, error) {
	group = strings.TrimSpace(group)
	h.store.mu.Lock()
	h.store.addGroup(group)
	h.store.mu.Unlock()
	return h.edit(ids, func(v *Server) { v.Group = group })
}

// AddTag tags servers.
func (h Servers) AddTag(ids []string, tag string) (Inventory, error) {
	tag = strings.TrimSpace(tag)
	return h.edit(ids, func(v *Server) {
		if tag != "" && !slices.Contains(v.Tags, tag) {
			v.Tags = append(v.Tags, tag)
		}
	})
}

// SetMonitor turns the statistics of servers on or off.
func (h Servers) SetMonitor(ids []string, on bool) (Inventory, error) {
	return h.edit(ids, func(v *Server) { v.Monitor = on })
}

func (h Servers) edit(ids []string, fn func(*Server)) (Inventory, error) {
	s := h.store
	s.mu.Lock()
	for i := range s.data.Servers {
		if slices.Contains(ids, s.data.Servers[i].ID) {
			fn(&s.data.Servers[i])
		}
	}
	err := s.save()
	out := s.snapshot()
	s.mu.Unlock()
	s.changed(false, ids...)
	return out, err
}

// touch records that a server was just connected to.
func (s *Store) touch(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if i := s.index(id); i >= 0 {
		s.data.Servers[i].LastUsed = time.Now()
		s.save()
	}
}

// AddGroup creates an empty group.
func (h Servers) AddGroup(name string) (Inventory, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return h.List(), errors.New("nom vide")
	}
	s := h.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if slices.Contains(s.data.Groups, name) {
		return s.snapshot(), errors.New("ce groupe existe déjà")
	}
	s.addGroup(name)
	return s.snapshot(), s.save()
}

// RenameGroup renames a group and moves its servers along.
func (h Servers) RenameGroup(from, to string) (Inventory, error) {
	to = strings.TrimSpace(to)
	if to == "" {
		return h.List(), errors.New("nom vide")
	}
	s := h.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if from != to && slices.Contains(s.data.Groups, to) {
		return s.snapshot(), errors.New("ce groupe existe déjà")
	}
	if i := slices.Index(s.data.Groups, from); i >= 0 {
		s.data.Groups[i] = to
	}
	for i := range s.data.Servers {
		if s.data.Servers[i].Group == from {
			s.data.Servers[i].Group = to
		}
	}
	return s.snapshot(), s.save()
}

// DeleteGroup removes a group; its servers stay, without a group.
func (h Servers) DeleteGroup(name string) (Inventory, error) {
	s := h.store
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Groups = slices.DeleteFunc(s.data.Groups, func(g string) bool { return g == name })
	for i := range s.data.Servers {
		if s.data.Servers[i].Group == name {
			s.data.Servers[i].Group = ""
		}
	}
	return s.snapshot(), s.save()
}

// AddResult says how an import went.
type AddResult struct {
	Inventory Inventory `json:"inventory"`
	Added     int       `json:"added"`
	Skipped   int       `json:"skipped"` // already in the inventory
	Errors    []string  `json:"errors"`
}

// AddMany adds servers from lines such as "user@host:port name", one per
// line, into group.
func (h Servers) AddMany(text, group string) (AddResult, error) {
	var vs []Server
	var errs []string
	for n, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		v, err := parseLine(line)
		if err != nil {
			errs = append(errs, fmt.Sprintf("ligne %d : %v", n+1, err))
			continue
		}
		v.Group = strings.TrimSpace(group)
		vs = append(vs, v)
	}
	r := h.addAll(vs)
	r.Errors = append(errs, r.Errors...)
	return r, nil
}

// parseLine reads "[user@]host[:port] [name...]".
func parseLine(line string) (Server, error) {
	addr, name, _ := strings.Cut(line, " ")
	var v Server
	if u, rest, ok := strings.Cut(addr, "@"); ok {
		v.User, addr = u, rest
	}
	if strings.HasPrefix(addr, "[") { // [::1]:22
		if end := strings.Index(addr, "]"); end > 0 {
			host, port := addr[1:end], strings.TrimPrefix(addr[end+1:], ":")
			addr = host
			if port != "" {
				p, err := strconv.Atoi(port)
				if err != nil {
					return v, fmt.Errorf("port invalide : %q", port)
				}
				v.Port = p
			}
		}
	} else if host, port, ok := strings.Cut(addr, ":"); ok && !strings.Contains(port, ":") {
		p, err := strconv.Atoi(port)
		if err != nil {
			return v, fmt.Errorf("port invalide : %q", port)
		}
		addr, v.Port = host, p
	}
	v.Host = addr
	v.Name = strings.TrimSpace(name)
	v.Monitor = true
	return clean(v)
}

// addAll adds servers, leaving out those already there (same user, host
// and port).
func (h Servers) addAll(vs []Server) AddResult {
	s := h.store
	s.mu.Lock()
	var r AddResult
	var ids []string
	for _, v := range vs {
		v, err := clean(v)
		if err != nil {
			r.Errors = append(r.Errors, err.Error())
			continue
		}
		if slices.ContainsFunc(s.data.Servers, func(o Server) bool {
			return o.Host == v.Host && o.Port == v.Port && o.User == v.User
		}) {
			r.Skipped++
			continue
		}
		v.ID, v.Created = newID(), time.Now()
		s.data.Servers = append(s.data.Servers, v)
		s.addGroup(v.Group)
		ids = append(ids, v.ID)
		r.Added++
	}
	if err := s.save(); err != nil {
		r.Errors = append(r.Errors, err.Error())
	}
	r.Inventory = s.snapshot()
	s.mu.Unlock()
	s.changed(false, ids...)
	if r.Errors == nil {
		r.Errors = []string{}
	}
	return r
}

// SetPassword gives servers the same password, "" to remove it.
func (h Servers) SetPassword(ids []string, password string) (Inventory, error) {
	s := h.store
	s.mu.Lock()
	for _, id := range ids {
		if s.index(id) < 0 {
			continue
		}
		sec := s.secrets[id]
		applySecret(&sec.Password, &password)
		s.secrets[id] = sec
	}
	err := s.save()
	out := s.snapshot()
	s.mu.Unlock()
	s.changed(true, ids...)
	return out, err
}
