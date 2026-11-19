// SlideOBS: a single self-contained executable that shows PDF slides in
// OBS Studio through a Browser source.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

//go:embed all:web
var webFS embed.FS

const appName = "SlideOBS"

var version = "1.0.0"

func main() {
	noBrowser := flag.Bool("no-browser", false, "non aprire il browser all'avvio")
	port := flag.Int("port", 8765, "porta preferita (se occupata prova le successive)")
	dataDir := flag.String("dir", "", "cartella dei documenti (predefinita: SlideOBS-documenti accanto al programma)")
	flag.Parse()

	setConsoleTitle(appName)

	web, err := fs.Sub(webFS, "web")
	if err != nil {
		fatal("risorse interne mancanti: %v", err)
	}

	docsDir, err := pickDocsDir(*dataDir)
	if err != nil {
		fatal("impossibile creare la cartella dei documenti: %v", err)
	}

	ln, usedPort, existing := listen(*port)
	if existing != "" {
		// Another SlideOBS is already running: just show it.
		fmt.Println()
		fmt.Println("  SlideOBS è già in esecuzione.")
		fmt.Println("  Regia: " + existing + "/control")
		fmt.Println()
		if !*noBrowser {
			openBrowser(existing + "/control")
		}
		pauseOnWindows(6 * time.Second)
		return
	}
	if ln == nil {
		fatal("nessuna porta libera tra %d e %d", *port, *port+40)
	}

	store := newStore(docsDir)
	srv := &Server{store: store, docsDir: docsDir, web: web, port: usedPort, quit: make(chan struct{})}
	httpSrv := &http.Server{
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	base := fmt.Sprintf("http://localhost:%d", usedPort)
	printBanner(base, docsDir, usedPort, *port)

	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("errore del server: %v", err)
		}
	}()

	if !*noBrowser {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(base + "/control")
		}()
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	fmt.Println("\n  Spegnimento…")
	close(srv.quit)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if httpSrv.Shutdown(ctx) != nil {
		_ = httpSrv.Close()
	}
}

func printBanner(base, docsDir string, used, wanted int) {
	line := strings.Repeat("=", 64)
	fmt.Println()
	fmt.Println("  " + line)
	fmt.Printf("    SlideOBS %s — slide PDF per OBS Studio\n", version)
	fmt.Println("  " + line)
	fmt.Println()
	fmt.Println("    REGIA (apri nel browser):")
	fmt.Println("      " + base + "/control")
	fmt.Println()
	fmt.Println("    URL DA INCOLLARE IN OBS (sorgente Browser, 1920x1080):")
	fmt.Println("      " + base + "/output")
	fmt.Println()
	fmt.Println("    CARTELLA DEI DOCUMENTI:")
	fmt.Println("      " + docsDir)
	fmt.Println()
	if used != wanted {
		fmt.Printf("    ATTENZIONE: la porta %d era occupata, uso la %d.\n", wanted, used)
		fmt.Println("    Aggiorna l'URL in OBS con quello qui sopra.")
		fmt.Println()
	}
	fmt.Println("  " + line)
	if runtime.GOOS == "windows" {
		fmt.Println("    Chiudi questa finestra per spegnere SlideOBS.")
	} else {
		fmt.Println("    Chiudi questa finestra (o premi Ctrl+C) per spegnere SlideOBS.")
	}
	fmt.Println("  " + line)
	fmt.Println()
}

// listen binds 127.0.0.1 on the first free port starting at want. If the
// wanted port is taken by another SlideOBS, it returns its base URL instead.
func listen(want int) (net.Listener, int, string) {
	for p := want; p <= want+40 && p < 65536; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			return ln, p, ""
		}
		if base := fmt.Sprintf("http://localhost:%d", p); isSlideOBS(p) {
			return nil, 0, base
		}
	}
	return nil, 0, ""
}

func isSlideOBS(port int) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/state", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var st struct {
		App string `json:"app"`
	}
	return json.NewDecoder(resp.Body).Decode(&st) == nil && st.App == appName
}

// pickDocsDir returns "SlideOBS-documenti" next to the executable, or in the
// user data folder when that is not writable.
func pickDocsDir(override string) (string, error) {
	if override != "" {
		abs, err := filepath.Abs(override)
		if err != nil {
			return "", err
		}
		return abs, ensureWritable(abs)
	}
	var tried []string
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		d := filepath.Join(filepath.Dir(exe), "SlideOBS-documenti")
		if !strings.Contains(d, "AppTranslocation") && ensureWritable(d) == nil {
			return d, nil
		}
		tried = append(tried, d)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "", fmt.Errorf("%v (provate: %v)", err, tried)
		}
		base = home
	}
	d := filepath.Join(base, "SlideOBS", "SlideOBS-documenti")
	return d, ensureWritable(d)
}

func ensureWritable(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	if err := cmd.Start(); err != nil {
		fmt.Println("  (Impossibile aprire il browser: apri tu l'indirizzo della regia.)")
		return
	}
	go func() { _ = cmd.Wait() }()
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "\n  ERRORE: "+format+"\n\n", a...)
	pauseOnWindows(0)
	os.Exit(1)
}
