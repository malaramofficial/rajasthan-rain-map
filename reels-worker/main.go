package main

import (
	"github.com/chromedp/cdproto/target"
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
						PK string `json:"pk"`
						TakenAt int64 `json:"taken_at"`
						Code string `json:"code"`
						ImageVersions2 *struct {
							Candidates []struct { URL string `json:"url"` } `json:"candidates"`
						} `json:"image_versions2"`
						Caption *struct{ Text string `json:"text"` } `json:"caption"`
						Video []struct{ URL string `json:"url"` } `json:"video_versions"`
						User struct{ Username string `json:"username"` } `json:"user"`
					} `json:"media"`
				} `json:"node"`
			} `json:"edges"`
		} `json:"xdt_api__v1__clips__home__connection_v2"`
	} `json:"data"`
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

	// Attach to an existing Instagram page target.
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
	// Prefer an existing Instagram page, but fall back to any normal page.
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

	chromedp.ListenTarget(ctx, func(ev interface{}) {
		e, ok := ev.(*runtime.EventBindingCalled)
		if !ok || e.Name != "reelsGraphQL" {
			return
		}

		body := e.Payload
		log.Printf("GRAPHQL BINDING: bytes=%d", len(body))
		if len(body) <= 1000 {
			log.Printf("GRAPHQL BODY: %q", body)
		} else {
			// Keep a compact fingerprint of larger responses so we can diagnose
			// which GraphQL operation is actually reaching the worker without
			// flooding the terminal with full response bodies.
			if i := strings.Index(body, "xdt_api__v1__"); i >= 0 {
				end := i + 120
				if end > len(body) {
					end = len(body)
				}
				log.Printf("GRAPHQL KEY HINT: %q", body[i:end])
			}
		}

		if !strings.Contains(body, "xdt_api__v1__clips__home__connection_v2") {
			log.Printf("GRAPHQL: expected reels connection key not found")
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

	log.Println("Enabling runtime and adding binding...")
	if err := chromedp.Run(ctx, runtime.Enable(), runtime.AddBinding("reelsGraphQL")); err != nil {
		log.Fatal(err)
	}

	log.Println("Navigating attached Instagram target to Reels...")
	if err := chromedp.Run(ctx, chromedp.Navigate("https://www.instagram.com/reels/"), chromedp.Sleep(4*time.Second)); err != nil {
		log.Fatal(err)
	}
	log.Println("Installing hook in the loaded Reels page...")
	if err := chromedp.Run(ctx, chromedp.Evaluate(hook, nil)); err != nil {
		log.Fatal(err)
	}
	log.Println("Hook installed after navigation; passive capture is starting.")
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
