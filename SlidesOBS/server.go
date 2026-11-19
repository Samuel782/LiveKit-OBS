package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxUpload = 1 << 30 // 1 GiB

type Server struct {
	store   *Store
	docsDir string
	web     fs.FS
	port    int
	quit    chan struct{} // closed at shutdown: ends SSE streams cleanly
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/control", s.page("control.html"))
	mux.HandleFunc("/output", s.page("output.html"))
	mux.Handle("/static/", http.StripPrefix("/static/", s.staticHandler()))
	mux.HandleFunc("/docs/", s.handleDoc)

	cmd := func(fn func(r *http.Request) (any, int, error)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "Metodo non consentito")
				return
			}
			res, code, err := fn(r)
			if err != nil {
				writeErr(w, code, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, res)
		}
	}
	step := func(fn func(st *State)) http.HandlerFunc {
		return cmd(func(r *http.Request) (any, int, error) {
			return s.store.Update(func(st *State) bool { fn(st); return true }), 0, nil
		})
	}
	mux.HandleFunc("/api/next", step(func(st *State) { st.Page++ }))
	mux.HandleFunc("/api/prev", step(func(st *State) { st.Page-- }))
	mux.HandleFunc("/api/first", step(func(st *State) { st.Page = 1 }))
	mux.HandleFunc("/api/last", step(func(st *State) {
		if st.Pages > 0 {
			st.Page = st.Pages
		}
	}))
	mux.HandleFunc("/api/goto", cmd(func(r *http.Request) (any, int, error) {
		p, err := strconv.Atoi(strings.TrimSpace(param(r, "p", "page")))
		if err != nil {
			return nil, http.StatusBadRequest, errors.New("Parametro p mancante o non valido (es. /api/goto?p=3)")
		}
		return s.store.Update(func(st *State) bool { st.Page = p; return true }), 0, nil
	}))
	mux.HandleFunc("/api/black", cmd(func(r *http.Request) (any, int, error) {
		on := strings.ToLower(strings.TrimSpace(param(r, "on")))
		return s.store.Update(func(st *State) bool {
			switch on {
			case "1", "true", "on", "si", "sì", "yes":
				st.Black = true
			case "0", "false", "off", "no":
				st.Black = false
			default:
				st.Black = !st.Black
			}
			return true
		}), 0, nil
	}))
	mux.HandleFunc("/api/state", cmd(func(r *http.Request) (any, int, error) {
		return s.store.Snapshot(), 0, nil
	}))
	mux.HandleFunc("/api/events", s.handleEvents)
	mux.HandleFunc("/api/upload", s.handleUpload)
	mux.HandleFunc("/api/list", cmd(func(r *http.Request) (any, int, error) {
		docs, err := s.listDocs()
		if err != nil {
			return nil, http.StatusInternalServerError, err
		}
		return map[string]any{"docs": docs, "dir": s.docsDir}, 0, nil
	}))
	mux.HandleFunc("/api/open", cmd(func(r *http.Request) (any, int, error) {
		name, err := s.existingDoc(param(r, "name", "doc"))
		if err != nil {
			return nil, http.StatusNotFound, err
		}
		return s.openDoc(name), 0, nil
	}))
	mux.HandleFunc("/api/delete", cmd(func(r *http.Request) (any, int, error) {
		name, err := s.existingDoc(param(r, "name", "doc"))
		if err != nil {
			return nil, http.StatusNotFound, err
		}
		if err := os.Remove(filepath.Join(s.docsDir, name)); err != nil {
			return nil, http.StatusInternalServerError, fmt.Errorf("Impossibile eliminare: %v", err)
		}
		s.store.ForgetDoc(name)
		s.store.Update(func(st *State) bool {
			if st.Doc == name {
				st.Doc, st.DocVersion, st.Page, st.Pages = "", 0, 1, 0
			}
			st.DocsRev++
			return true
		})
		return s.store.Snapshot(), 0, nil
	}))
	mux.HandleFunc("/api/pages", cmd(func(r *http.Request) (any, int, error) {
		name := param(r, "name", "doc")
		n, err := strconv.Atoi(param(r, "n", "pages"))
		if err != nil || n < 1 || n > 100000 {
			return nil, http.StatusBadRequest, errors.New("Numero di pagine non valido")
		}
		if _, err := s.existingDoc(name); err != nil {
			return nil, http.StatusNotFound, err
		}
		before := s.store.PagesOf(name)
		st := s.store.SetPages(name, n)
		if before != n {
			s.store.DocsChanged()
		}
		return st, 0, nil
	}))
	mux.HandleFunc("/api/settings", cmd(func(r *http.Request) (any, int, error) {
		var patch map[string]any
		if r.Method == http.MethodPost && strings.Contains(r.Header.Get("Content-Type"), "json") {
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&patch); err != nil {
				return nil, http.StatusBadRequest, errors.New("JSON non valido")
			}
		} else {
			_ = r.ParseForm()
			patch = map[string]any{}
			for k, v := range r.Form {
				if len(v) > 0 {
					patch[k] = v[0]
				}
			}
		}
		st := s.store.Update(func(st *State) bool {
			applySettings(&st.Settings, patch)
			return true
		})
		return st.Settings, 0, nil
	}))
	return s.guard(mux)
}

// guard blocks DNS-rebinding and cross-site requests from web pages while
// allowing local tools (Stream Deck, Companion, curl) that send no
// browser fetch metadata.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.Trim(strings.ToLower(host), "[]")
		if host != "localhost" && host != "127.0.0.1" && host != "::1" && !strings.HasSuffix(host, ".localhost") {
			http.Error(w, "Host non consentito", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			switch r.Header.Get("Sec-Fetch-Site") {
			case "", "same-origin", "none":
			default:
				writeErr(w, http.StatusForbidden, "Richiesta da un altro sito bloccata")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func applySettings(set *Settings, patch map[string]any) {
	str := func(k string) (string, bool) {
		v, ok := patch[k]
		if !ok {
			return "", false
		}
		switch t := v.(type) {
		case string:
			return strings.TrimSpace(t), true
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64), true
		case bool:
			return strconv.FormatBool(t), true
		}
		return "", false
	}
	num := func(k string) (int, bool) {
		v, ok := str(k)
		if !ok {
			return 0, false
		}
		f, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSuffix(v, "x"), "px"), 64)
		if err != nil {
			return 0, false
		}
		return int(f + 0.5), true
	}
	if v, ok := str("background"); ok {
		set.Background = v
	}
	if v, ok := str("color"); ok {
		if !strings.HasPrefix(v, "#") {
			v = "#" + v
		}
		set.Color = v
	}
	if v, ok := str("transition"); ok {
		set.Transition = v
	}
	if v, ok := str("fit"); ok {
		set.Fit = v
	}
	if v, ok := num("margin"); ok {
		set.Margin = v
	}
	if v, ok := num("quality"); ok {
		set.Quality = v
	}
	if v, ok := str("blackMode"); ok {
		set.BlackMode = v
	}
	set.sanitize()
}

// param reads a parameter from the query string, a form body or a JSON body.
func param(r *http.Request, keys ...string) string {
	for _, k := range keys {
		if v := r.URL.Query().Get(k); v != "" {
			return v
		}
	}
	if r.Method != http.MethodPost || r.Body == nil {
		return ""
	}
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "json") {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		r.Body = io.NopCloser(bytes.NewReader(body))
		var m map[string]any
		if json.Unmarshal(body, &m) == nil {
			for _, k := range keys {
				switch v := m[k].(type) {
				case string:
					return v
				case float64:
					return strconv.FormatFloat(v, 'f', -1, 64)
				case bool:
					if v {
						return "1"
					}
					return "0"
				}
			}
		}
		return ""
	}
	if strings.Contains(ct, "form") {
		_ = r.ParseForm()
		for _, k := range keys {
			if v := r.PostForm.Get(k); v != "" {
				return v
			}
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]any{"ok": false, "error": msg})
}

func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/":
		http.Redirect(w, r, "/control", http.StatusFound)
	case "/favicon.ico":
		w.Header().Set("Content-Type", "image/svg+xml")
		b, _ := fs.ReadFile(s.web, "favicon.svg")
		_, _ = w.Write(b)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) page(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, err := fs.ReadFile(s.web, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(b)
	}
}

var mimeTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".wasm":  "application/wasm",
	".bcmap": "application/octet-stream",
	".pfb":   "application/octet-stream",
	".ttf":   "font/ttf",
	".icc":   "application/octet-stream",
}

// staticHandler serves embedded files with explicit MIME types (the Windows
// registry sometimes maps .js to text/plain, which breaks ES modules).
func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)[1:]
		f, err := s.web.Open(p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		fi, err := f.Stat()
		if err != nil || fi.IsDir() {
			http.NotFound(w, r)
			return
		}
		ct, ok := mimeTypes[strings.ToLower(path.Ext(p))]
		if !ok {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		if strings.HasPrefix(p, "vendor/") {
			w.Header().Set("Cache-Control", "public, max-age=86400")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, "", startTime, f.(io.ReadSeeker))
	})
}

var startTime = time.Now()

func (s *Server) handleDoc(w http.ResponseWriter, r *http.Request) {
	name, err := url.PathUnescape(strings.TrimPrefix(r.URL.EscapedPath(), "/docs/"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	name, err = s.existingDoc(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(s.docsDir, name))
}

// existingDoc validates a document name and checks it exists.
func (s *Server) existingDoc(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `/\`) || strings.HasPrefix(name, ".") ||
		!strings.EqualFold(filepath.Ext(name), ".pdf") {
		return "", errors.New("Documento non valido")
	}
	fi, err := os.Stat(filepath.Join(s.docsDir, name))
	if err != nil || fi.IsDir() {
		return "", errors.New("Documento non trovato")
	}
	return name, nil
}

func (s *Server) openDoc(name string) State {
	var ver int64
	if fi, err := os.Stat(filepath.Join(s.docsDir, name)); err == nil {
		ver = fi.ModTime().UnixMilli()
	}
	pages := s.store.PagesOf(name)
	return s.store.Update(func(st *State) bool {
		st.Doc, st.DocVersion, st.Page, st.Pages = name, ver, 1, pages
		return true
	})
}

type DocInfo struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
	Pages int    `json:"pages"`
}

func (s *Server) listDocs() ([]DocInfo, error) {
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return nil, err
	}
	docs := []DocInfo{}
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || strings.HasPrefix(n, ".") || !strings.EqualFold(filepath.Ext(n), ".pdf") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		docs = append(docs, DocInfo{Name: n, Size: fi.Size(), Mtime: fi.ModTime().UnixMilli(), Pages: s.store.PagesOf(n)})
	}
	sort.Slice(docs, func(i, j int) bool { return docs[i].Mtime > docs[j].Mtime })
	return docs, nil
}

var unsafeChars = regexp.MustCompile(`[\x00-\x1f<>:"/\\|?*]+`)

func cleanFilename(raw string) string {
	if dec, err := url.QueryUnescape(raw); err == nil {
		raw = dec
	}
	raw = strings.ReplaceAll(raw, "\\", "/")
	raw = path.Base(raw)
	raw = unsafeChars.ReplaceAllString(raw, "_")
	raw = strings.Trim(raw, " .")
	if raw == "" || raw == "_" {
		raw = "documento.pdf"
	}
	if r := []rune(raw); len(r) > 150 {
		ext := filepath.Ext(raw)
		raw = string(r[:150-len([]rune(ext))]) + ext
	}
	return raw
}

const exportMsg = "Esporta la presentazione in PDF (File > Esporta > PDF)"

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "Usa POST con il file nel corpo della richiesta")
		return
	}
	name := cleanFilename(r.Header.Get("X-Filename"))
	if q := r.URL.Query().Get("name"); r.Header.Get("X-Filename") == "" && q != "" {
		name = cleanFilename(q)
	}
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".pptx", ".ppt", ".pps", ".ppsx", ".key", ".odp", ".otp":
		writeErr(w, http.StatusUnsupportedMediaType, exportMsg)
		return
	case ".pdf":
	default:
		writeErr(w, http.StatusUnsupportedMediaType, "Sono accettati solo file PDF. "+exportMsg)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	tmp, err := os.CreateTemp(s.docsDir, ".upload-*.tmp")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Impossibile scrivere nella cartella dei documenti: "+err.Error())
		return
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	head := make([]byte, 1024)
	n, _ := io.ReadFull(r.Body, head)
	head = head[:n]
	if !bytes.Contains(head, []byte("%PDF-")) {
		tmp.Close()
		msg := "Il file non è un PDF valido."
		if bytes.HasPrefix(head, []byte("PK\x03\x04")) {
			msg = exportMsg
		}
		writeErr(w, http.StatusUnsupportedMediaType, msg)
		return
	}
	if _, err := tmp.Write(head); err == nil {
		_, err = io.Copy(tmp, r.Body)
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, http.StatusRequestEntityTooLarge, "File troppo grande (massimo 1 GB)")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Caricamento interrotto: "+err.Error())
		return
	}
	dest := filepath.Join(s.docsDir, name)
	if err := os.Rename(tmpName, dest); err != nil {
		writeErr(w, http.StatusInternalServerError, "Impossibile salvare il file: "+err.Error())
		return
	}
	if n := countPDFPages(dest); n > 0 {
		s.store.SetPages(name, n)
	} else {
		s.store.ForgetDoc(name)
	}
	st := s.store.Snapshot()
	opened := false
	switch st.Doc {
	case "":
		// Nothing on air yet: open the new document.
		s.openDoc(name)
		opened = true
	case name:
		// The document on air was replaced: reload it, keeping the page.
		var ver int64
		if fi, err := os.Stat(dest); err == nil {
			ver = fi.ModTime().UnixMilli()
		}
		pages := s.store.PagesOf(name)
		s.store.Update(func(st *State) bool { st.DocVersion, st.Pages = ver, pages; return true })
		opened = true
	}
	s.store.DocsChanged()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name, "opened": opened, "state": s.store.Snapshot()})
}

var pageObj = regexp.MustCompile(`/Type\s*/Page[^s]`)

// countPDFPages is a cheap heuristic that works for PDFs without object
// streams. The pages report the exact count through /api/pages anyway.
func countPDFPages(p string) int {
	fi, err := os.Stat(p)
	if err != nil || fi.Size() > 200<<20 {
		return 0
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return 0
	}
	if bytes.Contains(b, []byte("/ObjStm")) {
		return 0
	}
	return len(pageObj.FindAll(b, -1))
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming non supportato", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 1500\n\n")
	fl.Flush()

	ch := s.store.Subscribe()
	defer s.store.Unsubscribe(ch)
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.quit:
			return
		case b := <-ch:
			if _, err := fmt.Fprintf(w, "event: state\ndata: %s\n\n", b); err != nil {
				return
			}
			fl.Flush()
		case <-tick.C:
			if _, err := fmt.Fprintf(w, "event: ping\ndata: %d\n\n", time.Now().Unix()); err != nil {
				return
			}
			fl.Flush()
		}
	}
}
