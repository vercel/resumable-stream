#!/usr/bin/env bash
# Use this script to start a docker container for a local Redis instance

# TO RUN ON WINDOWS:
# 1. Install WSL (Windows Subsystem for Linux) - https://learn.microsoft.com/en-us/windows/wsl/install
# 2. Install Docker Desktop for Windows - https://docs.docker.com/docker-for-windows/install/
# 3. Open WSL - `wsl`
# 4. Run this script - `./start-redis.sh`

# On Linux and macOS you can run this script directly - `./start-redis.sh`

REDIS_CONTAINER_NAME="resumable-stream-redis"

if ! [ -x "$(command -v docker)" ]; then
  echo -e "Docker is not installed. Please install docker and try again.\nDocker install guide: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo "Docker daemon is not running. Please start Docker and try again."
  exit 1
fi

if [ "$(docker ps -q -f name=$REDIS_CONTAINER_NAME)" ]; then
  echo "Redis container '$REDIS_CONTAINER_NAME' already running"
  exit 0
fi

if [ "$(docker ps -q -a -f name=$REDIS_CONTAINER_NAME)" ]; then
  docker start "$REDIS_CONTAINER_NAME"
  echo "Existing redis container '$REDIS_CONTAINER_NAME' started"
  exit 0
fi

# import env variables from .env
set -a
source .env

REDIS_PASSWORD=$(echo "$REDIS_URL" | awk -F':' '{print $3}' | awk -F'@' '{print $1}')
REDIS_PORT=$(echo "$REDIS_URL" | awk -F':' '{print $4}' | awk -F'\/' '{print $1}')

if [ "$REDIS_PASSWORD" = "redis-pw" ]; then
  echo "You are using the default Redis password"
  read -p "Should we generate a random password for you? [y/N]: " -r REPLY
  if ! [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Please change the default Redis password in the .env file and try again"
    exit 1
  fi
  # Generate a random URL-safe password
  REDIS_PASSWORD=$(openssl rand -base64 12 | tr '+/' '-_')
  sed -i -e "s#:redis-pw@#:$REDIS_PASSWORD@#" .env
fi

docker run -d \
  --name $REDIS_CONTAINER_NAME \
  -p "$REDIS_PORT":6379 \
  redis \
  /bin/sh -c "redis-server --requirepass \"$REDIS_PASSWORD\"" \
  && echo "Redis container '$REDIS_CONTAINER_NAME' was successfully created"
