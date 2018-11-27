#!/bin/bash
set -e

# Cleanup www folder
rm -rf /var/www
# Copy and install the latest & greatest Latex-Online
git clone https://github.com/otim-project/builder
cd /var/www
npm install .

export NODE_ENV=production
export VERSION=$(git rev-parse HEAD)

node build.js
