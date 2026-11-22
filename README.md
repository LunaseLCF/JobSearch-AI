# AI Job Search Web

AI-powered job application assistant with profile matching, salary lookup, and application tracking.

sample page : https://jobsearch-ai-z1t8.onrender.com/login
## Features

- **Job Search** — Fetch listings from RemoteOK, Arbeitnow, and custom site templates
- **Profile Matching** — Score jobs against your experience, skills, and target companies
- **Location Filtering** — Smart country/city detection with fallback to remote positions
- **Salary Lookup** — Fuzzy company search with benchmark indices across Asia-Pacific markets
- **Application Tracker** — CRUD pipeline from Draft → Active → Interview → Offer → Hired/Rejected
- **LaTeX CV & Cover Letter** — Generate professional documents automatically
- **Interview Prep** — STAR examples, likely questions, talking points
- **Resume Analysis** — Upload PDF/DOCX/TXT to auto-fill profile fields
- **Multi-language UI** — English, Thai, Chinese interface

## Tech Stack

- **Backend**: Node.js (pure JavaScript, no frameworks or external dependencies)
- **Frontend**: Vanilla JS SPA with CSS Grid/Flexbox
- **Data Storage**: JSON files in `data/` directory
- **Resume Parsing**: Python scripts via subprocess (pypdf + python-docx)

## Requirements

- Node.js >= 18.0.0
- Python 3.8+ (for PDF/DOCX resume extraction only — optional if you don't use that feature)

## Quick Start

```bash
# Clone or copy the project
cd ai-job-search-web

# Install dependencies (none required for core functionality)
npm install

# Run development server
npm run dev
# Or production server on port 3000
npm start

# Or specify a custom port
PORT=8080 npm start
```

Visit `http://localhost:3000` in your browser.

## Production Deployment

### Option 1: Direct Node.js process

```bash
NODE_ENV=production PORT=3000 node server/index.js
```

Use a process manager like PM2:

```bash
# Install PM2 globally
npm install -g pm2

# Start with config
pm2 start server/index.js --name "ai-job-search" --max-memory-restart 500M

# Or use ecosystem file (see ecosystem.config.js)
pm2 start ecosystem.config.js

# Save startup config for reboot
pm2 save && pm2 startup
```

### Option 2: Docker

```bash
# Build image
docker build -t ai-job-search .

# Run container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --name ai-job-search \
  ai-job-search
```

See `Dockerfile` and `docker-compose.yml` for details.

### Option 3: Cloud Platform (VPS/DigitalOcean/AWS)

```bash
# Connect to your server and clone/deploy
git clone <your-repo> ai-job-search-web
cd ai-job-search-web

# Install Node.js and dependencies
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm ci --production

# Set environment variables
cp .env.example .env
nano .env
# Update PORT and NODE_ENV

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Then set up nginx reverse proxy (optional):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Configuration

### Environment Variables

| Variable   | Default     | Description                      |
|-----------|-------------|----------------------------------|
| `PORT`    | `3000`      | HTTP server port                 |
| `NODE_ENV`| `development`| Environment (`development` or `production`) |

Create `.env` from `.env.example` and customize as needed.

### Data Directory

All user data is stored in the `data/` directory:

- `profile.json` — Candidate profile (personal info, experience, skills)
- `tracker.json` — Application tracker entries
- `seen_jobs.json` — Discovered job listings
- `applications.json` — Submitted applications
- `search_queries.json` — Saved search queries
- `salary_data.json` — Salary benchmarks
- `custom_job_sites.json` — User-added job sites

**Backup tip**: Copy the entire `data/` directory before upgrades to preserve your work.

## API Reference

### GET `/api/profile`
Get current candidate profile.

### POST `/api/jobs/search`
Search live job APIs.
```json
{
  "keywords": "import export manager",
  "limit": 40,
  "location": "Bangkok"
}
```

### GET `/api/jobs/discovered`
Get all discovered jobs filtered by location and profile match.

### POST `/api/jobs/retrieve`
Retrieve jobs from a specific URL with multi-strategy fallback.
```json
{
  "url": "https://boards.greenhouse.io/company/jobs",
  "keywords": "",
  "location": ""
}
```

### POST `/api/jobs/parse-text`
Parse job listings from pasted text (for sites that block automated access).
```json
{
  "text": "Senior Engineer\nAcme Corp | Remote\n..."
}
```

### GET/POST/PUT/DELETE `/api/tracker/:id`
CRUD operations for application tracking.

### GET/PUT `/api/salary`
Salary lookup and management.

### GET/POST `/api/search-queries`
Manage saved search priorities.

Full API docs available at `server/index.js`.

## License

MIT
