package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"golang.org/x/crypto/ssh"
)

// run runs a command on a client and returns what it printed, stdout and
// stderr together. Canceling ctx ends it.
func run(ctx context.Context, c *ssh.Client, cmd string) ([]byte, error) {
	s, err := c.NewSession()
	if err != nil {
		return nil, err
	}
	defer s.Close()
	out := &syncBuffer{}
	s.Stdout, s.Stderr = out, out
	done := make(chan error, 1)
	go func() { done <- s.Run(cmd) }()
	select {
	case err = <-done:
	case <-ctx.Done():
		s.Signal(ssh.SIGKILL)
		s.Close()
		err = ctx.Err()
	}
	return out.Bytes(), err
}

// syncBuffer is a buffer two copies can write to at once. It has no
// ReadFrom on purpose: concurrent bytes.Buffer.ReadFrom calls lose data.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	return bytes.Clone(b.buf.Bytes())
}

// BulkEvent is news of a command run on many servers.
type BulkEvent struct {
	ServerID string `json:"serverId"`
	Kind     string `json:"kind"` // "start", "output" or "done"
	Data     string `json:"data,omitempty"`
	Code     int    `json:"code"`            // exit code, with "done"
	Error    string `json:"error,omitempty"` // with "done", when it could not run
	Millis   int    `json:"millis"`          // duration, with "done"
}

// Bulk runs commands on many servers at once.
type Bulk struct{ *Hub }

// Run runs command on servers, at most parallel at a time, and streams
// their output. Closing the channel stops every command.
func (h Bulk) Run(ctx context.Context, ids []string, command string, parallel int, out *mygo.Channel[BulkEvent]) error {
	return h.run(ctx, ids, command, parallel, out.Send)
}

func (h Bulk) run(ctx context.Context, ids []string, command string, parallel int, out func(BulkEvent) error) error {
	if len(ids) == 0 {
		return errors.New("aucun serveur sélectionné")
	}
	if parallel <= 0 {
		parallel = 16
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var sendMu sync.Mutex
	send := func(e BulkEvent) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if out(e) != nil {
			cancel()
		}
	}
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			h.runOne(ctx, id, command, send)
		}()
	}
	wg.Wait()
	return nil
}

func (h Bulk) runOne(ctx context.Context, id, command string, send func(BulkEvent)) {
	start := time.Now()
	send(BulkEvent{ServerID: id, Kind: "start"})
	done := func(code int, err error) {
		e := BulkEvent{ServerID: id, Kind: "done", Code: code, Millis: int(time.Since(start).Milliseconds())}
		if err != nil {
			e.Error = err.Error()
		}
		send(e)
	}
	dctx, cancel := context.WithTimeout(ctx, 2*dialTimeout)
	c, err := h.pool.Client(dctx, id)
	cancel()
	if err != nil {
		done(-1, err)
		return
	}
	s, err := c.NewSession()
	if err != nil {
		done(-1, err)
		return
	}
	defer s.Close()
	w := &lineWriter{flush: func(b []byte) { send(BulkEvent{ServerID: id, Kind: "output", Data: string(b)}) }}
	s.Stdout, s.Stderr = w, w
	res := make(chan error, 1)
	go func() { res <- s.Run(command) }()
	select {
	case err = <-res:
	case <-ctx.Done():
		s.Signal(ssh.SIGKILL)
		s.Close()
		err = errors.New("arrêté")
	}
	w.Close()
	var exit *ssh.ExitError
	switch {
	case errors.As(err, &exit):
		done(exit.ExitStatus(), nil)
	case err != nil:
		done(-1, err)
	default:
		done(0, nil)
	}
}

// lineWriter sends output by whole lines, at most every 100 ms, so that
// UTF-8 characters and bursts arrive in one piece.
type lineWriter struct {
	mu    sync.Mutex
	buf   []byte
	last  time.Time
	flush func([]byte)
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	if len(w.buf) > 64*1024 || time.Since(w.last) > 100*time.Millisecond {
		w.send(false)
	}
	return len(p), nil
}

// send flushes the complete lines, or everything when all is set; the
// caller holds w.mu.
func (w *lineWriter) send(all bool) {
	n := len(w.buf)
	if !all {
		n = bytes.LastIndexByte(w.buf, '\n') + 1
		if n == 0 && len(w.buf) > 4096 {
			n = len(w.buf)
			for n > 0 && !utf8.Valid(w.buf[:n]) {
				n--
			}
		}
	}
	if n == 0 {
		return
	}
	w.flush(bytes.Clone(w.buf[:n]))
	w.buf = w.buf[n:]
	w.last = time.Now()
}

func (w *lineWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.send(true)
	return nil
}

var _ io.WriteCloser = (*lineWriter)(nil)
