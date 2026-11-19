package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// Settings are the output (OBS) settings, edited from the control page.
type Settings struct {
	Background string `json:"background"` // transparent | black | white | green | color
	Color      string `json:"color"`      // used when Background == "color"
	Transition string `json:"transition"` // fade300 | fade600 | cut
	Fit        string `json:"fit"`        // contain | cover | width
	Margin     int    `json:"margin"`     // px
	Quality    int    `json:"quality"`    // 1 | 2
	BlackMode  string `json:"blackMode"`  // black | hide
}

func defaultSettings() Settings {
	return Settings{
		Background: "transparent",
		Color:      "#1e1e1e",
		Transition: "fade300",
		Fit:        "contain",
		Margin:     0,
		Quality:    1,
		BlackMode:  "black",
	}
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

// sanitize forces every field into its allowed range.
func (s *Settings) sanitize() {
	d := defaultSettings()
	if !oneOf(s.Background, "transparent", "black", "white", "green", "color") {
		s.Background = d.Background
	}
	if !hexColor.MatchString(s.Color) {
		s.Color = d.Color
	}
	s.Color = strings.ToLower(s.Color)
	if !oneOf(s.Transition, "fade300", "fade600", "cut") {
		s.Transition = d.Transition
	}
	if !oneOf(s.Fit, "contain", "cover", "width") {
		s.Fit = d.Fit
	}
	if s.Margin < 0 {
		s.Margin = 0
	}
	if s.Margin > 400 {
		s.Margin = 400
	}
	if s.Quality != 1 && s.Quality != 2 {
		s.Quality = 1
	}
	if !oneOf(s.BlackMode, "black", "hide") {
		s.BlackMode = d.BlackMode
	}
}

// State is everything that is shown on air. It is persisted to disk and
// broadcast over SSE.
type State struct {
	App        string   `json:"app"`
	Doc        string   `json:"doc"`        // file name inside the documents folder, "" = none
	DocVersion int64    `json:"docVersion"` // mtime of the file, used to bust caches
	Page       int      `json:"page"`       // 1-based
	Pages      int      `json:"pages"`      // 0 = not known yet
	Black      bool     `json:"black"`
	Settings   Settings `json:"settings"`
	DocsRev    int64    `json:"docsRev"` // bumps whenever the document list changes
	Rev        int64    `json:"rev"`     // bumps at every change
}

type persisted struct {
	Doc      string         `json:"doc"`
	Page     int            `json:"page"`
	Black    bool           `json:"black"`
	Settings Settings       `json:"settings"`
	Pages    map[string]int `json:"pages"` // known page counts per document
}

// Store holds the state, persists it and notifies subscribers.
type Store struct {
	mu       sync.Mutex
	st       State
	pages    map[string]int
	path     string
	docsDir  string
	subs     map[chan []byte]struct{}
	saveErrs int
}

func newStore(docsDir string) *Store {
	s := &Store{
		path:    filepath.Join(docsDir, "slideobs-stato.json"),
		docsDir: docsDir,
		pages:   map[string]int{},
		subs:    map[chan []byte]struct{}{},
	}
	s.st = State{App: "SlideOBS", Page: 1, Settings: defaultSettings()}
	s.load()
	return s
}

func (s *Store) load() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var p persisted
	if json.Unmarshal(b, &p) != nil {
		return
	}
	if p.Pages != nil {
		s.pages = p.Pages
	}
	p.Settings.sanitize()
	s.st.Settings = p.Settings
	s.st.Black = p.Black
	if p.Doc != "" {
		if fi, err := os.Stat(filepath.Join(s.docsDir, p.Doc)); err == nil && !fi.IsDir() {
			s.st.Doc = p.Doc
			s.st.DocVersion = fi.ModTime().UnixMilli()
			s.st.Pages = s.pages[p.Doc]
			s.st.Page = p.Page
		}
	}
	s.clampLocked()
}

// saveLocked writes the state atomically. Caller holds mu.
func (s *Store) saveLocked() {
	p := persisted{Doc: s.st.Doc, Page: s.st.Page, Black: s.st.Black, Settings: s.st.Settings, Pages: s.pages}
	b, _ := json.MarshalIndent(p, "", "  ")
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		s.saveErrs++
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		s.saveErrs++
	}
}

func (s *Store) clampLocked() {
	if s.st.Page < 1 {
		s.st.Page = 1
	}
	if s.st.Pages > 0 && s.st.Page > s.st.Pages {
		s.st.Page = s.st.Pages
	}
	if s.st.Doc == "" {
		s.st.Page = 1
		s.st.Pages = 0
	}
}

// Snapshot returns a copy of the current state.
func (s *Store) Snapshot() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st
}

// Update applies fn under the lock; if fn returns true the state is saved
// and broadcast. It returns the resulting state.
func (s *Store) Update(fn func(st *State) bool) State {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := s.st
	if !fn(&s.st) {
		return s.st
	}
	s.clampLocked()
	if s.st == before {
		return s.st
	}
	s.st.Rev++
	s.saveLocked()
	s.broadcastLocked()
	return s.st
}

// SetPages records the page count of a document (reported by the pages).
func (s *Store) SetPages(name string, n int) State {
	s.mu.Lock()
	if n > 0 {
		s.pages[name] = n
	}
	s.mu.Unlock()
	return s.Update(func(st *State) bool {
		if st.Doc == name && n > 0 {
			st.Pages = n
			return true
		}
		return false
	})
}

func (s *Store) PagesOf(name string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pages[name]
}

func (s *Store) ForgetDoc(name string) {
	s.mu.Lock()
	delete(s.pages, name)
	s.mu.Unlock()
}

// DocsChanged bumps DocsRev so control pages refresh the list.
func (s *Store) DocsChanged() {
	s.Update(func(st *State) bool { st.DocsRev++; return true })
}

func (s *Store) Subscribe() chan []byte {
	ch := make(chan []byte, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	b, _ := json.Marshal(s.st)
	s.mu.Unlock()
	ch <- b
	return ch
}

func (s *Store) Unsubscribe(ch chan []byte) {
	s.mu.Lock()
	delete(s.subs, ch)
	s.mu.Unlock()
}

// broadcastLocked sends the latest state to every subscriber. A slow
// subscriber only ever gets the most recent state (older ones are dropped).
func (s *Store) broadcastLocked() {
	b, _ := json.Marshal(s.st)
	for ch := range s.subs {
		select {
		case ch <- b:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- b:
			default:
			}
		}
	}
}
