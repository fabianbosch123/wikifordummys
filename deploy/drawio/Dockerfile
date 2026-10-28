# draw.io (diagrams.net, Apache-2.0) als statische Web-App für Zeichnungen auf Wiki-Seiten.
# Kein Java/Tomcat: Caddy liefert nur die Dateien aus (wenige MB Arbeitsspeicher). Die App läuft komplett im Browser,
# eingebettet im Seiteneditor; Zeichnungen speichert das Wiki selbst als Anhang (PNG mit eingebetteten draw.io-Daten).
# Neue Version: DRAWIO_VERSION und DRAWIO_SHA256 (sha256sum von draw.war) gemeinsam ändern.
ARG CADDY_IMAGE=caddy:2

FROM ${CADDY_IMAGE} AS fetch
ARG DRAWIO_VERSION=32.4.1
ARG DRAWIO_SHA256=b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820
RUN wget -q -O /tmp/draw.war "https://github.com/jgraph/drawio/releases/download/v${DRAWIO_VERSION}/draw.war" \
  && echo "${DRAWIO_SHA256}  /tmp/draw.war" | sha256sum -c - \
  && mkdir -p /srv/draw \
  && unzip -q /tmp/draw.war -d /srv/draw \
  && rm -rf /tmp/draw.war /srv/draw/WEB-INF /srv/draw/META-INF \
  && find /srv/draw -name '*.map' -delete \
  && chmod -R a+rX /srv/draw
# Adressen auf den eigenen Server unter /draw/ statt app.diagrams.net
COPY PreConfig.js /srv/draw/js/PreConfig.js

FROM ${CADDY_IMAGE}
# Sicherheitsupdates aus Alpine, solange das Caddy-Image sie noch nicht enthält (z. B. brotli-libs, CVE-2026-111497)
RUN apk upgrade --no-cache
COPY --from=fetch /srv/draw /srv/draw
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
