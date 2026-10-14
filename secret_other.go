//go:build !windows

package main

// Elsewhere credentials are kept as they are, in servers.json, which only
// the user can read (0600).

func protect(b []byte) ([]byte, error)   { return b, nil }
func unprotect(b []byte) ([]byte, error) { return b, nil }

const platformEncrypts = false
