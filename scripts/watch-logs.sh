#!/bin/bash
# Watch sandbox container logs in dev mode
# Continuously watches for new containers (handles crash loops)
#
# Usage: ./scripts/watch-logs.sh
# Or: nub run dev:logs

echo "Watching for sandbox containers (Ctrl+C to stop)..."
echo "=================================================="

# Find container by name pattern (workerd-s0-*)
find_container() {
    docker ps --filter "name=workerd-s0-" --format '{{.ID}}' 2>/dev/null | head -1
}

LAST_CONTAINER_ID=""

while true; do
    CONTAINER_ID=$(find_container)
    
    if [ -z "$CONTAINER_ID" ]; then
        # No container running, wait and retry
        echo "[$(date '+%H:%M:%S')] Waiting for container to start..."
        sleep 2
        continue
    fi
    
    # Check if this is a new container
    if [ "$CONTAINER_ID" != "$LAST_CONTAINER_ID" ]; then
        if [ -n "$LAST_CONTAINER_ID" ]; then
            echo ""
            echo "=================================================="
            echo "[$(date '+%H:%M:%S')] Container changed: $LAST_CONTAINER_ID -> $CONTAINER_ID"
            echo "=================================================="
        else
            echo "[$(date '+%H:%M:%S')] Found container: $CONTAINER_ID"
            echo "=================================================="
        fi
        LAST_CONTAINER_ID="$CONTAINER_ID"
    fi
    
    # Follow logs until container stops (this blocks until container exits)
    docker logs -f "$CONTAINER_ID" 2>&1 || true
    
    echo ""
    echo "[$(date '+%H:%M:%S')] Container $CONTAINER_ID stopped, waiting for restart..."
    sleep 1
done
