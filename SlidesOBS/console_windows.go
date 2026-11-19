//go:build windows

package main

import (
	"bufio"
	"os"
	"syscall"
	"time"
	"unsafe"
)

var kernel32 = syscall.NewLazyDLL("kernel32.dll")

func setConsoleTitle(title string) {
	p, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	_, _, _ = kernel32.NewProc("SetConsoleTitleW").Call(uintptr(unsafe.Pointer(p)))
}

// pauseOnWindows keeps the console window open so the user can read the
// message. d == 0 waits for Enter.
func pauseOnWindows(d time.Duration) {
	if d > 0 {
		time.Sleep(d)
		return
	}
	os.Stdout.WriteString("  Premi Invio per chiudere...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
