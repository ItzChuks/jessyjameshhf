FROM alpine:latest

ARG PB_VERSION=0.40.5

RUN apk add --no-cache unzip ca-certificates

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

COPY ./pb_migrations /pb/pb_migrations
COPY ./pb_hooks /pb/pb_hooks

EXPOSE 8080

# Railway provides $PORT. Data lives in /pb/pb_data (mount a Railway Volume there).
CMD ["/bin/sh", "-c", "/pb/pocketbase serve --http=0.0.0.0:${PORT:-8080}"]
