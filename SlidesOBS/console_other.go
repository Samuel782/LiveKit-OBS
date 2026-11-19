//go:build !windows

package main

import "time"

func setConsoleTitle(title string) {}

func pauseOnWindows(d time.Duration) {
	if d > 0 {
		time.Sleep(d / 3)
	}
}
