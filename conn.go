package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

const dialTimeout = 12 * time.Second

// Pool keeps one SSH connection per server, shared by its terminals, its
// statistics and the commands run on it.
type Pool struct {
	store *Store
	hosts *HostKeys

	mu    sync.Mutex
	conns map[string]*conn
}

type conn struct {
	ready  chan struct{} // closed once dialed
	client *ssh.Client
	err    error
}

func NewPool(store *Store, hosts *HostKeys) *Pool {
	return &Pool{store: store, hosts: hosts, conns: map[string]*conn{}}
}

// Client returns the connection to a server, dialing it when there is none.
func (p *Pool) Client(ctx context.Context, id string) (*ssh.Client, error) {
	return p.client(ctx, id, 0)
}

func (p *Pool) client(ctx context.Context, id string, depth int) (*ssh.Client, error) {
	if depth > 4 {
		return nil, errors.New("trop de rebonds (serveurs de rebond en boucle ?)")
	}
	p.mu.Lock()
	c, ok := p.conns[id]
	if !ok {
		c = &conn{ready: make(chan struct{})}
		p.conns[id] = c
		go p.dial(c, id, depth)
	}
	p.mu.Unlock()
	select {
	case <-c.ready:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if c.err != nil {
		return nil, c.err
	}
	return c.client, nil
}

func (p *Pool) dial(c *conn, id string, depth int) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*dialTimeout)
	defer cancel()
	c.client, c.err = p.connect(ctx, id, depth)
	close(c.ready)
	if c.err != nil {
		p.drop(id, c)
		return
	}
	go p.keepAlive(c, id)
}

// keepAlive notices dead connections, so that the next use dials again.
func (p *Pool) keepAlive(c *conn, id string) {
	done := make(chan struct{})
	go func() {
		c.client.Wait()
		close(done)
	}()
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-done:
			p.drop(id, c)
			return
		case <-t.C:
			res := make(chan error, 1)
			go func() {
				_, _, err := c.client.SendRequest("keepalive@openssh.com", true, nil)
				res <- err
			}()
			select {
			case err := <-res:
				if err == nil {
					continue
				}
			case <-time.After(15 * time.Second):
			}
			c.client.Close()
		}
	}
}

// drop forgets a connection if it is still the server's.
func (p *Pool) drop(id string, c *conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conns[id] == c {
		delete(p.conns, id)
	}
}

// Close closes the connection to a server, such as after it was edited.
// Its terminals end.
func (p *Pool) Close(id string) {
	p.mu.Lock()
	c := p.conns[id]
	delete(p.conns, id)
	p.mu.Unlock()
	if c != nil {
		go func() {
			<-c.ready
			if c.client != nil {
				c.client.Close()
			}
		}()
	}
}

// Connected reports whether a server has an open connection.
func (p *Pool) Connected(id string) bool {
	p.mu.Lock()
	c := p.conns[id]
	p.mu.Unlock()
	if c == nil {
		return false
	}
	select {
	case <-c.ready:
		return c.err == nil
	default:
		return false
	}
}

func (p *Pool) connect(ctx context.Context, id string, depth int) (*ssh.Client, error) {
	v, sec, ok := p.store.Get(id)
	if !ok {
		return nil, errors.New("serveur introuvable")
	}
	cfg, closeAgent, err := p.config(v, sec)
	if err != nil {
		return nil, err
	}
	defer closeAgent()
	addr := net.JoinHostPort(v.Host, strconv.Itoa(v.Port))

	var nc net.Conn
	if v.JumpID != "" {
		jump, err := p.client(ctx, v.JumpID, depth+1)
		if err != nil {
			jv, _, _ := p.store.Get(v.JumpID)
			return nil, fmt.Errorf("rebond par %s : %w", jv.Name, err)
		}
		nc, err = jump.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, err
		}
	} else {
		d := net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
		nc, err = d.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, friendlyNetError(err)
		}
	}
	deadline := time.Now().Add(dialTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	nc.SetDeadline(deadline)
	cc, chans, reqs, err := ssh.NewClientConn(nc, addr, cfg)
	if err != nil {
		nc.Close()
		var hk *HostKeyError
		if errors.As(err, &hk) {
			return nil, hk
		}
		return nil, friendlyAuthError(err)
	}
	nc.SetDeadline(time.Time{})
	p.store.touch(id)
	return ssh.NewClient(cc, chans, reqs), nil
}

// config makes the client configuration of a server: its key, the agent,
// ~/.ssh's keys, then its password, in that order.
func (p *Pool) config(v Server, sec secrets) (*ssh.ClientConfig, func(), error) {
	user := v.User
	if user == "" {
		user = os.Getenv("USERNAME")
		if user == "" {
			user = os.Getenv("USER")
		}
	}
	closeAgent := func() {}
	var methods []ssh.AuthMethod
	var signers []ssh.Signer

	keys := []string{v.KeyPath}
	if v.KeyPath == "" {
		home, _ := os.UserHomeDir()
		keys = nil
		for _, name := range []string{"id_ed25519", "id_ecdsa", "id_rsa"} {
			keys = append(keys, filepath.Join(home, ".ssh", name))
		}
	}
	for _, path := range keys {
		s, err := loadKey(path, sec.Passphrase)
		if err != nil {
			if v.KeyPath != "" {
				return nil, closeAgent, err
			}
			continue
		}
		signers = append(signers, s)
	}
	if len(signers) > 0 {
		methods = append(methods, ssh.PublicKeys(signers...))
	}
	if a, err := dialAgent(); err == nil {
		closeAgent = func() { a.Close() }
		methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(a).Signers))
	}
	if len(sec.Password) > 0 {
		pw := string(sec.Password)
		methods = append(methods,
			ssh.Password(pw),
			ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = pw
				}
				return answers, nil
			}))
	}
	if len(methods) == 0 {
		return nil, closeAgent, errors.New("aucune méthode d'authentification : ajouter une clé ou un mot de passe")
	}
	return &ssh.ClientConfig{
		User:            user,
		Auth:            methods,
		HostKeyCallback: p.hosts.Callback(v.ID),
		Timeout:         dialTimeout,
	}, closeAgent, nil
}

func loadKey(path string, passphrase []byte) (ssh.Signer, error) {
	path = expandHome(path)
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("clé %s : %w", filepath.Base(path), err)
	}
	s, err := ssh.ParsePrivateKey(b)
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		if len(passphrase) == 0 {
			return nil, fmt.Errorf("la clé %s est protégée : renseigner sa phrase de passe", filepath.Base(path))
		}
		s, err = ssh.ParsePrivateKeyWithPassphrase(b, passphrase)
	}
	if err != nil {
		return nil, fmt.Errorf("clé %s : %w", filepath.Base(path), err)
	}
	return s, nil
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, p[1:])
	}
	return p
}

func friendlyNetError(err error) error {
	var ne net.Error
	switch {
	case errors.As(err, &ne) && ne.Timeout():
		return errors.New("délai dépassé : le serveur ne répond pas")
	case strings.Contains(err.Error(), "refused"):
		return errors.New("connexion refusée (port fermé ?)")
	case strings.Contains(err.Error(), "no such host"):
		return errors.New("adresse inconnue (DNS)")
	}
	return err
}

func friendlyAuthError(err error) error {
	if strings.Contains(err.Error(), "unable to authenticate") {
		return errors.New("authentification refusée : vérifier l'utilisateur, la clé ou le mot de passe")
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return errors.New("délai dépassé pendant la négociation SSH")
	}
	return err
}

// --- Host keys --------------------------------------------------------------

// HostKeys checks servers' keys against ~/.ssh/known_hosts and the app's
// own known_hosts, where the keys the user trusts here go.
type HostKeys struct {
	file string // the app's

	mu      sync.Mutex
	pending map[string]ssh.PublicKey // by server ID: keys seen, not trusted yet
}

func NewHostKeys(dir string) *HostKeys {
	return &HostKeys{file: filepath.Join(dir, "known_hosts"), pending: map[string]ssh.PublicKey{}}
}

// HostKeyError is an unknown or changed server key. Its text, which pages
// read, is "hostkey:" and the error in JSON.
type HostKeyError struct {
	ServerID    string `json:"serverId"`
	Host        string `json:"host"`
	Type        string `json:"type"`
	Fingerprint string `json:"fingerprint"`
	Changed     bool   `json:"changed"` // the server had another key
}

func (e *HostKeyError) Error() string {
	b, _ := json.Marshal(e)
	return "hostkey:" + string(b)
}

func (k *HostKeys) files() []string {
	home, _ := os.UserHomeDir()
	var out []string
	for _, f := range []string{k.file, filepath.Join(home, ".ssh", "known_hosts")} {
		if _, err := os.Stat(f); err == nil {
			out = append(out, f)
		}
	}
	return out
}

// Callback checks the keys of server id.
func (k *HostKeys) Callback(id string) ssh.HostKeyCallback {
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		herr := &HostKeyError{ServerID: id, Host: knownhosts.Normalize(host), Type: key.Type(), Fingerprint: ssh.FingerprintSHA256(key)}
		files := k.files()
		if len(files) > 0 {
			cb, err := knownhosts.New(files...)
			if err != nil {
				return err
			}
			err = cb(host, remote, key)
			var ke *knownhosts.KeyError
			if !errors.As(err, &ke) {
				return err // nil: known
			}
			herr.Changed = len(ke.Want) > 0
		}
		k.mu.Lock()
		k.pending[id] = key
		k.mu.Unlock()
		return herr
	}
}

// Trust records the key last seen for a server, replacing the app's
// former key of its host.
func (k *HostKeys) Trust(id, host string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := k.pending[id]
	if key == nil {
		return errors.New("aucune clé en attente pour ce serveur : reconnecter")
	}
	host = knownhosts.Normalize(host)
	old, _ := os.ReadFile(k.file)
	var keep [][]byte
	for _, line := range bytes.Split(old, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		hosts, _, _ := bytes.Cut(line, []byte(" "))
		if knownhosts.Normalize(string(hosts)) == host {
			continue
		}
		keep = append(keep, line)
	}
	keep = append(keep, []byte(knownhosts.Line([]string{host}, key)))
	if err := os.WriteFile(k.file, append(bytes.Join(keep, []byte("\n")), '\n'), 0o600); err != nil {
		return err
	}
	delete(k.pending, id)
	return nil
}

// Fingerprints lists the keys the app trusts.
func (k *HostKeys) Fingerprints() []KnownHost {
	b, _ := os.ReadFile(k.file)
	out := []KnownHost{}
	for len(b) > 0 {
		_, hosts, key, _, rest, err := ssh.ParseKnownHosts(b)
		if err != nil {
			break
		}
		out = append(out, KnownHost{Hosts: strings.Join(hosts, ", "), Type: key.Type(), Fingerprint: ssh.FingerprintSHA256(key)})
		b = rest
	}
	return out
}

// KnownHost is a trusted key.
type KnownHost struct {
	Hosts       string `json:"hosts"`
	Type        string `json:"type"`
	Fingerprint string `json:"fingerprint"`
}

// publicKeyLine returns the authorized_keys line of a public key file.
func publicKeyLine(path string) (string, error) {
	b, err := os.ReadFile(expandHome(path))
	if err != nil {
		return "", err
	}
	key, comment, _, _, err := ssh.ParseAuthorizedKey(b)
	if err != nil {
		return "", fmt.Errorf("pas une clé publique : %w", err)
	}
	line := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
	if comment != "" {
		line += " " + comment
	}
	return line, nil
}
