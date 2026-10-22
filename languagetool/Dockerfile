# LanguageTool's own server (languagetool.org's release, LGPL), for Moshe's
# "Check Text". It is not kept running: systemd starts it on the first check
# and stops it when nobody has checked for a while (see README.md here).
FROM eclipse-temurin:21-jre-alpine
ARG LT_VERSION=6.6
RUN apk add --no-cache curl unzip \
 && curl -fsSL "https://languagetool.org/download/LanguageTool-${LT_VERSION}.zip" -o /tmp/lt.zip \
 && unzip -q /tmp/lt.zip -d /opt && mv /opt/LanguageTool-* /opt/languagetool && rm /tmp/lt.zip \
 && apk del curl unzip \
 && adduser -D -H lt
USER lt
WORKDIR /opt/languagetool
EXPOSE 8010
# a small heap, collected by one thread: memory is what this server must not waste
CMD ["java", "-Xms64m", "-Xmx768m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-Xss512k", \
     "-cp", "languagetool-server.jar", "org.languagetool.server.HTTPServer", "--port", "8010", "--public", "--allow-origin", "*"]
