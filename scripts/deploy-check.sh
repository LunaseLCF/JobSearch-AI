#!/bin/bash
# Production Deployment Checklist for AI Job Search Web
# Run this script before deploying to verify everything is ready

set -e

echo "🚀 AI Job Search Web — Pre-Deployment Check"
echo "=========================================="
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# 1. Node version check
echo "✓ Checking Node.js version..."
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
if [[ "$NODE_VERSION" == "not found" ]]; then
  echo "❌ Node.js not installed. Install Node.js >= 18.x first."
  exit 1
fi
echo "  Node.js: $NODE_VERSION"

# 2. Python check (for resume parsing)
echo ""
echo "✓ Checking Python..."
PYTHON_VERSION=$(python3 --version 2>/dev/null || python --version 2>/dev/null || echo "not found")
if [[ "$PYTHON_VERSION" == "not found" ]]; then
  echo "⚠️  Python not found. Resume PDF/DOCX parsing will be unavailable."
else
  echo "  Python: $PYTHON_VERSION"
  # Check required packages
  if python3 -c "import pypdf" 2>/dev/null && python3 -c "import docx" 2>/dev/null; then
    echo "  ✓ Required packages: pypdf, python-docx"
  else
    echo "  ⚠️  Missing packages: pip install pypdf python-docx"
  fi
fi

# 3. Dependencies check
echo ""
echo "✓ Checking dependencies..."
if [ -d "node_modules" ]; then
  echo "  ✓ node_modules exists"
else
  echo "  ℹ️  Running npm ci..."
  npm ci --silent
fi

# 4. Environment configuration
echo ""
echo "✓ Checking environment configuration..."
if [ -f ".env" ]; then
  echo "  ✓ .env file found"
else
  echo "  ⚠️  No .env file. Copy .env.example and customize."
fi

# 5. Server syntax validation
echo ""
echo "✓ Validating server code..."
node --check server/index.js && echo "  ✓ server/index.js valid"
node --check server/job-search.js && echo "  ✓ server/job-search.js valid"
node --check server/job-sites.js && echo "  ✓ server/job-sites.js valid"
node --check server/profile-match.js && echo "  ✓ server/profile-match.js valid"
node --check server/salary-lookup.js && echo "  ✓ server/salary-lookup.js valid"

# 6. Frontend validation
echo ""
echo "✓ Validating frontend..."
node --check public/js/app.js && echo "  ✓ public/js/app.js valid"
node --check public/js/i18n.js && echo "  ✓ public/js/i18n.js valid"

# 7. Data directory check
echo ""
echo "✓ Checking data directory..."
if [ ! -d "data" ]; then
  mkdir -p data
  echo "  Created data/ directory"
fi

REQUIRED_FILES=(
  "data/profile.json"
  "data/tracker.json"
  "data/seen_jobs.json"
  "data/applications.json"
  "data/search_queries.json"
  "data/salary_data.json"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  ✗ Missing: $f"
  else
    echo "  ✓ $f exists ($(du -h "$f" | cut -f1))"
  fi
done

# 8. File size check
echo ""
echo "✓ Checking large files..."
LARGE_FILE=$(find data/ -name "*.json" -size +1M 2>/dev/null | head -1)
if [ -n "$LARGE_FILE" ]; then
  echo "  ⚠️  Large file detected: $LARGE_FILE"
  echo "     Consider archiving old data or using a database for production."
fi

# 9. Git repository check
echo ""
echo "✓ Checking git repository..."
if [ -d ".git" ]; then
  echo "  ✓ Git repository initialized"
  git status --short | grep -v "^?" || echo "  ✓ Working tree clean"
else
  echo "  ℹ️  No .git directory found"
fi

# 10. Summary
echo ""
echo "=========================================="
echo "✅ Pre-deployment checks complete!"
echo ""
echo "Next steps:"
echo "  1. Set up process manager: pm2 start ecosystem.config.js"
echo "  2. Configure reverse proxy (nginx/caddy)"
echo "  3. Backup data directory regularly"
echo "  4. Monitor logs: pm2 logs ai-job-search"
echo ""
echo "Deploy command:"
echo "  pm2 deploy ecosystem.config.js production"
echo "=========================================="
