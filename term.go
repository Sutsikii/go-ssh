package main

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/egoist/mygo"
	"golang.org/x/crypto/ssh"
)

// Terminals are interactive shells on servers, each in a tab of the page.
type Terminals struct{ *Hub }

type terminal struct {
	server  string
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
}

type terms struct {
	mu   sync.Mutex
	byID map[string]*terminal
}

func (t *terms) get(id string) (*terminal, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if s := t.byID[id]; s != nil {
		return s, nil
	}
	return nil, errors.New("terminal fermé")
}

// Open starts a shell on a server, in a terminal of cols × rows, and
// returns its ID. Stream then sends what it prints.
func (h Terminals) Open(ctx context.Context, serverID string, cols, rows int) (string, error) {
	client, err := h.pool.Client(ctx, serverID)
	if err != nil {
		return "", err
	}
	s, err := client.NewSession()
	if err != nil {
		// The connection may have died since; dial again once.
		h.pool.Close(serverID)
		if client, err = h.pool.Client(ctx, serverID); err != nil {
			return "", err
		}
		if s, err = client.NewSession(); err != nil {
			return "", err
		}
	}
	stdin, _ := s.StdinPipe()
	stdout, _ := s.StdoutPipe()
	s.Stderr = nil // merged into stdout by the pty
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 115200, ssh.TTY_OP_OSPEED: 115200}
	if cols <= 0 || rows <= 0 {
		cols, rows = 120, 32
	}
	if err := s.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		s.Close()
		return "", err
	}
	s.Setenv("COLORTERM", "truecolor")
	if err := s.Shell(); err != nil {
		s.Close()
		return "", err
	}
	id := newID()
	h.terms.mu.Lock()
	h.terms.byID[id] = &terminal{server: serverID, session: s, stdin: stdin, stdout: stdout}
	h.terms.mu.Unlock()
	return id, nil
}

// Stream sends what terminal id prints until its shell exits, then returns
// the shell's exit code. Closing the channel closes the terminal.
func (h Terminals) Stream(ctx context.Context, id string, out *mygo.Channel[[]byte]) (int, error) {
	return h.stream(ctx, id, out.Send)
}

func (h Terminals) stream(ctx context.Context, id string, out func([]byte) error) (int, error) {
	t, err := h.terms.get(id)
	if err != nil {
		return 0, err
	}
	defer h.Close(id)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-ctx.Done()
		t.session.Close()
	}()
	buf := make([]byte, 32*1024)
	for {
		n, err := t.stdout.Read(buf)
		if n > 0 {
			if serr := out(append([]byte(nil), buf[:n]...)); serr != nil {
				return 0, nil
			}
		}
		if err != nil {
			break
		}
	}
	err = t.session.Wait()
	var exit *ssh.ExitError
	if errors.As(err, &exit) {
		return exit.ExitStatus(), nil
	}
	return 0, nil
}

// Write types data into terminal id.
func (h Terminals) Write(id, data string) error {
	t, err := h.terms.get(id)
	if err != nil {
		return err
	}
	_, err = io.WriteString(t.stdin, data)
	return err
}

// Resize tells terminal id its new size.
func (h Terminals) Resize(id string, cols, rows int) error {
	t, err := h.terms.get(id)
	if err != nil {
		return err
	}
	return t.session.WindowChange(rows, cols)
}

// Close ends terminal id.
func (h Terminals) Close(id string) {
	h.terms.mu.Lock()
	t := h.terms.byID[id]
	delete(h.terms.byID, id)
	h.terms.mu.Unlock()
	if t != nil {
		t.session.Close()
	}
}

// closeServer ends the terminals of a server.
func (t *terms) closeServer(serverID string) {
	t.mu.Lock()
	var ss []*ssh.Session
	for id, s := range t.byID {
		if s.server == serverID {
			ss = append(ss, s.session)
			delete(t.byID, id)
		}
	}
	t.mu.Unlock()
	for _, s := range ss {
		s.Close()
	}
}
