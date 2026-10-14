package main

import (
	"fmt"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// ReadClipboard returns the text on the clipboard, "" when there is none.
func (h App) ReadClipboard() string {
	b, _ := mygo.Clipboard.ReadFormat(transfer.Text)
	return string(b)
}

// WriteClipboard puts text on the clipboard. Another program may hold it
// open for a moment.
func (h App) WriteClipboard(text string) error {
	for try := 0; ; try++ {
		err := mygo.Clipboard.Write(transfer.TextData(text))
		if err == nil {
			return nil
		}
		if try == 9 {
			return fmt.Errorf("presse-papier occupé : %w", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
