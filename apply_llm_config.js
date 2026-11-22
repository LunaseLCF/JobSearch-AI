const fs = require('fs');
const PATH = 'D:/Users/Admin/WorkBuddy AI/2026-11-17-22-21-42/ai-job-search-web/public/js/app.js';

let s = fs.readFileSync(PATH, 'utf8');

// 1. Add nav case for llm-config after report case
const caseReport = "    case 'report': renderReport(); break;";
const newCases = caseReport + "\n    case 'llm-config': renderLLMConfig(); break;";
s = s.replace(caseReport, newCases);
console.log('Nav case added:', s.includes("case 'llm-config'"));

// 2. Insert before Salary section (line 1447)
const salaryMarker = "// ============ Salary Lookup ============";
const idx = s.indexOf(salaryMarker);
if (idx < 0) {
  console.log('ERROR: Could not find insertion point');
  process.exit(1);
}

const llmConfigCode = `// ============ LLM Configuration ============
async function renderLLMConfig() {
  const config = await API.get('llm-config');
  document.getElementById('page-content').innerHTML = \\\`
    <h1 class=\"page-title\">LLM Config</h1>
    <p class=\"page-subtitle\">Configure an external LLM provider for AI-powered question answering and interview prep enhancement</p>

    <div class=\"card\">
      <div class=\"card-header\">
        <div class=\"card-title\">Provider Configuration</div>
      </div>
      <div class=\"form-group\"><label>Provider</label><input type=\"text\" class=\"form-input\" id=\"llm-provider\" placeholder=\"OpenAI, Azure, Anthropic, OpenRouter...\" value=\"\${config.provider || ''}\"></div>
      <div class=\"form-group\"><label>API Key</label><input type=\"password\" class=\"form-input\" id=\"llm-api-key\" placeholder=\"sk-... or your API key\"></div>
      <div class=\"form-group\"><label>Model Name</label><input type=\"text\" class=\"form-input\" id=\"llm-model\" placeholder=\"gpt-4o-mini, gpt-4-turbo, claude-3-haiku...\" value=\"\${config.model || ''}\"></div>
      <div class=\"form-group\"><label>Base URL (optional)</label><input type=\"text\" class=\"form-input\" id=\"llm-base-url\" placeholder=\"https://api.openai.com/v1 (leave blank for default)\" value=\"\${config.baseUrl || ''}\"></div>
      <div style=\"display:flex;gap:8px;margin-top:12px\">
        <button class=\"btn btn-primary\" onclick=\"saveLLMConfig()\">Save Configuration</button>
        <button class=\"btn btn-secondary\" onclick=\"testLLMConnection()\">Test Connection</button>
      </div>
      <div id=\"llm-status\"></div>
    </div>

    <div class=\"card\" style=\"margin-top:16px\">
      <div class=\"card-header\">
        <div class=\"card-title\">Saved Configurations</div>
      </div>
      <div id=\"llm-saved-list\">\${config.lastTested ? '<p style=\"font-size:13px;color:var(--text-muted)\">Last configured: ' + new Date(config.lastTested).toLocaleString() + '</p>' : '<p style=\"font-size:13px;color:var(--text-muted)\">No configurations saved yet</p>'}</div>
    </div>
  \\\`;
}

async function saveLLMConfig() {
  const provider = document.getElementById('llm-provider')?.value.trim();
  const apiKey = document.getElementById('llm-api-key')?.value.trim();
  const model = document.getElementById('llm-model')?.value.trim();
  const baseUrl = document.getElementById('llm-base-url')?.value.trim();

  if (!provider || !apiKey || !model) {
    showLLMStatus('Please fill in all required fields', 'error');
    return;
  }

  try {
    const result = await API.post('llm-config', { provider, apiKey, model, baseUrl });
    if (result.ok) {
      showLLMStatus('Configuration saved successfully', 'success');
    } else {
      showLLMStatus(result.error || 'Save failed', 'error');
    }
  } catch (err) {
    showLLMStatus('Network error: ' + err.message, 'error');
  }
}

async function testLLMConnection() {
  const provider = document.getElementById('llm-provider')?.value.trim();
  const apiKey = document.getElementById('llm-api-key')?.value.trim();
  const model = document.getElementById('llm-model')?.value.trim();
  const baseUrl = document.getElementById('llm-base-url')?.value.trim();

  if (!provider || !apiKey || !model) {
    showLLMStatus('Please fill in all required fields before testing', 'error');
    return;
  }

  showLLMStatus('<div style=\"display:flex;align-items:center;gap:8px\"><div class=\"loader\"></div> Testing connection...</div>', 'info');

  try {
    // Use fetch directly for the test since we need custom headers
    const testUrl = baseUrl ? baseUrl + '/models' : 'https://api.openai.com/v1/models';
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      showLLMStatus('Connection test successful! Your provider configuration looks good.', 'success');
    } else {
      showLLMStatus('Connection test returned non-OK status: ' + response.status + '. Please check your credentials.', 'error');
    }
  } catch (err) {
    showLLMStatus('Connection test failed: ' + err.message + '. Check your network or API endpoint.', 'error');
  }
}

function showLLMStatus(html, type) {
  const statusEl = document.getElementById('llm-status');
  if (!statusEl) return;

  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
  const color = colors[type] || colors.info;

  statusEl.innerHTML = '<p style=\"color:' + color + ';margin-top:12px;font-size:14px\">' + html + '</p>';
}

`;

s = s.slice(0, idx) + llmConfigCode + s[idx];
fs.writeFileSync(PATH, s, 'utf8');
console.log('LLM Config functions inserted at position', idx);
