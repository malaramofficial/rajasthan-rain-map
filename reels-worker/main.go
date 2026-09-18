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
	var seenMu sync.Mutex

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

	log.Println("Enabling runtime, network capture, and adding binding...")
	if err := chromedp.Run(ctx, runtime.Enable(), network.Enable(), runtime.AddBinding("reelsGraphQL")); err != nil {
		log.Fatal(err)
	}

	// Install the fetch/XHR hook before navigation so the initial Reels
	// GraphQL responses are captured. Page-level Evaluate after navigation
	// misses the requests that load the first feed.
	log.Println("Installing GraphQL hook before Reels navigation...")
	if err := page.AddScriptToEvaluateOnNewDocument(hook).Do(cdp.WithExecutor(ctx, chromedp.FromContext(ctx).Target)); err != nil {
		log.Fatal(err)
	}

	log.Println("Navigating attached Instagram target to Reels...")
	if err := chromedp.Run(ctx, chromedp.Navigate("https://www.instagram.com/reels/"), chromedp.Sleep(6*time.Second)); err != nil {
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
