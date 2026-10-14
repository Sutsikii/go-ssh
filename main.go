// gossh manages SSH servers in bulk: an inventory, terminals in tabs,
// live statistics and commands run on many servers at once.
package main

import (
	"embed"
	"io/fs"
	"log"
	"os"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// automate drives the window in development builds (automate.go).
var automate func(*mygo.Window)

//go:embed all:web
var web embed.FS

func main() {
	app := mygo.App
	app.SetName("gossh")
	mygo.Use(updater.Plugin)

	dir, err := app.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}
	// GOSSH_DATA uses another data directory, such as for development.
	if d := os.Getenv("GOSSH_DATA"); d != "" {
		dir = d
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Fatal(err)
		}
	}
	hub, err := NewHub(dir)
	if err != nil {
		log.Fatal(err)
	}
	mygo.Bind(Servers{hub})
	mygo.Bind(Terminals{hub})
	mygo.Bind(Monitor{hub})
	mygo.Bind(Bulk{hub})
	mygo.Bind(App{hub})
	mygo.Theme.SetSource(hub.settings.Theme)

	page, _ := fs.Sub(web, "web")
	mygo.Protocol.Handle("mygo", mygo.FileServer(page))

	app.WhenReady(func() {
		hub.mon.sync()
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "gossh",
			Width:           1320,
			Height:          820,
			MinWidth:        820,
			MinHeight:       520,
			StateKey:        "main",
			BackgroundColor: "light-dark(#f3f3f1, #0e0e10)",
			URL:             "/",
		})
		if automate != nil {
			automate(win)
		}
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
