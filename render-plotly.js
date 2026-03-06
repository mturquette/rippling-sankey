import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { logger } from './utils/logger.js';
import { COLORS, CHART_CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const openFlag = args.some(arg => arg === '--open');
  const inputFile = args.find(arg => !arg.startsWith('--'));

  return { inputFile, open: openFlag };
}

// Extract date range from filename
function extractDateRange(filename) {
  const match = filename.match(/plotly_(\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2})\.json/);
  if (match) {
    return match[1];
  }
  return null;
}

// Find most recent plotly file
function findMostRecentPlotly() {
  const plotlyDir = path.join(__dirname, 'output', 'plotly');

  if (!fs.existsSync(plotlyDir)) {
    logger.error(`Plotly directory not found: ${plotlyDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(plotlyDir)
    .filter(f => f.startsWith('plotly_') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(plotlyDir, f),
      mtime: fs.statSync(path.join(plotlyDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    logger.error(`No plotly files found in: ${plotlyDir}`);
    process.exit(1);
  }

  return files[0].path;
}

// Validate Plotly data structure before rendering
function validatePlotlyData(data) {
  if (!data.nodes || !Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error('Invalid data: missing or empty nodes array');
  }
  if (!data.links || !Array.isArray(data.links)) {
    throw new Error('Invalid data: missing links array');
  }

  const nodeCount = data.nodes.length;
  for (let i = 0; i < data.links.length; i++) {
    const link = data.links[i];
    if (link.source < 0 || link.source >= nodeCount) {
      throw new Error(`Invalid link at index ${i}: source index ${link.source} out of bounds (0-${nodeCount - 1})`);
    }
    if (link.target < 0 || link.target >= nodeCount) {
      throw new Error(`Invalid link at index ${i}: target index ${link.target} out of bounds (0-${nodeCount - 1})`);
    }
    if (typeof link.value !== 'number' || link.value < 0) {
      throw new Error(`Invalid link at index ${i}: value must be a non-negative number`);
    }
  }
}

// Generate HTML with embedded Plotly Sankey diagram
function generateHTML(data, dateRange) {
  const displayDateRange = dateRange
    ? dateRange.replace(/_/g, ' to ')
    : 'Unknown Date Range';

  // Legend items synchronized with COLORS from config
  const legendItems = [
    { color: COLORS.totalCompensationRoot, label: 'Total Compensation' },
    { color: COLORS.earningsCategory, label: 'Gross Earnings' },
    { color: COLORS.salary, label: 'Salary' },
    { color: COLORS.employerContributionsCategory, label: 'Employer Contributions' },
    { color: COLORS.taxesCategory, label: 'Withholding' },
    { color: COLORS.deductionsCategory, label: 'Deductions' },
    { color: COLORS.netPay, label: 'Net Pay' }
  ];

  const legendHTML = legendItems.map(item => `
        <div class="legend-item">
          <div class="legend-color" style="background: ${item.color};"></div>
          <div class="legend-label">${item.label}</div>
        </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rippling Sankey Diagram: ${dateRange || 'Payroll'}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js" crossorigin="anonymous"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }

    .container {
      max-width: ${CHART_CONFIG.containerMaxWidth}px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }

    h1 {
      font-size: 2em;
      margin-bottom: 10px;
    }

    .date-range {
      font-size: 1.1em;
      opacity: 0.9;
    }

    #sankey {
      width: 100%;
      height: calc(100vh - 200px);
      min-height: 400px;
      max-height: 1000px;
      padding: 20px;
    }

    .info {
      padding: 20px 30px;
      background: #f8f9fa;
      border-top: 1px solid #dee2e6;
    }

    .info h2 {
      font-size: 1.2em;
      margin-bottom: 10px;
      color: #495057;
    }

    .info p {
      color: #6c757d;
      line-height: 1.6;
    }

    .legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .legend-color {
      width: 20px;
      height: 20px;
      border-radius: 3px;
    }

    .legend-label {
      font-size: 0.9em;
      color: #495057;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Payroll Compensation Flow</h1>
      <div class="date-range">${displayDateRange}</div>
    </header>

    <div id="sankey"></div>

    <div class="info">
      <h2>About This Diagram</h2>
      <p>
        This Sankey diagram visualizes the flow of compensation from gross earnings through various
        deductions and taxes to your net pay. The width of each flow represents the relative amount
        of money. Hover over nodes and links to see exact amounts.
      </p>

      <div class="legend">${legendHTML}
      </div>
    </div>
  </div>

  <script>
    const data = [{
      type: 'sankey',
      orientation: 'h',
      node: {
        pad: ${CHART_CONFIG.nodePadding},
        thickness: ${CHART_CONFIG.nodeThickness},
        line: {
          color: 'white',
          width: ${CHART_CONFIG.lineWidth}
        },
        label: ${JSON.stringify(data.nodes.map(n => n.label))},
        color: ${JSON.stringify(data.nodes.map(n => n.color))},
        hovertemplate: '<b>%{label}</b><br>Total: $%{value:,.2f}<extra></extra>'
      },
      link: {
        source: ${JSON.stringify(data.links.map(l => l.source))},
        target: ${JSON.stringify(data.links.map(l => l.target))},
        value: ${JSON.stringify(data.links.map(l => l.value))},
        color: ${JSON.stringify(data.links.map(l => l.color))},
        hovertemplate: '%{source.label} → %{target.label}<br>Amount: $%{value:,.2f}<extra></extra>'
      }
    }];

    const layout = {
      title: {
        text: 'Compensation Flow Breakdown',
        font: { size: 20 }
      },
      font: {
        size: 12,
        family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      },
      margin: { l: 20, r: 20, t: 60, b: 20 },
      plot_bgcolor: 'white',
      paper_bgcolor: 'white'
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d']
    };

    Plotly.newPlot('sankey', data, layout, config);
  </script>
</body>
</html>
`;
}

// Main function
function main() {
  // Parse command line arguments
  const { inputFile: inputFileArg, open: shouldOpen } = parseArgs();

  // Get input file from command line or find most recent
  let inputFile = inputFileArg;

  if (!inputFile) {
    logger.info('No input file specified, finding most recent plotly file...');
    inputFile = findMostRecentPlotly();
  }

  if (!path.isAbsolute(inputFile)) {
    inputFile = path.resolve(inputFile);
  }

  if (!fs.existsSync(inputFile)) {
    logger.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  logger.info(`Reading: ${inputFile}`);

  // Read and parse plotly data
  const plotlyData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

  // Validate the plotly data structure
  try {
    validatePlotlyData(plotlyData);
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }

  logger.info(`Generating HTML with ${plotlyData.nodes.length} nodes and ${plotlyData.links.length} links...`);

  // Extract date range
  const dateRangeFromFile = extractDateRange(path.basename(inputFile));
  const dateRange = plotlyData.dateRange || dateRangeFromFile;

  // Generate HTML
  const html = generateHTML(plotlyData, dateRange);

  // Create output directory
  const outputDir = path.join(__dirname, 'output', 'render');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output file
  const outputFilename = dateRange
    ? `sankey_${dateRange}.html`
    : 'sankey.html';
  const outputPath = path.join(outputDir, outputFilename);

  fs.writeFileSync(outputPath, html);

  logger.success(`HTML file written to: ${outputPath}`);
  logger.info(`To view the diagram, open the file in your browser:`);
  logger.info(`  open ${outputPath}`);

  // Open file in browser if --open flag is set
  if (shouldOpen) {
    logger.info('Opening in browser...');
    try {
      execSync(`open "${outputPath}"`, { stdio: 'ignore' });
    } catch (error) {
      logger.error(`Failed to open in browser: ${error.message}`);
    }
  }
}

main();
