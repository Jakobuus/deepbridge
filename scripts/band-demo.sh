#!/bin/sh
# Band demo: 4 agents review the Larsen/Bayer intro, human approves in the room.
cd "$(dirname "$0")/../service" && exec python3 band_agents.py "$@"
