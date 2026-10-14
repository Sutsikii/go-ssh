package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Hub holds the app's state, shared by the bound services.
type Hub struct {
	dir   string // the app's data directory
	store *Store
	hosts *HostKeys
	pool  *Pool
	terms *terms
	mon   *monitor

	mu       sync.Mutex
	settings Settings
}

// Settings are the app's preferences, in settings.json.
type Settings struct {
	Interval int              `json:"interval"` // seconds between statistics polls
	Theme    mygo.ThemeSource `json:"theme"`
}

func NewHub(dir string) (*Hub, error) {
	store, err := OpenStore(dir)
	if err != nil {
		return nil, err
	}
	h := &Hub{dir: dir, store: store, hosts: NewHostKeys(dir), terms: &terms{byID: map[string]*terminal{}}}
	h.pool = NewPool(store, h.hosts)
	h.mon = &monitor{hub: h, watchers: map[string]*watcher{}}
	h.settings = loadSettings(dir)
	store.onEdit = func(ids []string, reconnect bool) {
		for _, id := range ids {
			if _, _, ok := store.Get(id); !ok || reconnect {
				h.terms.closeServer(id)
				h.pool.Close(id)
				h.mon.restart(id)
			}
		}
		h.mon.sync()
	}
	return h, nil
}

func loadSettings(dir string) Settings {
	s := Settings{Interval: 5, Theme: mygo.ThemeSystem}
	if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		json.Unmarshal(b, &s)
	}
	if s.Interval < 2 || s.Interval > 300 {
		s.Interval = 5
	}
	if !validTheme(s.Theme) {
		s.Theme = mygo.ThemeSystem
	}
	return s
}

func (h *Hub) saveSettings() error {
	b, _ := json.MarshalIndent(h.settings, "", "  ")
	return os.WriteFile(filepath.Join(h.dir, "settings.json"), b, 0o644)
}

func (h *Hub) interval() time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	return time.Duration(h.settings.Interval) * time.Second
}

func validTheme(t mygo.ThemeSource) bool {
	return t == mygo.ThemeSystem || t == mygo.ThemeLight || t == mygo.ThemeDark
}

// --- Bound methods (service App) --------------------------------------------

// App is the settings page and the files of the app.
type App struct{ *Hub }

// AppInfo describes the app for the settings page.
type AppInfo struct {
	Settings Settings `json:"settings"`
	DataDir  string   `json:"dataDir"`
	Version  string   `json:"version"`
	Platform string   `json:"platform"`
}

// Info returns the settings and where the data is.
func (h App) Info() AppInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	v := mygo.App.Version()
	if v == "" {
		v = "développement"
	}
	return AppInfo{Settings: h.settings, DataDir: h.dir, Version: v, Platform: runtime.GOOS}
}

// SetInterval sets the seconds between statistics polls.
func (h App) SetInterval(seconds int) (Settings, error) {
	if seconds < 2 || seconds > 300 {
		return h.Info().Settings, fmt.Errorf("intervalle entre 2 et 300 secondes")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.settings.Interval = seconds
	return h.settings, h.saveSettings()
}

// SetTheme changes the appearance: "system", "light" or "dark".
func (h App) SetTheme(t mygo.ThemeSource) (Settings, error) {
	if !validTheme(t) {
		return h.Info().Settings, fmt.Errorf("thème inconnu : %q", t)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.settings.Theme = t
	mygo.Theme.SetSource(t)
	return h.settings, h.saveSettings()
}

// OpenDataDir shows the data directory in the file manager.
func (h App) OpenDataDir() error {
	return mygo.Shell.OpenPath(h.dir)
}

// ChooseKey asks for a private key file and returns its path, "" when
// canceled.
func (h App) ChooseKey(ctx context.Context) (string, error) {
	home, _ := os.UserHomeDir()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:          mygo.CallerWindow(ctx),
		Title:           "Clé privée",
		ButtonLabel:     "Choisir",
		DefaultPath:     filepath.Join(home, ".ssh"),
		ShowHiddenFiles: true,
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// PublicKey is a public key of ~/.ssh.
type PublicKey struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Line string `json:"line"` // as in authorized_keys
}

// PublicKeys lists the public keys of ~/.ssh.
func (h App) PublicKeys() []PublicKey {
	home, _ := os.UserHomeDir()
	files, _ := filepath.Glob(filepath.Join(home, ".ssh", "*.pub"))
	out := []PublicKey{}
	for _, f := range files {
		if line, err := publicKeyLine(f); err == nil {
			out = append(out, PublicKey{Path: f, Name: filepath.Base(f), Line: line})
		}
	}
	return out
}

// exportFile is an inventory exported without its credentials.
type exportFile struct {
	App     string   `json:"app"`
	Version int      `json:"version"`
	Servers []Server `json:"servers"`
	Groups  []string `json:"groups"`
}

// Export saves the inventory, without passwords, to a JSON file. It
// returns the path, "" when canceled.
func (h App) Export(ctx context.Context) (string, error) {
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "Exporter les serveurs",
		DefaultPath: "gossh-serveurs-" + time.Now().Format("2006-01-02") + ".json",
	})
	if err != nil || path == "" {
		return "", err
	}
	inv := Servers(h).List()
	for i := range inv.Servers {
		inv.Servers[i].HasPassword, inv.Servers[i].HasPassphrase = false, false
	}
	b, _ := json.MarshalIndent(exportFile{App: "gossh", Version: 1, Servers: inv.Servers, Groups: inv.Groups}, "", "  ")
	return path, os.WriteFile(path, b, 0o644)
}

// Import adds the servers of an exported file, or of an OpenSSH config
// file, that are not in the inventory yet.
func (h App) Import(ctx context.Context) (AddResult, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "Importer des serveurs (export gossh ou config OpenSSH)",
		ButtonLabel: "Importer",
	})
	if err != nil || len(paths) == 0 {
		return AddResult{Inventory: Servers(h).List(), Errors: []string{}}, err
	}
	b, err := os.ReadFile(paths[0])
	if err != nil {
		return AddResult{}, err
	}
	var f exportFile
	if json.Unmarshal(b, &f) != nil || f.App != "gossh" {
		return Servers(h).importSSHConfig(paths[0], "")
	}
	s := h.store
	s.mu.Lock()
	for _, g := range f.Groups {
		s.addGroup(g)
	}
	s.mu.Unlock()
	// Jump hosts refer to IDs of the exported file.
	oldID := map[string]Server{}
	for _, v := range f.Servers {
		oldID[v.ID] = v
	}
	r := Servers(h).addAll(f.Servers)
	s.mu.Lock()
	for i := range s.data.Servers {
		v := &s.data.Servers[i]
		for _, o := range f.Servers {
			if o.Host == v.Host && o.Port == v.Port && o.User == v.User && o.JumpID != "" && v.JumpID == "" {
				j := oldID[o.JumpID]
				if k := slices.IndexFunc(s.data.Servers, func(x Server) bool {
					return x.Host == j.Host && x.Port == j.Port && x.User == j.User
				}); k >= 0 && k != i {
					v.JumpID = s.data.Servers[k].ID
				}
			}
		}
	}
	s.save()
	r.Inventory = s.snapshot()
	s.mu.Unlock()
	return r, nil
}
