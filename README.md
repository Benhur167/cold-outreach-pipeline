# Cold Outreach Pipeline CLI 🚀

An automated, interactive command-line interface (CLI) tool that builds a complete B2B cold outreach sequence. It discovers lookalike companies, extracts C-Suite decision-makers, finds verified work emails, and schedules outreach campaigns.

Built with Node.js, ESM, and integrates with **Apollo.io**, **Ocean.io**, **Prospeo**, and **Brevo**.

---

## 🌟 Features

* **Interactive CLI Wizard:** Step-by-step console prompt interface built using `inquirer`.
* **Flexible Discovery (Stage 1):** Supports searches via **Apollo.io** (free alternative), **Ocean.io**, or **Manual Domain Input** (Account-Based Marketing).
* **Targeted Enrichment (Stage 2 & 3):** Automatically fetches decision-makers (Founders, CEOs, VPs, Directors) at each company and decrypts verified work emails using **Prospeo** (bypassing Eazyreach constraints).
* **Mailing Automation (Stage 4):** Fills custom dynamic templates (variables like `<FIRST_NAME>`, `<COMPANY_NAME>`) and sends transactional outreach emails using **Brevo**.
* **API Rate-Limit Protection:** Built-in delay throttlers to safely stay within third-party API limit caps.
* **Offline Mock Simulator (`--mock`):** Fully operational simulation mode that runs the pipeline from start to finish without consuming credits or requiring API credentials.
* **Data Portability:** Exports leads to a structured JSON file (`outreach_leads.json`) if emails are not sent.

---

## 🛠️ Installation

1. Navigate to the project directory:
   ```bash
   cd cold-outreach-pipeline
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```

---

## 🚦 How to Run

### 1. Mock Mode (Simulation)
Test the entire pipeline locally without signing up for API keys or spending credits:
```bash
# Run automatic test on google.com
npm run test:mock

# Or launch the interactive prompt in mock mode
node src/index.js
```
*(Select "Mock Mode" when prompted).*

### 2. Production Mode (Real APIs)
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Enter your API credentials in `.env`:
   ```env
   # Stage 1: Apollo/Ocean
   APOLLO_API_KEY=your_apollo_api_key_here
   OCEAN_API_KEY=your_ocean_api_key_here
   
   # Stage 2 & 3: Prospeo
   PROSPEO_API_KEY=your_prospeo_api_key_here
   
   # Stage 4: Brevo
   BREVO_API_KEY=your_brevo_api_key_here
   BREVO_SENDER_EMAIL=you@yourdomain.com
   BREVO_SENDER_NAME="Your Name"
   ```
3. Run the interactive CLI:
   ```bash
   node src/index.js
   ```
   *(Select "Production Mode" when prompted).*

---

## 🚀 CLI Flag Options (Headless Mode)
Run the pipeline programmatically (great for cron jobs or scripting):
```bash
# Target a specific domain directly and export leads
node src/index.js --domain stripe.com

# Target a domain and auto-send emails via Brevo
node src/index.js --domain stripe.com --send

# Run search query, restrict limit, and auto-send in Mock Mode
node src/index.js --mock --provider apollo --query "Software" --limit 3 --send
```
