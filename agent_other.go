//go:build !windows

package main

import (
	"errors"
	"io"
	"net"
	"os"
)

// dialAgent opens the agent of SSH_AUTH_SOCK.
func dialAgent() (io.ReadWriteCloser, error) {
	sock := os.Getenv("SSH_AUTH_SOCK")
	if sock == "" {
		return nil, errors.New("pas d'agent SSH")
	}
	return net.Dial("unix", sock)
}
