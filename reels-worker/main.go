package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

type Media struct {
	ExternalPostID string `json:"external_post_id"`
	SourceURL      string `json:"source_url"`
	PostedAt       string `json:"posted_at"`
	CaptionText    string `json:"caption_text"`
	ThumbnailURL   string `json:"thumbnail_url"`
	MediaURL       string `json:"media_url"`
	Username       string `json:"username"`
}

type genericGraphQL struct {
	Data any `json:"data"`
}

func capture(body string) []Media {
	var root genericGraphQL
	if err := json.Unmarshal([]byte(body), &root); err != nil {
		return nil
	}
	var out []Media
	walkJSON(root.Data, &out)
	return dedupeMedia(out)
}

func walkJSON(v any, out *[]Media) {
	switch x := v.(type) {
	case map[string]any:
		if m, ok := mediaFromMap(x); ok {
			*out = append(*out, m)
		}
		for _, child := range x {
			walkJSON(child, out)
		}
	case []any:
		for _, child := range x {
			walkJSON(child, out)
		}
	}
}

func mediaFromMap(m map[string]any) (Media, bool) {
	pk := firstString(m, "pk", "id")
	code := firstString(m, "code", "shortcode")
	if pk == "" || code == "" {
		return Media{}, false
	}

	item := Media{
		ExternalPostID: pk,
		SourceURL:      "https://www.instagram.com/reel/" + code + "/",
		Username:       nestedString(m, "user", "username"),
		CaptionText:   captionText(m),
		ThumbnailURL:  firstURL(m, "image_versions2", "candidates"),
		MediaURL:      firstURL(m, "video_versions"),
	}
	if ts := firstInt64(m, "taken_at", "taken_at_timestamp", "timestamp"); ts > 0 {
		item.PostedAt = time.Unix(ts, 0).UTC().Format(time.RFC3339)
	}
	return item, true
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
		if n, ok := m[k].(json.Number); ok {
			return n.String()
		}
		if f, ok := m[k].(float64); ok && f != 0 {
			return fmt.Sprintf("%.0f", f)
		}
	}
	return ""
}

func nestedString(m map[string]any, parent, key string) string {
	if child, ok := m[parent].(map[string]any); ok {
		return firstString(child, key)
	}
	return ""
}

func captionText(m map[string]any) string {
	if c, ok := m["caption"].(map[string]any); ok {
		return firstString(c, "text")
	}
	if c, ok := m["caption"].(string); ok {
		return c
	}
	return firstString(m, "caption_text", "title")
}

func firstURL(m map[string]any, key string, nested ...string) string {
	v, ok := m[key]
	if !ok {
		return ""
	}
	return findURL(v, nested...)
}

func findURL(v any, nested ...string) string {
	switch x := v.(type) {
	case map[string]any:
		for _, k := range nested {
			if child, ok := x[k]; ok {
				if u := findURL(child); u != "" {
					return u
				}
			}
		}
		for _, k := range []string{"url", "src"} {
			if s, ok := x[k].(string); ok && strings.HasPrefix(s, "http") {
				return s
			}
		}
		for _, child := range x {
			if u := findURL(child); u != "" {
				return u
			}
		}
	case []any:
		for _, child := range x {
			if u := findURL(child); u != "" {
				return u
			}
		}
	}
	return ""
}

func firstInt64(m map[string]any, keys ...string) int64 {
	for _, k := range keys {
		switch n := m[k].(type) {
		case float64:
			return int64(n)
		case json.Number:
			if v, err := n.Int64(); err == nil {
				return v
			}
		case string:
			var v int64
			if _, err := fmt.Sscan(n, &v); err == nil {
				return v
			}
		}
	}
	return 0
}

func dedupeMedia(in []Media) []Media {
	seen := make(map[string]bool)
	out := make([]Media, 0, len(in))
	for _, m := range in {
		if m.ExternalPostID == "" || seen[m.ExternalPostID] {
			continue
		}
		seen[m.ExternalPostID] = true
		out = append(out, m)
	}
	return out
}

func postBatch(media []Media) error {
	if len(media) == 0 {
		return nil
	}
	endpoint := os.Getenv("RAINS_MAP_INGEST_URL")
	secret := os.Getenv("REELS_WORKER_SECRET")
	if endpoint == "" || secret == "" {
		return fmt.Errorf("RAINS_MAP_INGEST_URL and REELS_WORKER_SECRET are required")
	}
	payload, _ := json.Marshal(map[string]any{"media": media})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+secret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("ingest returned HTTP %s", resp.Status)
	}
	return nil
}

type cdpVersion struct {
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func resolveCDPURL() (string, error) {
	if wsURL := strings.TrimSpace(os.Getenv("CHROME_CDP_URL")); wsURL != "" {
		return wsURL, nil
	}
	port := os.Getenv("CHROME_CDP_PORT")
	if port == "" {
		port = "9222"
	}
	versionURL := "http://127.0.0.1:" + port + "/json/version"
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(versionURL)
	if err != nil {
		return "", fmt.Errorf("Chromium CDP not reachable at %s: %w", versionURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Chromium CDP endpoint returned HTTP %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read CDP version: %w", err)
	}
	var v cdpVersion
	if err := json.Unmarshal(body, &v); err != nil {
		return "", fmt.Errorf("parse CDP version: %w", err)
	}
	if v.WebSocketDebuggerURL == "" {
		return "", fmt.Errorf("CDP /json/version has no webSocketDebuggerUrl")
	}
	return v.WebSocketDebuggerURL, nil
}

func main() {
	wsURL, err := resolveCDPURL()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Reels worker attaching to Chromium CDP: %s", wsURL)

	allocCtx, allocCancel := chromedp.NewRemoteAllocator(context.Background(), wsURL)
	defer allocCancel()

	port := os.Getenv("CHROME_CDP_PORT")
	if port == "" {
		port = "9222"
	}
	resp, err := http.Get("http://127.0.0.1:" + port + "/json/list")
	if err != nil {
		log.Fatalf("read Chromium targets: %v", err)
	}
	defer resp.Body.Close()

	var targets []struct {
		ID string `json:"id"`
		Type string `json:"type"`
		URL string `json:"url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		log.Fatalf("parse Chromium targets: %v", err)
	}

	var targetID string
	for _, t := range targets {
		if t.Type == "page" && strings.Contains(t.URL, "instagram.com/") {
			targetID = t.ID
			break
		}
	}
	if targetID == "" {
		for _, t := range targets {
			if t.Type == "page" {
				targetID = t.ID
				break
			}
		}
	}
	if targetID == "" {
		log.Fatal("no page target found in Chromium")
	}
	log.Printf("Attaching to Chromium page target: %s", targetID)

	ctx, cancel := chromedp.NewContext(allocCtx, chromedp.WithTargetID(target.ID(targetID)))
	defer cancel()

	seen := make(map[string]bool)
	var seenMu sync.Mutex

	hook := `(function() {
		if (window.__reelsHookInstalled) return;
		window.__reelsHookInstalled = true;
		function send(url, response) {
			try {
				if (!url || (!url.includes("/api/graphql") && !url.includes("/graphql/query"))) return;
				response.clone().text().then(function(body) {
					if (body && typeof window.reelsGraphQL === "function") window.reelsGraphQL(body);
				}).catch(function() {});
			} catch (_) {}
		}
		const originalFetch = window.fetch;
		window.fetch = async function(...args) {
			const response = await originalFetch.apply(this, args);
			const request = args[0];
			const url = typeof request === "string" ? request : (request && request.url) || "";
			send(url, response);
			return response;
		};
		const originalOpen = XMLHttpRequest.prototype.open;
		const originalSend = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.open = function(method, url, ...rest) {
			this.__reelsURL = String(url || "");
			return originalOpen.call(this, method, url, ...rest);
		};
		XMLHttpRequest.prototype.send = function(...args) {
			this.addEventListener("load", function() {
				try {
					const url = this.__reelsURL || this.responseURL || "";
					if (!url.includes("/api/graphql") && !url.includes("/graphql/query")) return;
					const body = typeof this.responseText === "string" ? this.responseText : "";
					if (body && typeof window.reelsGraphQL === "function") window.reelsGraphQL(body);
				} catch (_) {}
			});
			return originalSend.apply(this, args);
		};
	})();`


	chromedp.ListenTarget(ctx, func(ev interface{}) {
		if e, ok := ev.(*network.EventResponseReceived); ok {
			url := e.Response.URL
			if strings.Contains(url, "/api/graphql") || strings.Contains(url, "/graphql/query") {
				log.Printf("GRAPHQL RESPONSE: request=%s status=%d url=%s", e.RequestID, e.Response.Status, url)
			}
		}
		if e, ok := ev.(*runtime.EventBindingCalled); ok && e.Name == "reelsGraphQL" {
			body := e.Payload
			log.Printf("GRAPHQL BINDING: bytes=%d", len(body))
			preview := body
			if len(preview) > 700 {
				preview = preview[:700]
			}
			log.Printf("GRAPHQL BODY PREVIEW: %q", preview)
			media := capture(body)
			if len(media) > 0 {
				log.Printf("CAPTURED REELS FROM BINDING: %d", len(media))
				for _, m := range media {
					seenMu.Lock()
					alreadySeen := seen[m.ExternalPostID]
					if !alreadySeen {
						seen[m.ExternalPostID] = true
					}
					seenMu.Unlock()
					if alreadySeen {
						continue
					}
					log.Printf("REEL: id=%s user=%s url=%s", m.ExternalPostID, m.Username, m.SourceURL)
					if err := postBatch([]Media{m}); err != nil {
						log.Printf("ingest: %v", err)
					} else {
						log.Printf("INGEST OK: %s", m.ExternalPostID)
					}
				}
			}
		}
	})


	log.Println("Enabling runtime, network capture, and adding binding...")
	if err := chromedp.Run(ctx, runtime.Enable(), network.Enable(), runtime.AddBinding("reelsGraphQL")); err != nil {
		log.Fatal(err)
	}

	log.Println("Installing GraphQL hook before Reels navigation...")
	if _, err := page.AddScriptToEvaluateOnNewDocument(hook).Do(cdp.WithExecutor(ctx, chromedp.FromContext(ctx).Target)); err != nil {
		log.Fatal(err)
	}

	log.Println("Navigating attached Instagram target to Reels...")
	if err := chromedp.Run(ctx, chromedp.Navigate("https://www.instagram.com/reels/"), chromedp.Sleep(4*time.Second)); err != nil {
		log.Fatal(err)
	}
	log.Println("Pre-navigation hook is active; passive capture is starting.")

	var pageURL, pageTitle, pageText string
	if err := chromedp.Run(ctx, chromedp.Evaluate(`location.href`, &pageURL)); err == nil {
		log.Printf("PAGE URL: %s", pageURL)
	}
	if err := chromedp.Run(ctx, chromedp.Title(&pageTitle)); err == nil {
		log.Printf("PAGE TITLE: %s", pageTitle)
	}
	if err := chromedp.Run(ctx, chromedp.Evaluate(`document.body ? document.body.innerText.slice(0, 2000) : ""`, &pageText)); err == nil {
		pageText = strings.ReplaceAll(pageText, "\n", " | ")
		log.Printf("PAGE TEXT: %q", pageText)
	}

	log.Println("Triggering a small scroll sequence to cause Reels API activity...")
	if err := chromedp.Run(ctx, chromedp.Evaluate(`window.scrollBy(0, Math.max(400, window.innerHeight));`, nil), chromedp.Sleep(2*time.Second)); err != nil {
		log.Printf("scroll trigger: %v", err)
	}

	log.Println("Reels passive capture worker is running.")
	log.Println("Instagram Reels feed is open in the attached Chromium browser.")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}
