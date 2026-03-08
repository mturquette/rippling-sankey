# Rippling Paystub Sankey Diagram

Visualize your compensation flow from gross pay to net pay using interactive Sankey diagrams. Parses Rippling paystub PDFs and generates beautiful visualizations showing how your salary flows through taxes, deductions, and employer contributions.

## What It Does

This tool takes your Rippling paystub PDFs and creates an interactive Sankey diagram that shows:

- **Total Compensation** breakdown (salary + employer contributions)
- **Earnings** flow (salary, bonuses, reimbursements)
- **Withholding** (federal, state, Medicare, Social Security taxes)
- **Deductions** (401k, health insurance, HSA, etc.)
- **Employer Contributions** (401k match, insurance contributions)
- **Net Pay** - what actually hits your bank account

The diagram visually represents the relative size of each flow, making it easy to understand where your money goes.

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/rippling-sankey.git
cd rippling-sankey

# Install dependencies
npm install
```

## Usage

### 1. Export Your Paystubs from Rippling

1. Log into [Rippling](https://app.rippling.com)
2. Navigate to **My Rippling** → **Pay** → **Pay History**
3. Download your paystub PDFs
4. Place them in `Rippling_paystubs/` directory (create subfolders by year if desired)

```
Rippling_paystubs/
├── 2025/
│   ├── Nov 1, 2025 – Nov 14, 2025 - ....pdf
│   └── ...
└── 2026/
    ├── Jan 1, 2026 – Jan 14, 2026 - ....pdf
    └── ...
```

### 2. Generate the Sankey Diagram

**Quick start - Year to date:**
```bash
npm run sankey:ytd:open
```

This parses all paystubs from January 1st of the current year, builds the visualization, and opens it in your browser.

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run sankey:ytd:open` | Full pipeline for year-to-date, opens in browser |
| `npm run sankey:open` | Full pipeline for all paystubs, opens in browser |
| `npm run parse:ytd` | Parse paystubs from Jan 1 to today |
| `npm run parse:month` | Parse paystubs from current month only |
| `npm run parse` | Parse all paystubs (no date filter) |
| `npm run build` | Build Plotly visualization data |
| `npm run render:open` | Render HTML and open in browser |

**Custom date range:**
```bash
node parse-paystubs.js --range=2025-01-01:2025-06-30
npm run build
npm run render:open
```

## Output

Generated files are saved to `output/` (excluded from git):

```
output/
├── paystubs/          # Parsed JSON data
│   └── paystubs_2026-01-01_2026-02-28.json
├── plotly/            # Plotly visualization data
│   └── plotly_2026-01-01_2026-02-28.json
└── render/            # Final HTML files
    └── sankey_2026-01-01_2026-02-28.html
```

## How It Works

1. **parse-paystubs.js** - Extracts text from PDF paystubs using `pdf-parse`, parses earnings, taxes, deductions, and summary data into structured JSON

2. **build-plotly.js** - Aggregates data across pay periods, calculates totals, and builds the Sankey diagram node/link structure

3. **render-plotly.js** - Generates a standalone HTML file with embedded Plotly.js that renders the interactive Sankey diagram

## Project Structure

```
rippling-sankey/
├── parse-paystubs.js    # PDF parsing and data extraction
├── build-plotly.js      # Sankey diagram data builder
├── render-plotly.js     # HTML renderer with Plotly.js
├── config.js            # Centralized configuration (colors, settings)
├── utils/
│   └── logger.js        # Logging utility
├── Rippling_paystubs/   # Your paystub PDFs (git-ignored)
├── output/              # Generated files (git-ignored)
└── package.json
```

## Privacy

Your paystub data stays local:
- PDF files in `Rippling_paystubs/` are git-ignored
- Output files in `output/` are git-ignored
- No data is sent to any external service
- All processing happens locally

## Requirements

- Node.js 18+
- Rippling paystub PDFs (the parser is designed for Rippling's specific format)

## License

MIT
