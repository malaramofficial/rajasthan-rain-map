package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

type Media struct {
	ExternalPostID string `json:"external_post_id"`
	SourceURL     string `json:"source_url"`
	PostedAt      string `json:"posted_at"`
	CaptionText   string `json:"caption_text"`
	ThumbnailURL  string `json:"thumbnail_url"`
	MediaURL      string `json:"media_url"`
	Username      string `json:"username"`
}

type reelResponse struct {
	Data struct {
		Connection struct {
			Edges []struct {
				Node struct {
					Media struct {
						PK          string `json:"pk"`
						TakenAt     int64  `json:"taken_at"`
						Code        string `json:"code"`
						ImageVersions2 *struct { Candidates []struct { URL string `json:"url"` } `json:"candidates"` } `json:"image_versions2"`
						Caption     *struct{ Text string `json:"text"` } `json:"caption"`
						Video       []struct{ URL string `json:"url"` } `json:"video_versions"`
						User        struct{ Username string `json:"username"` } `json:"user"`
					} `json:"media"`
				} `json:"node"`
			} `json:"edges"`
		} `json:"xdt_api__v1__clips__home__connection_v2"`
	} `json:"data"`
}

func decodePostData(e *fetch.EventRequestPaused) string {
	var raw []byte
	for _, entry := range e.Request.PostDataEntries {
		if decoded, err := base64.StdEncoding.DecodeString(entry.Bytes); err == nil {
			raw = append(raw, decoded...)
		}
	}
	return string(raw)
}

func capture(body string) []Media {
	var resp reelResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return nil
	}
	out := make([]Media, 0, len(resp.Data.Connection.Edges))
	for _, edge := range resp.Data.Connection.Edges {
		m := edge.Node.Media
		if m.PK == "" || m.Code == "" {
			continue
		}
		item := Media{
			ExternalPostID: m.PK,
			SourceURL: "https://www.instagram.com/reel/" + m.Code + "/",
		}
		if m.TakenAt > 0 {
			item.PostedAt = time.Unix(m.TakenAt, 0).UTC().Format(time.RFC3339)
		}
		if m.ImageVersions2 != nil && len(m.ImageVersions2.Candidates) > 0 {
			item.ThumbnailURL = m.ImageVersions2.Candidates[0].URL
		}
		if m.Caption != nil {
			item.CaptionText = m.Caption.Text
		}
		if len(m.Video) > 0 {
			item.MediaURL = m.Video[0].URL
		}
		item.Username = m.User.Username
		out = append(out, item)
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

func main() {
	wsURL := os.Getenv("CHROME_CDP_URL")
	if wsURL == "" {
		wsURL = "ws://127.0.0.1:9222"
	}

	allocCtx, allocCancel := chromedp.NewRemoteAllocator(context.Background(), wsURL)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	seen := make(map[string]bool)
	var seenMu sync.Mutex

	chromedp.ListenTarget(ctx, func(ev interface{}) {
		e, ok := ev.(*runtime.EventBindingCalled)
		if !ok || e.Name != "reelsGraphQL" {
			return
		}

		body := e.Payload
		log.Printf("GRAPHQL BINDING: bytes=%d", len(body))

		if !strings.Contains(body, "xdt_api__v1__clips__home__connection_v2") {
			return
		}

		media := capture(body)
		log.Printf("CAPTURED REELS: %d", len(media))

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

	if err := chromedp.Run(ctx, runtime.Enable(), runtime.AddBinding("reelsGraphQL")); err != nil {
		log.Fatal(err)
	}

	if _, err := page.AddScriptToEvaluateOnNewDocument(hook).Do(ctx); err != nil {
		log.Fatal(err)
	}

	if err := chromedp.Run(ctx, chromedp.Evaluate(hook, nil), chromedp.Navigate("https://www.instagram.com/reels/")); err != nil {
		log.Fatal(err)
	}

	log.Println("Reels passive capture worker is running.")
	log.Println("Instagram Reels feed is open in the attached Chromium browser.")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}
