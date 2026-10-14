//go:build gossh_automate

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/egoist/mygo"
)

// A development driver, in builds with -tags gossh_automate only: the
// window runs GOSSH_AUTOMATE/eval.js when it appears and writes the result
// to out.json, and a capture of the window to shot.png.

func init() {
	automate = func(win *mygo.Window) {
		dir := os.Getenv("GOSSH_AUTOMATE")
		if dir == "" {
			return
		}
		go func() {
			script := filepath.Join(dir, "eval.js")
			for {
				time.Sleep(300 * time.Millisecond)
				b, err := os.ReadFile(script)
				if err != nil {
					continue
				}
				os.Remove(script)
				res, err := win.Page().Eval(string(b))
				out := map[string]any{"result": res}
				if err != nil {
					out["error"] = err.Error()
				}
				if png, err := win.CapturePage(); err == nil {
					os.WriteFile(filepath.Join(dir, "shot.png"), png, 0o644)
				}
				j, _ := json.MarshalIndent(out, "", "  ")
				os.WriteFile(filepath.Join(dir, "out.json"), j, 0o644)
			}
		}()
	}
}
