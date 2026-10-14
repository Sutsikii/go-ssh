package main

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// historyLen is how many samples each server keeps: an hour at the
// default interval.
const historyLen = 720

// State is where a server stands.
type State string

const (
	StateOff        State = "off"        // statistics turned off
	StateConnecting State = "connecting" // first poll under way
	StateOnline     State = "online"
	StateOffline    State = "offline" // unreachable or refused
	StateHostKey    State = "hostkey" // its key must be checked first
)

// Status is a server's latest state and statistics.
type Status struct {
	ID       string        `json:"id"`
	State    State         `json:"state"`
	Error    string        `json:"error,omitempty"`
	HostKey  *HostKeyError `json:"hostKey,omitempty"`
	LastSeen time.Time     `json:"lastSeen,omitzero"`
	Latency  int           `json:"latency"` // milliseconds, of the last poll
	Uptime   float64       `json:"uptime"`  // seconds
	Info     *SysInfo      `json:"info,omitempty"`
	Latest   *Sample       `json:"latest,omitempty"`
	Disks    []Disk        `json:"disks"`
	Ifaces   []string      `json:"ifaces"`
	Linux    bool          `json:"linux"` // its statistics could be read
}

// StatusChanged is broadcast after each poll of a server.
var StatusChanged = mygo.NewEvent[Status]("status")

type monitor struct {
	hub      *Hub
	mu       sync.Mutex
	watchers map[string]*watcher
}

type watcher struct {
	id     string
	cancel context.CancelFunc
	wake   chan struct{}

	mu     sync.Mutex
	status Status
	hist   []Sample
	prev   *counters
	prevAt time.Time
}

// sync starts watching the servers whose statistics are on, and stops the
// others.
func (m *monitor) sync() {
	want := map[string]bool{}
	for _, v := range m.hub.store.All() {
		if v.Monitor {
			want[v.ID] = true
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, w := range m.watchers {
		if !want[id] {
			w.cancel()
			delete(m.watchers, id)
			StatusChanged.Broadcast(Status{ID: id, State: StateOff, Disks: []Disk{}, Ifaces: []string{}})
		}
	}
	for id := range want {
		if m.watchers[id] == nil {
			ctx, cancel := context.WithCancel(context.Background())
			w := &watcher{id: id, cancel: cancel, wake: make(chan struct{}, 1), status: Status{ID: id, State: StateConnecting, Disks: []Disk{}, Ifaces: []string{}}}
			m.watchers[id] = w
			go m.run(ctx, w)
		}
	}
}

// restart forgets what a server's watcher knows, after its settings
// changed.
func (m *monitor) restart(id string) {
	m.mu.Lock()
	if w := m.watchers[id]; w != nil {
		w.cancel()
		delete(m.watchers, id)
	}
	m.mu.Unlock()
	m.sync()
}

func (m *monitor) run(ctx context.Context, w *watcher) {
	fails := 0
	for {
		err := m.poll(ctx, w)
		if ctx.Err() != nil {
			return
		}
		delay := m.hub.interval()
		var hk *HostKeyError
		switch {
		case errors.As(err, &hk):
			delay = 24 * time.Hour // until the user trusts the key
		case err != nil:
			fails++
			delay = min(delay<<min(fails, 4), 2*time.Minute)
		default:
			fails = 0
		}
		select {
		case <-ctx.Done():
			return
		case <-w.wake:
		case <-time.After(delay):
		}
	}
}

func (m *monitor) poll(ctx context.Context, w *watcher) error {
	ctx, cancel := context.WithTimeout(ctx, 2*dialTimeout)
	defer cancel()
	start := time.Now()
	client, err := m.hub.pool.Client(ctx, w.id)
	if err == nil {
		w.mu.Lock()
		needInfo := w.status.Info == nil
		w.mu.Unlock()
		script := statsScript
		if needInfo {
			script = infoScript + statsScript
		}
		var out []byte
		out, err = run(ctx, client, script)
		if err == nil || len(out) > 0 {
			m.record(w, start, out, needInfo)
			return nil
		}
	}
	if ctx.Err() != nil && errors.Is(ctx.Err(), context.Canceled) {
		return ctx.Err()
	}
	w.mu.Lock()
	st := w.status
	st.State, st.Error, st.HostKey = StateOffline, err.Error(), nil
	var hk *HostKeyError
	if errors.As(err, &hk) {
		st.State, st.HostKey = StateHostKey, hk
	}
	st.Info, w.prev = nil, nil // read again once back
	w.status = st
	w.mu.Unlock()
	StatusChanged.Broadcast(st)
	return err
}

func (m *monitor) record(w *watcher, start time.Time, out []byte, withInfo bool) {
	now := time.Now()
	c := parseCounters(string(out))
	w.mu.Lock()
	st := w.status
	if withInfo {
		info := parseInfo(string(out))
		st.Info = &info
	}
	var smp Sample
	if c.ok {
		smp = sample(w.prev, c, now.UnixMilli(), now.Sub(w.prevAt).Seconds())
		if w.prev != nil {
			w.hist = append(w.hist, smp)
			if len(w.hist) > historyLen {
				w.hist = slices.Delete(w.hist, 0, len(w.hist)-historyLen)
			}
		}
		w.prev, w.prevAt = &c, now
		st.Latest = &smp
		st.Disks = c.disks
		st.Uptime = c.uptime
		st.Ifaces = c.interfaces
		if st.Ifaces == nil {
			st.Ifaces = []string{}
		}
	}
	st.Linux = c.ok
	st.State, st.Error, st.HostKey = StateOnline, "", nil
	if !c.ok {
		st.Error = "statistiques indisponibles (serveur non Linux ?)"
	}
	st.LastSeen = now
	st.Latency = int(now.Sub(start).Milliseconds())
	w.status = st
	w.mu.Unlock()
	StatusChanged.Broadcast(st)
}

// --- Bound methods (service Monitor) ----------------------------------------

// Monitor reads the servers' statistics.
type Monitor struct{ *Hub }

// Statuses returns the latest status of every watched server.
func (h Monitor) Statuses() []Status {
	h.mon.mu.Lock()
	ws := make([]*watcher, 0, len(h.mon.watchers))
	for _, w := range h.mon.watchers {
		ws = append(ws, w)
	}
	h.mon.mu.Unlock()
	out := make([]Status, 0, len(ws))
	for _, w := range ws {
		w.mu.Lock()
		out = append(out, w.status)
		w.mu.Unlock()
	}
	return out
}

// History returns the samples of a server, oldest first.
func (h Monitor) History(id string) []Sample {
	h.mon.mu.Lock()
	w := h.mon.watchers[id]
	h.mon.mu.Unlock()
	if w == nil {
		return []Sample{}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.hist)
}

// Refresh polls servers now.
func (h Monitor) Refresh(ids []string) {
	h.mon.mu.Lock()
	defer h.mon.mu.Unlock()
	for _, id := range ids {
		if w := h.mon.watchers[id]; w != nil {
			select {
			case w.wake <- struct{}{}:
			default:
			}
		}
	}
}

// TrustHostKey trusts the key a server just presented, then connects.
func (h Monitor) TrustHostKey(id, host string) error {
	if err := h.hosts.Trust(id, host); err != nil {
		return err
	}
	h.pool.Close(id)
	h.Refresh([]string{id})
	return nil
}

// KnownHosts lists the server keys trusted in the app.
func (h Monitor) KnownHosts() []KnownHost {
	return h.hosts.Fingerprints()
}

// Disconnect closes the connection to servers, ending their terminals.
func (h Monitor) Disconnect(ids []string) {
	for _, id := range ids {
		h.terms.closeServer(id)
		h.pool.Close(id)
	}
}

// Test connects to a server and returns how long it took, in
// milliseconds.
// The connection is kept, so are the server's terminals: a dead one is
// dialed again.
func (h Monitor) Test(ctx context.Context, id string) (int, error) {
	start := time.Now()
	reused := h.pool.Connected(id)
	c, err := h.pool.Client(ctx, id)
	if err != nil {
		return 0, err
	}
	if _, err := run(ctx, c, "true"); err != nil {
		if !reused || ctx.Err() != nil {
			return 0, err
		}
		h.pool.Close(id)
		start = time.Now()
		if c, err = h.pool.Client(ctx, id); err != nil {
			return 0, err
		}
		if _, err := run(ctx, c, "true"); err != nil {
			return 0, err
		}
	}
	h.Refresh([]string{id})
	return int(time.Since(start).Milliseconds()), nil
}
