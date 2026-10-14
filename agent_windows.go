package main

import (
	"io"
	"os"
)

// dialAgent opens the Windows OpenSSH agent's named pipe.
func dialAgent() (io.ReadWriteCloser, error) {
	return os.OpenFile(`\.\pipe\openssh-ssh-agent`, os.O_RDWR, 0)
}
