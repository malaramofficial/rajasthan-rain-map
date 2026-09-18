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

	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/chromedp"
)

type Media struct {
	ExternalPostID string `json:"external_post_id"`
	SourceURL string `json:"source_url"`
	PostedAt string `json:"posted_at"`
	CaptionText string `json:"caption_text"`
	ThumbnailURL string `json:"thumbnail_url"`
	MediaURL string `json:"media_url"`
	Username string `json:"username"`
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
	if err := json.Unmarshal([]byte(body), &resp); err != nil { return nil }
	out := make([]Media, 0, len(resp.Data.Connection.Edges))
	for _, edge := range resp.Data.Connection.Edges {
		m := edge.Node.Media
		if m.PK == "" || m.Code == "" { continue }
		item := Media{ExternalPostID:m.PK, SourceURL:"https://www.instagram.com/reel/"+m.Code+"/", Username:m.User.Username}
		if m.TakenAt > 0 { item.PostedAt=time.Unix(m.TakenAt,0).UTC().Format(time.RFC3339) }
		if m.ImageVersions2 != nil && len(m.ImageVersions2.Candidates)>0 { item.ThumbnailURL=m.ImageVersions2.Candidates[0].URL }
		if m.Caption != nil { item.CaptionText=m.Caption.Text }
		if len(m.Video)>0 { item.MediaURL=m.Video[0].URL }
		out=append(out,item)
	}
	return out
}

func postBatch(media []Media) error {
	if len(media)==0 { return nil }
	endpoint, secret := os.Getenv("RAINS_MAP_INGEST_URL"), os.Getenv("REELS_WORKER_SECRET")
	if endpoint=="" || secret=="" { return fmt.Errorf("RAINS_MAP_INGEST_URL and REELS_WORKER_SECRET are required") }
	payload,_:=json.Marshal(map[string]any{"media":media})
	ctx,cancel:=context.WithTimeout(context.Background(),15*time.Second); defer cancel()
	req,err:=http.NewRequestWithContext(ctx,http.MethodPost,endpoint,strings.NewReader(string(payload))); if err!=nil{return err}
	req.Header.Set("content-type","application/json"); req.Header.Set("authorization","Bearer "+secret)
	resp,err:=http.DefaultClient.Do(req); if err!=nil{return err}; defer resp.Body.Close()
	if resp.StatusCode<200 || resp.StatusCode>=300{return fmt.Errorf("ingest returned HTTP %s",resp.Status)}
	return nil
}

func main() {
	wsURL := os.Getenv("CHROME_CDP_URL")
	if wsURL == "" { wsURL = "ws://127.0.0.1:9222/devtools/browser/" }
	ctx,cancel:=chromedp.NewRemoteAllocator(context.Background(),wsURL); defer cancel()
	ctx,cancel=chromedp.NewContext(ctx); defer cancel()

	seen:=map[string]bool{}; var mu sync.Mutex
	chromedp.ListenTarget(ctx,func(ev interface{}){
		e,ok:=ev.(*fetch.EventRequestPaused); if !ok{return}
		go func(){
			defer func(){_=chromedp.Run(ctx,fetch.ContinueRequest(e.RequestID))}()
			data,err:=fetch.GetResponseBody(e.RequestID).Do(ctx); if err!=nil{return}
			body:=string(data); if !strings.Contains(body,"xdt_api__v1__clips__home__connection_v2"){return}
			for _,media:=range capture(body){
				mu.Lock(); already:=seen[media.ExternalPostID]; if !already{seen[media.ExternalPostID]=true}; mu.Unlock()
				if already{continue}
				log.Printf("captured reel %s @%s",media.SourceURL,media.Username)
				if err:=postBatch([]Media{media}); err!=nil{log.Printf("ingest: %v",err)}
			}
		}()
	})

	if err:=chromedp.Run(ctx,fetch.Enable().WithPatterns([]*fetch.RequestPattern{{URLPattern:"*graphql*",RequestStage:fetch.RequestStageResponse}})); err!=nil{log.Fatal(err)}
	log.Printf("Reels worker attached to existing Chromium CDP: %s",wsURL)
	if err:=chromedp.Run(ctx,chromedp.Navigate("https://www.instagram.com/reels/")); err!=nil{log.Fatal(err)}
	log.Println("Reels passive capture worker is running.")
	sig:=make(chan os.Signal,1); signal.Notify(sig,syscall.SIGINT,syscall.SIGTERM); <-sig
}
