FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/reels-worker .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/reels-worker /app/reels-worker
ENV CHROME_BIN=/usr/bin/chromium
ENV INSTAGRAM_CHROME_PROFILE=/data/instagram-profile
ENV INSTAGRAM_HEADLESS=false
ENTRYPOINT ["/app/reels-worker"]
