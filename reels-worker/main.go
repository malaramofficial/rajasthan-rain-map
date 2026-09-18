package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chromedp/cdproto/fetch"
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
	userDataDir := os.Getenv("INSTAGRAM_CHROME_PROFILE")
	if userDataDir == "" {
		userDataDir = "./instagram-profile"
	}
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.UserDataDir(userDataDir),
		chromedp.Flag("headless", false),
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()
	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	seen := map[string]bool{}
	chromedp.ListenTarget(ctx, func(ev interface{}) {
		e, ok := ev.(*fetch.EventRequestPaused)
		if !ok {
			return
		}
		go func() {
			defer func() { _ = chromedp.Run(ctx, fetch.ContinueRequest(e.RequestID)) }()
			var body []byte
			if err := chromedp.Run(ctx, chromedp.ActionFunc(func(c context.Context) error {
				data, err := fetch.GetResponseBody(e.RequestID).Do(c)
				if err != nil {
					return err
				}
				body = data
				return nil
			})); err != nil {
				return
			}
			bodyText := string(body)
			if !strings.Contains(bodyText, "xdt_api__v1__clips__home__connection_v2") {
				return
			}
			_ = decodePostData(e)
			for _, media := range capture(bodyText) {
				if seen[media.ExternalPostID] {
					continue
				}
				seen[media.ExternalPostID] = true
				log.Printf("captured reel %s @%s", media.SourceURL, media.Username)
				if err := postBatch([]Media{media}); err != nil {
					log.Printf("ingest: %v", err)
				}
			}
		}()
	})

	if err := chromedp.Run(ctx,
		fetch.Enable().WithPatterns([]*fetch.RequestPattern{{
			URLPattern: "*graphql*",
			RequestStage: fetch.RequestStageResponse,
		}}),
		chromedp.Navigate("https://www.instagram.com/reels/"),
	); err != nil {
		log.Fatal(err)
	}

	log.Println("Reels passive capture worker is running. Log into Instagram in the opened browser if needed.")
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
}
